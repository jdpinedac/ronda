// Node stand-in for src/engine/models.ts: same contract, ORT node build,
// weights read from public/models. Also records every embedding produced, in
// order, so the report can look at the vectors diarize() clusters on.
import * as ort from 'onnxruntime-web';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const SEGMENTATION_CLASSES = 7;
export const EMBEDDING_DIM = 256;
export const SAMPLE_RATE = 16000;

export const captured: Float32Array[] = [];
export const resetCaptured = () => { captured.length = 0; };

let loading: Promise<{ segmentation: ort.InferenceSession; embedding: ort.InferenceSession }> | null = null;
export function loadModels() {
  loading ??= (async () => {
    ort.env.wasm.numThreads = 1;
    const opts: ort.InferenceSession.SessionOptions = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
    const dir = `${ROOT}/public/models`;
    const segmentation = await ort.InferenceSession.create(new Uint8Array(readFileSync(`${dir}/segmentation-int8.onnx`)), opts);
    const embedding = await ort.InferenceSession.create(new Uint8Array(readFileSync(`${dir}/embedding-int8.onnx`)), opts);
    return { segmentation, embedding };
  })();
  return loading;
}
export async function runSegmentation(session: ort.InferenceSession, window: Float32Array): Promise<Float32Array> {
  const out = await session.run({ input_values: new ort.Tensor('float32', window, [1, 1, window.length]) });
  return out['logits']!.data as Float32Array;
}
export async function runEmbedding(session: ort.InferenceSession, features: Float32Array, numFrames: number, numBins: number): Promise<Float32Array> {
  const out = await session.run({ input_features: new ort.Tensor('float32', features, [1, numFrames, numBins]) });
  const v = out['last_hidden_state']!.data as Float32Array;
  let n = 0; for (let i = 0; i < v.length; i++) n += v[i]! * v[i]!;
  n = Math.sqrt(n);
  captured.push(Float32Array.from(v, (x) => x / n));
  return v;
}
export function readAudio16k(path: string): Float32Array {
  const buf = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', '16000', 'pipe:1'], { maxBuffer: 1 << 30 });
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}
