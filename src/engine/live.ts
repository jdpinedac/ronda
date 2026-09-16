/**
 * Live diarization: who is speaking, while the conversation is happening.
 *
 * Audio arrives a second at a time and is kept only until the sliding window
 * that needs it has been analysed — never more than about 15 s. Each window
 * is segmented, each stretch of single-speaker speech in its trusted middle
 * becomes an embedding, and the samples are dropped — a one-hour conversation
 * leaves about 2 MB of embeddings behind and no audio at all.
 *
 * After every window, all embeddings collected so far are re-clustered from
 * scratch. That costs milliseconds at conversation scale and means the picture
 * corrects itself as evidence accumulates: someone wrongly split in two early
 * on gets merged once there is enough of their voice to tell.
 *
 * The windowing, trust regions and every later stage match diarize(), so what
 * the benchmark measures on files holds for the table.
 */
import { computeFbank, WESPEAKER_FBANK } from './fbank.js';
import {
  agglomerative, absorbTinyClusters, centreEmbeddings, normalise, resolveSpeakerCount,
  keepBusiest, placeSplinters, splinterHeadroom, carryIdentities, CLUSTER_HEADROOM, OTHER_VOICE,
  DEFAULT_THRESHOLD, type SpeakerCountHint,
} from './clustering.js';
import { rms, selectForeground } from './levels.js';
import { loadModels, runSegmentation, runEmbedding, SEGMENTATION_CLASSES, SAMPLE_RATE } from './models.js';
import { decodeSegmentation, speechSpans, creditOverlap, type Span } from './segmentation.js';
import { assessReliability, type Reliability } from './diarize.js';

/**
 * The same sliding window as the file path: 10 s analysed every 5 s, and each
 * window trusted only in its middle, where the segmentation model has context
 * on both sides. See windows.ts. The first result therefore arrives when 10 s
 * of audio exist, and each later result covers audio up to 2.5 s ago.
 */
const WINDOW_MS = 10_000;
const HOP_MS = 5_000;
const MIN_SPEECH_MS = 800;

export interface LiveSpeaker {
  /** Stable for the whole session: the same person keeps the same id. */
  id: number;
  totalMs: number;
  share: number;
  segments: number;
  /** True while this speaker holds the floor. */
  active: boolean;
}

export interface LiveState {
  speakers: LiveSpeaker[];
  elapsedMs: number;
  /** How far into the audio the verdict reaches; the rest is still being heard. */
  coveredToMs: number;
  spokenMs: number;
  reliability: Reliability;
  countHint: SpeakerCountHint;
  /** Voice samples taken so far. */
  samples: number;
  /** Speech judged to come from outside the conversation. */
  backgroundMs: number;
  /** Speech grouped into voices that are not participants. */
  otherVoicesMs: number;
}

export interface LiveSession {
  /** Feed one second of 16 kHz mono audio. */
  push: (samples: Float32Array) => void;
  /**
   * Analyse whatever is buffered, even if short, and get ready to continue.
   * Call when the user stops listening: the tally stays, and audio pushed
   * afterwards adds to it, as a new stretch of the same conversation.
   */
  flush: () => Promise<void>;
  state: () => LiveState;
  onUpdate: (handler: (state: LiveState) => void) => void;
  dispose: () => void;
}

export interface LiveOptions {
  names?: readonly string[];
  calibratedProfiles?: number;
  /** How many people are at the table. Beats names; see resolveSpeakerCount. */
  speakerCount?: number;
  /** A television, radio or neighbouring table is audible. See CLUSTER_HEADROOM. */
  backgroundVoices?: boolean;
}

