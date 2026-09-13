// Spike step 1: does pyannote-segmentation-3.0 run in plain Node, and does its
// output look like a real conversation (alternating turns, sane boundaries)?
import { AutoProcessor, AutoModelForAudioFrameClassification } from '@huggingface/transformers';
import { readAudio16k, fmt } from './lib.js';

const MODEL = 'onnx-community/pyannote-segmentation-3.0';
const file = process.argv[2] ?? './audio/1-two-speakers-en.wav';
const dtype = process.argv[3] ?? 'fp32';

const audio = readAudio16k(file);
console.log(`audio: ${file}  ${(audio.length / 16000).toFixed(1)}s  ${audio.length} samples`);

let t = Date.now();
const processor = await AutoProcessor.from_pretrained(MODEL);
const model = await AutoModelForAudioFrameClassification.from_pretrained(MODEL, { dtype });
console.log(`model load (${dtype}): ${Date.now() - t} ms`);

t = Date.now();
const inputs = await processor(audio);
const { logits } = await model(inputs);
const infMs = Date.now() - t;
console.log(`inference: ${infMs} ms  → RTF ${(infMs / 1000 / (audio.length / 16000)).toFixed(3)}x`);
console.log(`logits dims: ${logits.dims}`);

const segments = processor.post_process_speaker_diarization(logits, audio.length)[0];
console.log(`\nsegments: ${segments.length}`);
for (const s of segments) {
  console.log(" ", JSON.stringify(s));
}
const ids = [...new Set(segments.map(s => s.id))];
console.log(`\ndistinct local speaker ids: ${ids.length} → ${ids}`);
