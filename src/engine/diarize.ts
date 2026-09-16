/**
 * The pipeline: audio in, speaking time per person out.
 *
 * Audio is never retained. Each speech span is converted to an embedding and
 * the samples are dropped immediately, which is what makes "Ronda does not
 * record you" a property of the code rather than a promise. See ADR 0001.
 */
import { computeFbank, WESPEAKER_FBANK } from './fbank.js';
import {
  agglomerative, absorbTinyClusters, normalise, resolveSpeakerCount,
  centreEmbeddings, keepBusiest, placeSplinters, splinterHeadroom,
  CLUSTER_HEADROOM, OTHER_VOICE, DEFAULT_THRESHOLD, type SpeakerCountHint,
} from './clustering.js';
import { loadModels, runSegmentation, runEmbedding, SEGMENTATION_CLASSES, SAMPLE_RATE } from './models.js';
import { decodeSegmentation, speechSpans, creditOverlap, overlapCredits, type Span } from './segmentation.js';
import { rms, selectForeground } from './levels.js';
import { windowPlan } from './windows.js';

const WINDOW_MS = 10_000;
const HOP_MS = 5_000;
/** Below this, an embedding is too unstable to cluster on. */
const MIN_SPEECH_MS = 800;

export interface SpeakerResult {
  id: number;
  totalMs: number;
  share: number;
  segments: number;
}

/**
 * Counts from each stage of the pipeline. Exposed in the interface because
 * "it only found one person" can mean several different failures, and these
 * numbers say which one without needing the audio.
 */
export interface Diagnostics {
  windows: number;
  spansTotal: number;
  spansSingleSpeaker: number;
  spansLongEnough: number;
  spansInForeground: number;
  backgroundMs: number;
  /** Speech grouped into voices that are not participants. */
  otherVoicesMs: number;
  /** Overlap credited to someone, whether to both voices or to the floor holder. */
  overlapCreditedMs: number;
  /** Overlap credited to both voices, because the window identified them. */
  overlapBothMs: number;
  embeddings: number;
  speechMs: number;
  longestSpanMs: number;
  discardedShortMs: number;
}

/**
 * How much the result can be trusted.
 *
 * 'insufficient' — too little clear speech to separate anyone. Reporting a
 *   split here would be invention.
 * 'low' — a split was produced, but from too few voice samples per person for
 *   it to mean much.
 * 'good' — enough samples for the numbers to be worth reading.
 */
export type Reliability = 'good' | 'low' | 'insufficient';

/** Below this many voice samples per person, a split is not worth trusting. */
const SAMPLES_PER_SPEAKER_FOR_CONFIDENCE = 3;

/**
 * A result built from a handful of voice samples is arithmetic, not evidence.
 * Saying so is more useful than a confident-looking pie chart: with only two
 * samples and two names, each sample simply becomes its own "speaker", which
 * looks exactly like a real result and is not one.
 */
export function assessReliability(samples: number, speakers: number): Reliability {
  if (samples < 2 || speakers === 0) return 'insufficient';
  return samples / speakers < SAMPLES_PER_SPEAKER_FOR_CONFIDENCE ? 'low' : 'good';
}

export interface DiarizationResult {
  speakers: SpeakerResult[];
  /** Every labelled speech span, in time order. */
  spans: { startMs: number; endMs: number; speaker: number }[];
  /** Spans where the model heard more than one voice at once, credited or not. */
  overlapMs: number;
  silenceMs: number;
  totalMs: number;
  countHint: SpeakerCountHint;
  reliability: Reliability;
  diagnostics: Diagnostics;
}

export interface DiarizeOptions {
  names?: readonly string[];
  calibratedProfiles?: number;
  /** How many people are at the table. Beats names; see resolveSpeakerCount. */
  speakerCount?: number;
  /**
   * Set when a television, radio or neighbouring table is audible. Allows extra
   * clusters so those voices get their own group instead of being forced into a
   * participant's tally. Off by default: see CLUSTER_HEADROOM for why.
   */
  backgroundVoices?: boolean;
  onProgress?: (fraction: number, stage: string) => void;
}

const msToSample = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);

const durationsOf = (spans: readonly Span[], count: number): number[] =>
  spans.slice(0, count).map((s) => s.endMs - s.startMs);

