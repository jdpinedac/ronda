// Spike step 2 — THE decisive question: do WeSpeaker embeddings put the same
// person close together and different people far apart?
//
// Ground truth comes from the segmentation model's local powerset ids on a clip
// known to contain exactly two speakers: id 1..3 are individual speakers.
import { AutoProcessor, AutoModel, AutoModelForAudioFrameClassification } from '@huggingface/transformers';
import { readAudio16k, fmt } from './lib.js';

const SEG = 'onnx-community/pyannote-segmentation-3.0';
const EMB = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const file = process.argv[2] ?? './audio/1-two-speakers-en.wav';
const dtype = process.argv[3] ?? 'fp32';

const audio = readAudio16k(file);
const durS = audio.length / 16000;
console.log(`\n=== ${file}  (${durS.toFixed(1)}s)   dtype=${dtype}\n`);

// --- segmentation ---
const segProc = await AutoProcessor.from_pretrained(SEG);
const segModel = await AutoModelForAudioFrameClassification.from_pretrained(SEG, { dtype });
let t = Date.now();
const { logits } = await segModel(await segProc(audio));
const segMs = Date.now() - t;
const raw = segProc.post_process_speaker_diarization(logits, audio.length)[0];
// id 0 = silence; ids 4..6 = overlap of two speakers
const speech = raw.filter(s => s.id >= 1 && s.id <= 3 && s.end - s.start >= 0.8);
console.log(`segmentation: ${segMs} ms, ${speech.length} speech segments >= 0.8s`);

// --- embeddings ---
const embProc = await AutoProcessor.from_pretrained(EMB);
const embModel = await AutoModel.from_pretrained(EMB, { dtype });

const vecs = [];
t = Date.now();
for (const s of speech) {
  const slice = audio.slice(Math.floor(s.start * 16000), Math.floor(s.end * 16000));
  const out = await embModel(await embProc(slice));
  const v = Array.from(out.last_hidden_state.data);
  const n = Math.hypot(...v);
  vecs.push({ seg: s, v: v.map(x => x / n) });
}
const embMs = Date.now() - t;
console.log(`embeddings:   ${embMs} ms for ${vecs.length} segments (${(embMs / vecs.length).toFixed(0)} ms each), dim=${vecs[0].v.length}`);
console.log(`total RTF:    ${((segMs + embMs) / 1000 / durS).toFixed(3)}x\n`);

const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);

console.log('cosine similarity matrix (rows/cols = segments, labelled by true speaker id):');
process.stdout.write('           ');
vecs.forEach((x, i) => process.stdout.write(`  #${String(i).padStart(2)}/${x.seg.id} `));
console.log();
vecs.forEach((a, i) => {
  process.stdout.write(`  #${String(i).padStart(2)}/${a.seg.id} ${fmt(a.seg.start).padStart(5)} `);
  vecs.forEach((b) => {
    const c = cos(a.v, b.v);
    process.stdout.write(`  ${c >= 0 ? ' ' : ''}${c.toFixed(2)} `);
  });
  console.log();
});

// --- the verdict ---
let same = [], diff = [];
for (let i = 0; i < vecs.length; i++) {
  for (let j = i + 1; j < vecs.length; j++) {
    (vecs[i].seg.id === vecs[j].seg.id ? same : diff).push(cos(vecs[i].v, vecs[j].v));
  }
}
const stats = (a) => a.length
  ? `n=${a.length}  mean ${(a.reduce((x, y) => x + y) / a.length).toFixed(3)}  min ${Math.min(...a).toFixed(3)}  max ${Math.max(...a).toFixed(3)}`
  : 'n=0';
console.log(`\nSAME speaker pairs:      ${stats(same)}`);
console.log(`DIFFERENT speaker pairs: ${stats(diff)}`);
if (same.length && diff.length) {
  const gap = Math.min(...same) - Math.max(...diff);
  console.log(`\nSEPARATION GAP: ${gap.toFixed(3)}  ${gap > 0 ? '✓ CLEANLY SEPARABLE (a single threshold splits them perfectly)' : '✗ OVERLAP — no single threshold works'}`);
}