export async function startLiveSession(opts: LiveOptions = {}): Promise<LiveSession> {
  const { segmentation, embedding } = await loadModels();

  const countHint = resolveSpeakerCount({
    ...(opts.names !== undefined ? { names: opts.names } : {}),
    ...(opts.calibratedProfiles !== undefined ? { calibratedProfiles: opts.calibratedProfiles } : {}),
    ...(opts.speakerCount !== undefined ? { speakerCount: opts.speakerCount } : {}),
  });

  /** Audio not yet consumed by a window, starting at bufferStartMs. */
  let buffer = new Float32Array(0);
  let bufferStartMs = 0;
  let elapsedMs = 0;
  let nextWindowStartMs = 0;
  /** End of the last trusted region; the tail window at flush starts from here. */
  let trustedToMs = 0;
  /** Where the current stretch of listening began; its first window is trusted from its start. */
  let stretchStartMs = 0;
  let analysing = false;
  let disposed = false;

  const vectors: Float32Array[] = [];
  const durations: number[] = [];
  /** Overlap credited to each voice sample: whoever held the floor when it began. */
  const credited: number[] = [];
  /** Levels of every stretch considered so far, for the background threshold. */
  const levels: number[] = [];
  let backgroundMs = 0;
  let lastSpeaker: number | null = null;
  /** Stable identity of each voice sample; see carryIdentities. */
  let identities: number[] = [];
  let nextIdentity = 0;

  const handlers: ((s: LiveState) => void)[] = [];
  const msToSample = (ms: number) => Math.round((ms / 1000) * SAMPLE_RATE);
  const bufferedToMs = () => bufferStartMs + (buffer.length / SAMPLE_RATE) * 1000;

  /** Same policy as diarize(): discard surplus voices if told about intruders, otherwise place them back. */
  function clusterKnownCount(centred: Float32Array[], k: number): number[] {
    if (opts.backgroundVoices) {
      return keepBusiest(agglomerative(centred, { k: k + CLUSTER_HEADROOM }), durations, k);
    }
    const wide = agglomerative(centred, { k: k + splinterHeadroom(centred.length) });
    return placeSplinters(centred, keepBusiest(wide, durations, k), durations);
  }

  /**
   * Analyse one window of audio and keep only what falls inside its trusted
   * region, exactly as diarize() does; then let the audio go.
   */
  async function analyse(windowStartMs: number, windowEndMs: number, trustFromMs: number, trustToMs: number) {
    const from = msToSample(windowStartMs - bufferStartMs);
    const to = msToSample(windowEndMs - bufferStartMs);
    const window = buffer.slice(from, to);
    const windowMs = windowEndMs - windowStartMs;

    const logits = await runSegmentation(segmentation, window);
    const spans: Span[] = [];
    for (const s of decodeSegmentation(logits, SEGMENTATION_CLASSES, windowMs)) {
      const startMs = Math.max(s.startMs + windowStartMs, trustFromMs);
      const endMs = Math.min(s.endMs + windowStartMs, trustToMs);
      if (endMs > startMs) spans.push({ startMs, endMs, speakers: s.speakers });
    }
    const usable = speechSpans(spans, MIN_SPEECH_MS);

    // Judge loudness against everything heard so far, so the threshold settles
    // as the conversation establishes its own level — and only when the user
    // has said there are voices outside the conversation. See diarize().
    const blockLevels = usable.map((s) => rms(window.subarray(
      msToSample(s.startMs - windowStartMs), msToSample(s.endMs - windowStartMs))));
    const keep = opts.backgroundVoices
      ? selectForeground([...levels, ...blockLevels]).slice(levels.length)
      : blockLevels.map(() => true);
    levels.push(...blockLevels);

    let heard: number | null = null;
    const attributed: Span[] = [];
    const vectorOf: number[] = [];
    const lastBefore = vectors.length - 1;
    for (let i = 0; i < usable.length; i++) {
      const s = usable[i]!;
      if (!keep[i]) {
        backgroundMs += s.endMs - s.startMs;
        continue;
      }
      const { frames, numBins } = computeFbank(
        window.subarray(msToSample(s.startMs - windowStartMs), msToSample(s.endMs - windowStartMs)), WESPEAKER_FBANK);
      if (frames.length === 0) continue;
      const raw = await runEmbedding(embedding, frames, frames.length / numBins, numBins);
      vectors.push(normalise(Float32Array.from(raw)));
      durations.push(s.endMs - s.startMs);
      credited.push(0);
      heard = vectors.length - 1;
      attributed.push(s);
      vectorOf.push(heard);
    }

    // Overlap goes to whoever held the floor when it began; before the first
    // voice of this window, that is the last voice of the previous one.
    const overlaps = spans.filter((s) => s.speakers.length > 1);
    creditOverlap(attributed, overlaps).ownerOf.forEach((owner, oi) => {
      const target = owner >= 0 ? vectorOf[owner]! : lastBefore;
      if (target >= 0) credited[target] = credited[target]! + (overlaps[oi]!.endMs - overlaps[oi]!.startMs);
    });

    // Re-cluster everything heard so far, so earlier mistakes get corrected —
    // and carry each person's identity over, so their colour and name do not.
    if (vectors.length > 0) {
      const labels = countHint.k !== null
        ? clusterKnownCount(centreEmbeddings(vectors), countHint.k)
        : absorbTinyClusters(
          vectors,
          agglomerative(vectors, { threshold: DEFAULT_THRESHOLD }),
          durations,
          { minSegments: 2, minDurationMs: 2000 },
        );
      ({ identities, nextId: nextIdentity } = carryIdentities(labels, identities, durations, nextIdentity));
    }
    // Who holds the floor: the latest voice sample of the window. Two other
    // rules and a separate fast path were measured against annotation and
    // did no better; ADR 0008 has the numbers and where the limit really is.
    lastSpeaker = heard !== null ? (identities[heard] ?? null) : null;
    trustedToMs = Math.max(trustedToMs, trustToMs);
  }

  /** Every window whose audio is complete, in order; then drop what no later window needs. */
  async function pump() {
    if (analysing || disposed) return;
    analysing = true;
    try {
      while (bufferedToMs() >= nextWindowStartMs + WINDOW_MS) {
        const startMs = nextWindowStartMs;
        // The boundary between two windows is the midpoint of the stretch they
        // both cover, as in windows.ts: 2.5 s in from each edge.
        const trustFromMs = startMs === stretchStartMs ? startMs : startMs + (WINDOW_MS - HOP_MS) / 2;
        const trustToMs = startMs + WINDOW_MS - (WINDOW_MS - HOP_MS) / 2;
        await analyse(startMs, startMs + WINDOW_MS, trustFromMs, trustToMs);
        nextWindowStartMs += HOP_MS;
        const dropMs = nextWindowStartMs - bufferStartMs;
        if (dropMs > 0) { buffer = buffer.slice(msToSample(dropMs)); bufferStartMs = nextWindowStartMs; }
        notify();
      }
    } finally {
      analysing = false;
    }
  }

  /**
   * Analyse the tail: the last 10 s of audio (or all of it, if shorter),
   * trusted from wherever trust last ended to the very end, as the file path
   * trusts its final window to the end of the recording.
   */
  async function flushTail() {
    while (analysing) await new Promise((r) => setTimeout(r, 10));
    const endMs = bufferedToMs();
    if (endMs - trustedToMs < 1000 && trustedToMs > stretchStartMs) return;
    if (endMs - bufferStartMs < 1000) return;
    analysing = true;
    try {
      const startMs = Math.max(bufferStartMs, endMs - WINDOW_MS);
      await analyse(startMs, endMs, trustedToMs, endMs);
    } finally {
      analysing = false;
    }
    notify();
  }

  function state(): LiveState {
    const byId = new Map<number, { totalMs: number; segments: number }>();
    let otherVoicesMs = 0;
    identities.forEach((l, i) => {
      const ms = (durations[i] ?? 0) + (credited[i] ?? 0);
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
    const speakers: LiveSpeaker[] = [...byId.entries()]
      .map(([id, v]) => ({
        id,
        totalMs: v.totalMs,
        share: spokenMs > 0 ? v.totalMs / spokenMs : 0,
        segments: v.segments,
        active: id === lastSpeaker,
      }))
      .sort((a, b) => a.id - b.id);

    return {
      speakers,
      elapsedMs,
      coveredToMs: trustedToMs,
      spokenMs,
      reliability: assessReliability(vectors.length, speakers.length),
      countHint,
      samples: vectors.length,
      backgroundMs,
      otherVoicesMs,
    };
  }

  const notify = () => { const s = state(); for (const h of handlers) h(s); };

  return {
    push: (samples) => {
      if (disposed) return;
      const joined = new Float32Array(buffer.length + samples.length);
      joined.set(buffer, 0);
      joined.set(samples, buffer.length);
      buffer = joined;
      elapsedMs += (samples.length / SAMPLE_RATE) * 1000;
      void pump();
    },
    flush: async () => {
      await pump();
      await flushTail();
      // A pause. Whatever comes next starts a new stretch at this point in
      // the conversation's clock; samples, identities and credit carry on.
      buffer = new Float32Array(0);
      bufferStartMs = elapsedMs;
      nextWindowStartMs = elapsedMs;
      trustedToMs = elapsedMs;
      stretchStartMs = elapsedMs;
    },
    state,
    onUpdate: (h) => { handlers.push(h); },
    dispose: () => { buffer = new Float32Array(0); handlers.length = 0; disposed = true; },
  };
}
