/**
 * Deterministic stand-ins for the two ONNX models, so the pipeline's plumbing
 * can be tested without weights or a browser.
 *
 * Speakers are tones: "A" is a 200 Hz tone, "B" is 2 kHz, silence is zeros,
 * and both tones at once is overlap. Segmentation measures each 20 ms frame's
 * power at the two frequencies (Goertzel) and reports A, B, both or silence,
 * and — like the real model, whose verdict is least reliable where it has
 * least context — calls the first and last second of every window silence.
 * That is what the sliding windows with trust regions exist to compensate
 * for, so a path that skips them loses two seconds in ten here as it would
 * lose accuracy there.
 *
 * The embedding is the per-bin spread of the fbank features: a tone's energy
 * sits in a few mel bins, so the two speakers land far apart.
 */
export const SEGMENTATION_CLASSES = 7;
export const EMBEDDING_DIM = 80;
export const SAMPLE_RATE = 16000;

const FRAME = 320; // 20 ms
const EDGE_MS = 1000;

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
      const a = goertzel(window, f * FRAME, 200) > TONE_POWER;
      const b = goertzel(window, f * FRAME, 2000) > TONE_POWER;
      cls = a && b ? 4 : a ? 1 : b ? 2 : 0;
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
/** A tone of amplitude a gives about a²/4 here: 0.008–0.02 at the normal level, 0.0003 at a fifth of it; leakage is far less. */
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
  return out;
}

/**
 * A conversation between the two tones. Turns are [speaker, seconds] with an
 * optional amplitude, 1 being the normal level; a far-away voice is quiet.
 */
export function conversation(turns: readonly (readonly ['A' | 'B' | 'AB' | '-', number, number?])[]): Float32Array {
  const total = turns.reduce((s, [, sec]) => s + sec, 0);
  const audio = new Float32Array(Math.round(total * SAMPLE_RATE));
  let offset = 0;
  for (const [who, sec, amplitude = 1] of turns) {
    const n = Math.round(sec * SAMPLE_RATE);
    const tones = who === 'A' ? [200] : who === 'B' ? [2000] : who === 'AB' ? [200, 2000] : [];
    for (let i = 0; i < n; i++) {
      const t = (offset + i) / SAMPLE_RATE;
      // Amplitude modulation gives the fbank frames something to vary by.
      const env = 0.3 * amplitude * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t));
      let v = 0;
      for (const hz of tones) v += env * Math.sin(2 * Math.PI * hz * t);
      audio[offset + i] = v;
    }
    offset += n;
  }
  return audio;
}
