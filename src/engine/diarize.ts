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
  centreEmbeddings, DEFAULT_THRESHOLD, type SpeakerCountHint,
} from './clustering.js';
import { loadModels, runSegmentation, runEmbedding, SEGMENTATION_CLASSES, SAMPLE_RATE } from './models.js';
import { decodeSegmentation, speechSpans, type Span } from './segmentation.js';
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
  embeddings: number;
  speechMs: number;
  longestSpanMs: number;
  discardedShortMs: number;
}

export interface DiarizationResult {
  speakers: SpeakerResult[];
  /** Every labelled speech span, in time order. */
  spans: { startMs: number; endMs: number; speaker: number }[];
  /** Spans where the model heard more than one voice at once. */
  overlapMs: number;
  silenceMs: number;
  totalMs: number;
  countHint: SpeakerCountHint;
  diagnostics: Diagnostics;
}

export interface DiarizeOptions {
  names?: readonly string[];
  calibratedProfiles?: number;
  onProgress?: (fraction: number, stage: string) => void;
}

const msToSample = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);

export async function diarize(
  audio: Float32Array,
  opts: DiarizeOptions = {},
): Promise<DiarizationResult> {
  const totalMs = (audio.length / SAMPLE_RATE) * 1000;
  const { segmentation, embedding } = await loadModels();

  // --- segment ---
  const plan = windowPlan(totalMs, WINDOW_MS, HOP_MS);
  const allSpans: Span[] = [];
  for (let i = 0; i < plan.length; i++) {
    const w = plan[i]!;
    const chunk = audio.slice(msToSample(w.startMs), msToSample(w.endMs));
    const logits = await runSegmentation(segmentation, chunk);
    const local = decodeSegmentation(logits, SEGMENTATION_CLASSES, w.endMs - w.startMs);
    for (const s of local) {
      const startMs = Math.max(s.startMs + w.startMs, w.trustFromMs);
      const endMs = Math.min(s.endMs + w.startMs, w.trustToMs);
      if (endMs > startMs) allSpans.push({ startMs, endMs, speakers: s.speakers });
    }
    opts.onProgress?.((i + 1) / plan.length * 0.4, 'segmenting');
  }
  allSpans.sort((a, b) => a.startMs - b.startMs);

  const overlapMs = allSpans.filter((s) => s.speakers.length > 1)
    .reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
  const silenceMs = allSpans.filter((s) => s.speakers.length === 0)
    .reduce((sum, s) => sum + (s.endMs - s.startMs), 0);

  // --- embed ---
  const singleSpeaker = allSpans.filter((s) => s.speakers.length === 1);
  const usable = speechSpans(allSpans, MIN_SPEECH_MS);
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
    labels = countHint.k !== null
      ? agglomerative(centreEmbeddings(vectors), { k: countHint.k })
      : agglomerative(vectors, { threshold: DEFAULT_THRESHOLD });
  }

  const durations = usable.slice(0, vectors.length).map((s) => s.endMs - s.startMs);
  if (!countHint.confident && vectors.length > 0) {
    labels = absorbTinyClusters(vectors, labels, durations, { minSegments: 2, minDurationMs: 2000 });
  }

  // --- tally ---
  const byId = new Map<number, { totalMs: number; segments: number }>();
  labels.forEach((l, i) => {
    const cur = byId.get(l) ?? { totalMs: 0, segments: 0 };
    cur.totalMs += durations[i] ?? 0;
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

  opts.onProgress?.(1, 'done');
  return {
    speakers,
    spans: usable.slice(0, vectors.length).map((s, i) => ({
      startMs: s.startMs, endMs: s.endMs, speaker: labels[i] ?? 0,
    })),
    overlapMs,
    silenceMs,
    totalMs,
    countHint,
    diagnostics: {
      windows: plan.length,
      spansTotal: allSpans.length,
      spansSingleSpeaker: singleSpeaker.length,
      spansLongEnough: usable.length,
      embeddings: vectors.length,
      speechMs,
      longestSpanMs,
      discardedShortMs,
    },
  };
}
