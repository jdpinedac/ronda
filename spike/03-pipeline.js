// Spike step 3: the full pipeline as designed — 10s sliding windows, hop 5s,
// embedding per speech segment, global average-linkage agglomerative clustering.
import { AutoProcessor, AutoModel, AutoModelForAudioFrameClassification } from '@huggingface/transformers';
import { readAudio16k, fmt } from './lib.js';

const SEG = 'onnx-community/pyannote-segmentation-3.0';
const EMB = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const SR = 16000, WIN = 10 * SR, HOP = 5 * SR, MIN_SEG = 0.8;

const file = process.argv[2];
const dtype = process.argv[3] ?? 'fp32';
const expected = Number(process.argv[4] ?? 0);

const audio = readAudio16k(file);
const durS = audio.length / SR;

const segProc = await AutoProcessor.from_pretrained(SEG);
const segModel = await AutoModelForAudioFrameClassification.from_pretrained(SEG, { dtype });
const embProc = await AutoProcessor.from_pretrained(EMB);
const embModel = await AutoModel.from_pretrained(EMB, { dtype });

// --- windowed segmentation -> absolute-time speech segments ---
const t0 = Date.now();
let segments = [];
for (let off = 0; off < audio.length; off += HOP) {
  const chunk = audio.slice(off, Math.min(off + WIN, audio.length));
  if (chunk.length < SR) break;
  const { logits } = await segModel(await segProc(chunk));
  const local = segProc.post_process_speaker_diarization(logits, chunk.length)[0];
  const center0 = off === 0 ? 0 : off / SR + 2.5;           // trust the middle of
  const center1 = off / SR + (off + WIN >= audio.length ? 10 : 7.5); // each window
  for (const s of local) {
    if (s.id < 1 || s.id > 3) continue;                      // 0 = silence, 4..6 = overlap
    const a = Math.max(s.start + off / SR, center0);
    const b = Math.min(s.end + off / SR, center1);
    if (b - a >= MIN_SEG) segments.push({ start: a, end: b });
  }
}
segments.sort((a, b) => a.start - b.start);
const segMs = Date.now() - t0;

// --- embeddings ---
const t1 = Date.now();
const X = [];
for (const s of segments) {
  const out = await embModel(await embProc(audio.slice(Math.floor(s.start * SR), Math.floor(s.end * SR))));
  const v = Array.from(out.last_hidden_state.data);
  const n = Math.hypot(...v);
  X.push(v.map(x => x / n));
}
const embMs = Date.now() - t1;

const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

/** Average-linkage agglomerative clustering on cosine distance. */
function cluster(X, threshold) {
  let groups = X.map((_, i) => [i]);
  const d = (g, h) => {
    let s = 0;
    for (const i of g) for (const j of h) s += 1 - cos(X[i], X[j]);
    return s / (g.length * h.length);
  };
  for (;;) {
    let best = Infinity, bi = -1, bj = -1;
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const dd = d(groups[i], groups[j]);
        if (dd < best) { best = dd; bi = i; bj = j; }
      }
    if (bi < 0 || best > threshold) break;
    groups[bi] = groups[bi].concat(groups[bj]);
    groups.splice(bj, 1);
  }
  return groups;
}

console.log(`\n=== ${file}  ${durS.toFixed(1)}s   dtype=${dtype}`);
console.log(`segmentation ${segMs} ms · ${X.length} segments · embeddings ${embMs} ms (${(embMs / Math.max(1, X.length)).toFixed(0)} ms each)`);
console.log(`total ${segMs + embMs} ms → RTF ${((segMs + embMs) / 1000 / durS).toFixed(3)}x`);

console.log(`\nthreshold sweep (speakers found):`);
for (const th of [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]) {
  const g = cluster(X, th);
  const mark = expected && g.length === expected ? '  <-- matches expected' : '';
  console.log(`  dist <= ${th.toFixed(1)}  →  ${String(g.length).padStart(2)} speakers${mark}`);
}

const groups = cluster(X, 0.6).sort((a, b) => b.length - a.length);
console.log(`\nat threshold 0.6 — time share:`);
const total = segments.reduce((s, x) => s + (x.end - x.start), 0);
groups.forEach((g, k) => {
  const t = g.reduce((s, i) => s + segments[i].end - segments[i].start, 0);
  console.log(`  Speaker ${k + 1}: ${fmt(t).padStart(6)}  ${String(Math.round(t / total * 100)).padStart(3)}%  (${g.length} segments)`);
});
const label = new Array(segments.length);
groups.forEach((g, k) => g.forEach(i => label[i] = k + 1));
console.log(`\n  timeline: ${segments.map((s, i) => `${fmt(s.start)}→S${label[i]}`).join('  ')}`);
