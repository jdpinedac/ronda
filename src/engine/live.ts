/**
 * Live diarization: who is speaking, while the conversation is happening.
 *
 * Audio arrives a second at a time and is buffered only until a full block can
 * be analysed. Each block is segmented, each stretch of single-speaker speech
 * becomes an embedding, and the samples are dropped immediately — a one-hour
 * conversation leaves about 2 MB of embeddings behind and no audio at all.
 *
 * Every block, all embeddings collected so far are re-clustered from scratch.
 * That costs milliseconds at conversation scale and means the picture corrects
 * itself as evidence accumulates: someone wrongly split in two early on gets
 * merged once there is enough of their voice to tell.
 */
import { computeFbank, WESPEAKER_FBANK } from './fbank.js';
import {
  agglomerative, absorbTinyClusters, centreEmbeddings, normalise, resolveSpeakerCount,
  keepBusiest, placeSplinters, splinterHeadroom, CLUSTER_HEADROOM, OTHER_VOICE,
  DEFAULT_THRESHOLD, type SpeakerCountHint,
} from './clustering.js';
import { rms, selectForeground } from './levels.js';
import { loadModels, runSegmentation, runEmbedding, SEGMENTATION_CLASSES, SAMPLE_RATE } from './models.js';
import { decodeSegmentation, speechSpans } from './segmentation.js';
import { assessReliability, type Reliability } from './diarize.js';

/** Analysed in blocks of this length. The segmentation model expects 10 s. */
const BLOCK_MS = 10_000;
const BLOCK_SAMPLES = (BLOCK_MS / 1000) * SAMPLE_RATE;
const MIN_SPEECH_MS = 800;

export interface LiveSpeaker {
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
  /** Analyse whatever is buffered, even if short. Call when stopping. */
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

  let pending: Float32Array[] = [];
  let pendingLength = 0;
  let elapsedMs = 0;
  let analysing = false;

  const vectors: Float32Array[] = [];
  const durations: number[] = [];
  /** Levels of every stretch considered so far, for the background threshold. */
  const levels: number[] = [];
  let backgroundMs = 0;
  let lastSpeaker: number | null = null;
  let labels: number[] = [];

  const handlers: ((s: LiveState) => void)[] = [];

  const drain = (): Float32Array | null => {
    if (pendingLength < BLOCK_SAMPLES) return null;
    const block = new Float32Array(BLOCK_SAMPLES);
    let offset = 0;
    while (offset < BLOCK_SAMPLES && pending.length > 0) {
      const head = pending[0]!;
      const take = Math.min(head.length, BLOCK_SAMPLES - offset);
      block.set(head.subarray(0, take), offset);
      offset += take;
      if (take === head.length) pending.shift();
      else pending[0] = head.subarray(take);
    }
    pendingLength -= BLOCK_SAMPLES;
    return block;
  };

  /** Same policy as diarize(): discard surplus voices if told about intruders, otherwise place them back. */
  function clusterKnownCount(centred: Float32Array[], k: number): number[] {
    if (opts.backgroundVoices) {
      return keepBusiest(agglomerative(centred, { k: k + CLUSTER_HEADROOM }), durations, k);
    }
    const wide = agglomerative(centred, { k: k + splinterHeadroom(centred.length) });
    return placeSplinters(centred, keepBusiest(wide, durations, k), durations);
  }

  /** Extract embeddings from one block, then let the audio go. */
  async function analyse(block: Float32Array, blockMs: number) {
    const logits = await runSegmentation(segmentation, block);
    const spans = decodeSegmentation(logits, SEGMENTATION_CLASSES, blockMs);
    const usable = speechSpans(spans, MIN_SPEECH_MS);

    // Judge loudness against everything heard so far, so the threshold settles
    // as the conversation establishes its own level.
    const blockLevels = usable.map((s) => rms(block.subarray(
      Math.round((s.startMs / 1000) * SAMPLE_RATE),
      Math.round((s.endMs / 1000) * SAMPLE_RATE))));
    const keep = selectForeground([...levels, ...blockLevels]).slice(levels.length);
    levels.push(...blockLevels);

    let heard: number | null = null;
    for (let i = 0; i < usable.length; i++) {
      const s = usable[i]!;
      if (!keep[i]) {
        backgroundMs += s.endMs - s.startMs;
        continue;
      }
      const from = Math.round((s.startMs / 1000) * SAMPLE_RATE);
      const to = Math.round((s.endMs / 1000) * SAMPLE_RATE);
      const { frames, numBins } = computeFbank(block.subarray(from, to), WESPEAKER_FBANK);
      if (frames.length === 0) continue;
      const raw = await runEmbedding(embedding, frames, frames.length / numBins, numBins);
      vectors.push(normalise(Float32Array.from(raw)));
      durations.push(s.endMs - s.startMs);
      heard = vectors.length - 1;
    }

    // Re-cluster everything heard so far, so earlier mistakes get corrected.
    if (vectors.length > 0) {
      labels = countHint.k !== null
        ? clusterKnownCount(centreEmbeddings(vectors), countHint.k)
        : absorbTinyClusters(
          vectors,
          agglomerative(vectors, { threshold: DEFAULT_THRESHOLD }),
          durations,
          { minSegments: 2, minDurationMs: 2000 },
        );
    }
    lastSpeaker = heard !== null ? (labels[heard] ?? null) : null;
  }

  function state(): LiveState {
    const byId = new Map<number, { totalMs: number; segments: number }>();
    let otherVoicesMs = 0;
    labels.forEach((l, i) => {
      if (l === OTHER_VOICE) {
        otherVoicesMs += durations[i] ?? 0;
        return;
      }
      const cur = byId.get(l) ?? { totalMs: 0, segments: 0 };
      cur.totalMs += durations[i] ?? 0;
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
      .sort((a, b) => b.totalMs - a.totalMs);

    return {
      speakers,
      elapsedMs,
      spokenMs,
      reliability: assessReliability(vectors.length, speakers.length),
      countHint,
      samples: vectors.length,
      backgroundMs,
      otherVoicesMs,
    };
  }

  const notify = () => { const s = state(); for (const h of handlers) h(s); };

  async function pump() {
    if (analysing) return;
    analysing = true;
    try {
      for (;;) {
        const block = drain();
        if (!block) break;
        await analyse(block, BLOCK_MS);
        notify();
      }
    } finally {
      analysing = false;
    }
  }

  return {
    push: (samples) => {
      pending.push(samples);
      pendingLength += samples.length;
      elapsedMs += (samples.length / SAMPLE_RATE) * 1000;
      void pump();
    },
    flush: async () => {
      // Analyse the tail, padded to the length the model expects.
      if (pendingLength >= SAMPLE_RATE) {
        const tail = new Float32Array(BLOCK_SAMPLES);
        let offset = 0;
        for (const c of pending) {
          const take = Math.min(c.length, BLOCK_SAMPLES - offset);
          tail.set(c.subarray(0, take), offset);
          offset += take;
          if (offset >= BLOCK_SAMPLES) break;
        }
        pending = [];
        const realMs = (offset / SAMPLE_RATE) * 1000;
        pendingLength = 0;
        await analyse(tail, BLOCK_MS);
        void realMs;
        notify();
      }
    },
    state,
    onUpdate: (h) => { handlers.push(h); },
    dispose: () => { pending = []; pendingLength = 0; handlers.length = 0; },
  };
}
