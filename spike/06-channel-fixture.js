// Captures real embeddings from a band-limited recording, where the channel
// defeats clustering. No synthetic fixture reproduced this faithfully, so the
// regression test uses real vectors.
import { AutoProcessor, AutoModel, AutoModelForAudioFrameClassification } from '@huggingface/transformers';
import { readAudio16k } from './lib.js';
import { writeFileSync } from 'node:fs';

const SEG = 'onnx-community/pyannote-segmentation-3.0';
const EMB = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const SR = 16000, WIN = 10 * SR, HOP = 5 * SR;

const file = process.argv[2] ?? './audio/only-bandpass.wav';
const audio = readAudio16k(file);
const segProc = await AutoProcessor.from_pretrained(SEG);
const segModel = await AutoModelForAudioFrameClassification.from_pretrained(SEG, { dtype: 'q8' });
const embProc = await AutoProcessor.from_pretrained(EMB);
const embModel = await AutoModel.from_pretrained(EMB, { dtype: 'q8' });

const segments = [];
for (let off = 0; off < audio.length; off += HOP) {
  const chunk = audio.slice(off, Math.min(off + WIN, audio.length));
  if (chunk.length < SR) break;
  const { logits } = await segModel(await segProc(chunk));
  for (const s of segProc.post_process_speaker_diarization(logits, chunk.length)[0]) {
    if (s.id < 1 || s.id > 3) continue;
    const a = Math.max(s.start + off / SR, off === 0 ? 0 : off / SR + 2.5);
    const b = Math.min(s.end + off / SR, off / SR + (off + WIN >= audio.length ? 10 : 7.5));
    if (b - a >= 0.8) segments.push({ start: a, end: b });
  }
}
segments.sort((a, b) => a.start - b.start);

const vectors = [];
for (const s of segments) {
  const out = await embModel(await embProc(audio.slice(Math.floor(s.start * SR), Math.floor(s.end * SR))));
  const v = Array.from(out.last_hidden_state.data);
  const n = Math.hypot(...v);
  vectors.push(v.map((x) => Math.round((x / n) * 1e5) / 1e5));
}

// Verify the fixture actually exhibits the failure before writing it.
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
function cluster(X, k) {
  let g = X.map((_, i) => [i]);
  const d = (p, q) => {
    let s = 0;
    for (const i of p) for (const j of q) s += 1 - cos(X[i], X[j]);
    return s / (p.length * q.length);
  };
  while (g.length > k) {
    let best = Infinity, bi = 0, bj = 1;
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const dd = d(g[i], g[j]);
      if (dd < best) { best = dd; bi = i; bj = j; }
    }
    g[bi] = g[bi].concat(g[bj]); g.splice(bj, 1);
  }
  return g;
}
const durations = segments.map((s) => Math.round((s.end - s.start) * 1000));
const share = (groups) => {
  const times = groups.map((g) => g.reduce((s, i) => s + durations[i], 0));
  const total = times.reduce((a, b) => a + b, 0);
  return times.sort((a, b) => b - a).map((t) => Math.round((t / total) * 100));
};
const centred = (() => {
  const dim = vectors[0].length;
  const mean = new Array(dim).fill(0);
  for (const v of vectors) for (let i = 0; i < dim; i++) mean[i] += v[i] / vectors.length;
  return vectors.map((v) => {
    const c = v.map((x, i) => x - mean[i]);
    const n = Math.hypot(...c);
    return c.map((x) => x / n);
  });
})();

console.log(`${file}: n=${vectors.length}`);
console.log(`  uncentred: ${share(cluster(vectors, 2)).join('/')}`);
console.log(`  centred:   ${share(cluster(centred, 2)).join('/')}`);

writeFileSync('../test/fixtures/channel-embeddings.json', JSON.stringify({
  description: 'Real speaker embeddings from a band-limited recording, where the shared channel defeats clustering. No synthetic fixture reproduced this faithfully.',
  source: '2-two-speakers-en.wav through ffmpeg highpass=f=300,lowpass=f=3400',
  speakers: 2,
  dim: vectors[0].length,
  durationsMs: durations,
  vectors,
}));
console.log('wrote test/fixtures/channel-embeddings.json');
