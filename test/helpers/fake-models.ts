/**
 * Deterministic stand-ins for the two ONNX models, so the pipeline's plumbing
 * can be tested without weights or a browser.
 *
 * Speakers are pairs of tones a voice alternates between every 100 ms: "A"
 * is 200/300 Hz, "B" 2000/2600 Hz, "C" 800/1050 Hz; silence is zeros, and A
 * and B at once is overlap. Segmentation measures each 20 ms frame's power at
 * those frequencies (Goertzel) and reports A, B, C, A+B or silence,
 * and — like the real model, whose verdict is least reliable where it has
 * least context — calls the first and last second of every window silence.
 * That is what the sliding windows with trust regions exist to compensate
 * for, so a path that skips them loses two seconds in ten here as it would
 * lose accuracy there.
 *
 * The embedding is the per-bin spread of the fbank features over time. The
 * real features are mean-normalised per bin, which erases the level of each
 * bin; what survives is how much each bin varies, and a voice that alternates
 * between two tones varies hugely in exactly those bins and little elsewhere.
 * So voices land nearly orthogonal in cosine distance, samples of one voice
 * stay close, and the engine's distance thresholds mean what they mean.
 */
export const SEGMENTATION_CLASSES = 7;
export const EMBEDDING_DIM = 80;
export const SAMPLE_RATE = 16000;

const FRAME = 320; // 20 ms
const EDGE_MS = 1000;
/** Each voice alternates between its two tones; all sit on exact Goertzel bins (multiples of 50 Hz). */
const TONES = { A: [200, 250], B: [2000, 2200], C: [800, 900] } as const;
const ALTERNATE_S = 0.1;

export async function loadModels() {
  return { segmentation: {}, embedding: {} } as unknown as { segmentation: never; embedding: never };
}

export async function runSegmentation(_s: unknown, window: Float32Array): Promise<Float32Array> {
  const numFrames = Math.floor(window.length / FRAME);
  const durationMs = (window.length / SAMPLE_RATE) * 1000;
  const logits = new Float32Array(numFrames * SEGMENTATION_CLASSES).fill(-10);
  for (let f = 0; f < numFrames; f++) {
    const startMs = (f * FRAME / SAMPLE_RATE) * 1000;
    let cls = 0;
    if (startMs >= EDGE_MS && startMs < durationMs - EDGE_MS) {
      const hears = (hzs: readonly number[]) => hzs.some((hz) => goertzel(window, f * FRAME, hz) > TONE_POWER);
      const a = hears(TONES.A);
      const b = hears(TONES.B);
      const c = hears(TONES.C);
      cls = a && b ? 4 : a ? 1 : b ? 2 : c ? 3 : 0;
    }
    logits[f * SEGMENTATION_CLASSES + cls] = 10;
  }
  return logits;
}

/** Power of one frame at one frequency, normalised by frame length. */
function goertzel(x: Float32Array, offset: number, hz: number): number {
  const k = Math.round((FRAME * hz) / SAMPLE_RATE);
  const w = (2 * Math.PI * k) / FRAME;
  const coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < FRAME; i++) { const s0 = x[offset + i]! + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return (s1 * s1 + s2 * s2 - coeff * s1 * s2) / (FRAME * FRAME);
}
/** A tone of amplitude a gives about a²/4 here: 0.0225 at the normal level, 0.0009 at a fifth of it; leakage is far less. */
const TONE_POWER = 0.00002;

export async function runEmbedding(_s: unknown, features: Float32Array, numFrames: number, numBins: number): Promise<Float32Array> {
  const out = new Float32Array(numBins);
  for (let b = 0; b < numBins; b++) {
    let mean = 0;
    for (let f = 0; f < numFrames; f++) mean += features[f * numBins + b]!;
    mean /= numFrames;
    let varSum = 0;
    for (let f = 0; f < numFrames; f++) { const d = features[f * numBins + b]! - mean; varSum += d * d; }
    out[b] = Math.sqrt(varSum / numFrames);
  }
  // Every bin varies a little through spectral leakage, and that shared floor
  // would pull all voices towards one direction; the median spread is that
  // floor, and removing it leaves the bins where the voice really is.
  const median = [...out].sort((a, b) => a - b)[numBins >> 1]!;
  for (let b = 0; b < numBins; b++) out[b] = out[b]! - median;
  return out;
}

/**
 * A conversation between the voices. Turns are [speaker, seconds] with an
 * optional amplitude, 1 being the normal level; a far-away voice is quiet.
 */
export function conversation(turns: readonly (readonly ['A' | 'B' | 'C' | 'AB' | '-', number, number?])[]): Float32Array {
  const total = turns.reduce((s, [, sec]) => s + sec, 0);
  const audio = new Float32Array(Math.round(total * SAMPLE_RATE));
  let offset = 0;
  for (const [who, sec, amplitude = 1] of turns) {
    const n = Math.round(sec * SAMPLE_RATE);
    const voices = who === 'A' ? [TONES.A] : who === 'B' ? [TONES.B] : who === 'C' ? [TONES.C] : who === 'AB' ? [TONES.A, TONES.B] : [];
    for (let i = 0; i < n; i++) {
      const t = (offset + i) / SAMPLE_RATE;
      // Each voice alternates between its two tones; that alternation is what
      // the embedding reads, since the features' mean normalisation erases level.
      const which = Math.floor(t / ALTERNATE_S) % 2;
      let v = 0;
      for (const pair of voices) v += 0.3 * amplitude * Math.sin(2 * Math.PI * pair[which]! * t);
      audio[offset + i] = v;
    }
    offset += n;
  }
  return audio;
}
