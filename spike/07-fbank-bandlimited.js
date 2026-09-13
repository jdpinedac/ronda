// Oracle fbank for BAND-LIMITED audio, where some mel bins receive almost no
// energy. This is the case the clean-signal fixture never exercised.
import { AutoProcessor } from '@huggingface/transformers';
import { readAudio16k } from './lib.js';
import { writeFileSync } from 'node:fs';

const EMB = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const proc = await AutoProcessor.from_pretrained(EMB);

const audio = readAudio16k('./audio/only-bandpass.wav').slice(16000 * 3, 16000 * 4); // 1 s
const feats = await proc(audio);
const f = feats.input_features;
const data = Array.from(f.data);

console.log('dims', f.dims);
console.log('range', Math.min(...data).toFixed(3), '..', Math.max(...data).toFixed(3));

writeFileSync('../test/fixtures/fbank-bandlimited.json', JSON.stringify({
  description: 'WeSpeaker fbank for band-limited audio (300-3400 Hz), where low mel bins receive almost no energy. Oracle: transformers.js 4.2.0.',
  source: '2-two-speakers-en.wav through highpass=300,lowpass=3400, samples [48000,64000)',
  dims: f.dims,
  features: data.map((x) => Math.round(x * 1e6) / 1e6),
  audio: Array.from(audio).map((x) => Math.round(x * 1e6) / 1e6),
}));
console.log('wrote test/fixtures/fbank-bandlimited.json');
