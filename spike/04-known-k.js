// Spike step 4: if the number of people is known (the user typed their names,
// or they calibrated), cut the dendrogram at exactly K instead of guessing a
// threshold. Does that remove the fragility?
import { AutoProcessor, AutoModel, AutoModelForAudioFrameClassification } from '@huggingface/transformers';
import { readAudio16k, fmt } from './lib.js';

const SEG = 'onnx-community/pyannote-segmentation-3.0';
const EMB = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const SR = 16000, WIN = 10 * SR, HOP = 5 * SR;

const [, , file, dtype = 'q8', K = '2'] = process.argv;
const audio = readAudio16k(file);
const segProc = await AutoProcessor.from_pretrained(SEG);
const segModel = await AutoModelForAudioFrameClassification.from_pretrained(SEG, { dtype });
const embProc = await AutoProcessor.from_pretrained(EMB);
const embModel = await AutoModel.from_pretrained(EMB, { dtype });

let segments = [];
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

const X = [];
for (const s of segments) {
  const out = await embModel(await embProc(audio.slice(Math.floor(s.start * SR), Math.floor(s.end * SR))));
  const v = Array.from(out.last_hidden_state.data);
  const n = Math.hypot(...v);
  X.push(v.map(x => x / n));
}
const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Average-linkage agglomerative clustering, cut at exactly k clusters. */
function clusterK(X, k) {
  let groups = X.map((_, i) => [i]);
  const d = (g, h) => {
    let s = 0;
    for (const i of g) for (const j of h) s += 1 - cos(X[i], X[j]);
    return s / (g.length * h.length);
  };
  while (groups.length > k) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const dd = d(groups[i], groups[j]);
        if (dd < best) { best = dd; bi = i; bj = j; }
      }
    if (bi < 0) break;
    groups[bi] = groups[bi].concat(groups[bj]);
    groups.splice(bj, 1);
  }
  return groups;
}

const groups = clusterK(X, Number(K)).sort((a, b) => b.length - a.length);
const label = new Array(segments.length);
groups.forEach((g, k) => g.forEach(i => label[i] = k + 1));
const total = segments.reduce((s, x) => s + (x.end - x.start), 0);

console.log(`\n${file}  dtype=${dtype}  K=${K}  (${segments.length} segments, ${total.toFixed(1)}s of speech)`);
groups.forEach((g, k) => {
  const t = g.reduce((s, i) => s + segments[i].end - segments[i].start, 0);
  console.log(`  Speaker ${k + 1}: ${fmt(t).padStart(6)}  ${String(Math.round(t / total * 100)).padStart(3)}%`);
});
console.log(`  timeline: ${segments.map((s, i) => `S${label[i]}`).join(' ')}`);