export async function diarize(
  audio: Float32Array,
  opts: DiarizeOptions = {},
): Promise<DiarizationResult> {
  const totalMs = (audio.length / SAMPLE_RATE) * 1000;
  const { segmentation, embedding } = await loadModels();

  // --- segment ---
  const plan = windowPlan(totalMs, WINDOW_MS, HOP_MS);
  const allSpans: Span[] = [];
  /** Which window each of allSpans came from, and each window's full span list in absolute time. */
  const windowOf: number[] = [];
  const windowSpans: Span[][] = [];
  for (let i = 0; i < plan.length; i++) {
    const w = plan[i]!;
    const chunk = audio.slice(msToSample(w.startMs), msToSample(w.endMs));
    const logits = await runSegmentation(segmentation, chunk);
    const local = decodeSegmentation(logits, SEGMENTATION_CLASSES, w.endMs - w.startMs);
    windowSpans.push(local.map((s) => ({ startMs: s.startMs + w.startMs, endMs: s.endMs + w.startMs, speakers: s.speakers })));
    for (const s of local) {
      const startMs = Math.max(s.startMs + w.startMs, w.trustFromMs);
      const endMs = Math.min(s.endMs + w.startMs, w.trustToMs);
      if (endMs > startMs) { allSpans.push({ startMs, endMs, speakers: s.speakers }); windowOf.push(i); }
    }
    opts.onProgress?.((i + 1) / plan.length * 0.4, 'segmenting');
  }
  // Windows are visited in time order and trust regions tile, so this is already sorted.
  const windowIndex = new Map<Span, number>(allSpans.map((s, i) => [s, windowOf[i]!]));

  const overlapMs = allSpans.filter((s) => s.speakers.length > 1)
    .reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const silenceMs = allSpans.filter((s) => s.speakers.length === 0)
    .reduce((sum, s) => sum + (s.endMs - s.startMs), 0);

  // --- embed ---
  const singleSpeaker = allSpans.filter((s) => s.speakers.length === 1);
  const candidates = speechSpans(allSpans, MIN_SPEECH_MS);

  // Speech from outside the conversation — the next table, a television — is
  // still speech, and counting it invents participants. Distance is what
  // separates it, but only when the user has said there are intruders: with
  // nobody outside the conversation, quiet speech is a soft-spoken person, and
  // dropping it cost real speech on every meeting it touched. See levels.ts.
  const levels = candidates.map((s) =>
    rms(audio.subarray(msToSample(s.startMs), msToSample(s.endMs))));
  const foreground = opts.backgroundVoices ? selectForeground(levels) : levels.map(() => true);
  const usable = candidates.filter((_, i) => foreground[i]);
  const backgroundMs = candidates
    .filter((_, i) => !foreground[i])
    .reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const speechMs = singleSpeaker.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const longestSpanMs = singleSpeaker.reduce((m, s) => Math.max(m, s.endMs - s.startMs), 0);
  const discardedShortMs = speechMs - usable.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const vectors: Float32Array[] = [];
  for (let i = 0; i < usable.length; i++) {
    const s = usable[i]!;
    const slice = audio.slice(msToSample(s.startMs), msToSample(s.endMs));
    const { frames, numBins } = computeFbank(slice, WESPEAKER_FBANK);
    if (frames.length === 0) continue;
    const raw = await runEmbedding(embedding, frames, frames.length / numBins, numBins);
    vectors.push(normalise(Float32Array.from(raw)));
    opts.onProgress?.(0.4 + ((i + 1) / usable.length) * 0.55, 'identifying');
    // The audio slice goes out of scope here and is never stored.
  }

  // --- cluster ---
  const countHint = resolveSpeakerCount({
    ...(opts.names !== undefined ? { names: opts.names } : {}),
    ...(opts.calibratedProfiles !== undefined ? { calibratedProfiles: opts.calibratedProfiles } : {}),
    ...(opts.speakerCount !== undefined ? { speakerCount: opts.speakerCount } : {}),
  });
  // Centring is applied only when the speaker count is known.
  //
  // On band-limited audio — a phone codec, a cheap microphone — average-linkage
  // clustering stops separating people and starts isolating a couple of outlier
  // segments instead, crediting one speaker with nearly everything. Measured on
  // a band-limited two-speaker recording: 91%/9% became 58%/42% after centring,
  // and a simulated phone-on-the-table recording went from 95%/5% to 62%/38%,
  // with clean recordings unchanged.
  //
  // It is not applied in automatic mode: centring widens all distances (mean
  // pairwise distance went from 0.75 to 1.09 in the same measurements), which
  // invalidates DEFAULT_THRESHOLD. With no speaker count to cut at, the
  // calibrated threshold is worth more than the outlier resistance.
  let labels: number[] = [];
  if (vectors.length > 0) {
    if (countHint.k !== null) {
      // Cluster with headroom, then keep only the busiest groups. Cutting at
      // exactly k forces every surplus voice into somebody's tally, and the
      // cost is not a small error: it merges two real people to free a slot.
      //
      // What happens to the surplus depends on where it came from. When the
      // user says a television or the next table is audible, the surplus is
      // intruders and is discarded (CLUSTER_HEADROOM). Otherwise it is one
      // participant's own outliers over a long conversation, and it is placed
      // back onto the nearest participant (splinterHeadroom, placeSplinters).
      const centred = centreEmbeddings(vectors);
      const durations = durationsOf(usable, vectors.length);
      if (opts.backgroundVoices) {
        const wide = agglomerative(centred, { k: countHint.k + CLUSTER_HEADROOM });
        labels = keepBusiest(wide, durations, countHint.k);
      } else {
        const wide = agglomerative(centred, { k: countHint.k + splinterHeadroom(vectors.length) });
        labels = placeSplinters(centred, keepBusiest(wide, durations, countHint.k), durations);
      }
    } else {
      labels = agglomerative(vectors, { threshold: DEFAULT_THRESHOLD });
    }
  }

  const durations = durationsOf(usable, vectors.length);
  if (!countHint.confident && vectors.length > 0) {
    labels = absorbTinyClusters(vectors, labels, durations, { minSegments: 2, minDurationMs: 2000 });
  }

  // --- credit overlap: to both voices when the window identifies them, else to the floor holder ---
  const attributedSpans = usable.slice(0, vectors.length);
  const overlaps = allSpans.filter((s) => s.speakers.length > 1);
  const floorHolder = creditOverlap(attributedSpans, overlaps);
  const both = overlapCredits(
    attributedSpans.map((span, vector) => ({ span, vector })),
    overlaps.map((span) => ({ span, windowSpans: windowSpans[windowIndex.get(span)!]! })),
  );
  const credit = { creditedMs: attributedSpans.map(() => 0), ownerOf: [] as number[] };
  let overlapBothMs = 0;
  overlaps.forEach((o, i) => {
    const ms = o.endMs - o.startMs;
    const targets = both[i]!.length > 0 ? both[i]! : floorHolder.ownerOf[i]! >= 0 ? [floorHolder.ownerOf[i]!] : [];
    for (const v of targets) credit.creditedMs[v] = credit.creditedMs[v]! + ms;
    if (both[i]!.length > 1) overlapBothMs += ms;
    // For the error-rate scorer, one speaker per instant: the floor holder.
    credit.ownerOf.push(floorHolder.ownerOf[i]!);
  });
  const overlapCreditedMs = credit.creditedMs.reduce((sum, ms, i) => sum + (labels[i] === OTHER_VOICE ? 0 : ms), 0);

  // --- tally ---
  const byId = new Map<number, { totalMs: number; segments: number }>();
  let otherVoicesMs = 0;
  labels.forEach((l, i) => {
    const ms = (durations[i] ?? 0) + (credit.creditedMs[i] ?? 0);
    if (l === OTHER_VOICE) {
      otherVoicesMs += ms;
      return;
    }
    const cur = byId.get(l) ?? { totalMs: 0, segments: 0 };
    cur.totalMs += ms;
    cur.segments += 1;
    byId.set(l, cur);
  });
  const spokenMs = [...byId.values()].reduce((s, v) => s + v.totalMs, 0);

  const speakers: SpeakerResult[] = [...byId.entries()]
    .map(([id, v]) => ({
      id,
      totalMs: v.totalMs,
      share: spokenMs > 0 ? v.totalMs / spokenMs : 0,
      segments: v.segments,
    }))
    .sort((a, b) => b.totalMs - a.totalMs);

  const reliability = assessReliability(vectors.length, speakers.length);

  opts.onProgress?.(1, 'done');
  return {
    speakers,
    spans: [
      ...attributedSpans.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, speaker: labels[i] ?? 0 })),
      ...overlaps.map((s, i) => ({ startMs: s.startMs, endMs: s.endMs, speaker: credit.ownerOf[i]! < 0 ? OTHER_VOICE : (labels[credit.ownerOf[i]!] ?? OTHER_VOICE) })),
    ].filter((s) => s.speaker !== OTHER_VOICE).sort((a, b) => a.startMs - b.startMs),
    overlapMs,
    silenceMs,
    totalMs,
    countHint,
    reliability,
    diagnostics: {
      windows: plan.length,
      spansTotal: allSpans.length,
      spansSingleSpeaker: singleSpeaker.length,
      spansLongEnough: candidates.length,
      spansInForeground: usable.length,
      backgroundMs,
      otherVoicesMs,
      overlapCreditedMs,
      overlapBothMs,
      embeddings: vectors.length,
      speechMs,
      longestSpanMs,
      discardedShortMs,
    },
  };
}
