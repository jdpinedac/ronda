// Generates golden fixtures for the app's own fbank implementation, using
// transformers.js as the oracle. Run once; the app itself never depends on
// transformers.js. Input audio is generated from a seeded PRNG so the fixture
// only needs to store the expected output.
import { AutoProcessor, AutoModel } from '@huggingface/transformers';
import { writeFileSync, mkdirSync } from 'node:fs';

/** mulberry32 — must be reimplemented identically in the test. */
function prng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** Deterministic 1 s test signal: three formant-like tones plus shaped noise. */
function makeSignal(n = 16000, seed = 42) {
  const rnd = prng(seed);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / 16000;
    a[i] = 0.35 * Math.sin(2 * Math.PI * 140 * t)
         + 0.20 * Math.sin(2 * Math.PI * 700 * t)
         + 0.12 * Math.sin(2 * Math.PI * 2300 * t)
         + 0.05 * (rnd() * 2 - 1);
  }
  return a;
}

const EMB = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const proc = await AutoProcessor.from_pretrained(EMB);
const model = await AutoModel.from_pretrained(EMB, { dtype: 'fp32' });

const audio = makeSignal();
const feats = await proc(audio);
const f = feats.input_features;
const out = await model(feats);

const round = (x) => Number(x.toFixed(6));
mkdirSync('../test/fixtures', { recursive: true });

writeFileSync('../test/fixtures/fbank.json', JSON.stringify({
  description: 'WeSpeaker 80-bin Kaldi fbank. Oracle: transformers.js 4.2.0 WeSpeakerFeatureExtractor.',
  signal: { kind: 'mulberry32', seed: 42, samples: 16000, sampleRate: 16000 },
  config: { numMelBins: 80, frameLength: 25, frameShift: 10, window: 'hamming', dither: 0, snipEdges: true, roundToPowerOfTwo: true },
  dims: f.dims,
  features: Array.from(f.data).map(round),
}));

writeFileSync('../test/fixtures/embedding.json', JSON.stringify({
  description: 'WeSpeaker embedding for the same signal, fp32. End-to-end oracle.',
  signal: { kind: 'mulberry32', seed: 42, samples: 16000, sampleRate: 16000 },
  dims: out.last_hidden_state.dims,
  embedding: Array.from(out.last_hidden_state.data).map(round),
}));

console.log('fbank dims     ', f.dims, ' range', Math.min(...f.data).toFixed(3), '..', Math.max(...f.data).toFixed(3));
console.log('embedding dims ', out.last_hidden_state.dims);
console.log('wrote test/fixtures/{fbank,embedding}.json');
