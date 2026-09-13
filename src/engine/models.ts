/**
 * Loading and running the two ONNX models.
 *
 * Weights and the WASM runtime are both served from our own origin: the app
 * must keep working under cross-origin isolation and must not depend on a third
 * party staying available. scripts/fetch-models.mjs fetches the weights at
 * build time, verifying their checksums; the runtime comes from the
 * onnxruntime-web/wasm subpath, which the bundler resolves and emits — the
 * plain entry point drags in the 28 MB WebGPU binary we have no use for.
 */
import type * as OrtTypes from 'onnxruntime-web/wasm';

// The runtime is imported lazily. A static import makes every module that
// transitively depends on this one wait for megabytes of WASM glue before it
// runs, which in practice meant the page's buttons existed for seconds before
// their event listeners were attached — they looked ready and did nothing.
type Ort = typeof OrtTypes;
let ortPromise: Promise<Ort> | null = null;
const getOrt = (): Promise<Ort> => (ortPromise ??= import('onnxruntime-web/wasm'));

export const SEGMENTATION_CLASSES = 7;
export const EMBEDDING_DIM = 256;
export const SAMPLE_RATE = 16000;

export interface LoadedModels {
  segmentation: OrtTypes.InferenceSession;
  embedding: OrtTypes.InferenceSession;
}

export interface LoadProgress {
  /** 0..1 across both models. */
  fraction: number;
  label: string;
}

function base(): string {
  return import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
}

/** Generous on a slow connection, but never an indefinite blank wait. */
const LOAD_TIMEOUT_MS = 120_000;

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${what} took too long to load`)), LOAD_TIMEOUT_MS)),
  ]);
}

let loading: Promise<LoadedModels> | null = null;

/** Loads both models once; concurrent callers share the same download. */
export function loadModels(onProgress?: (p: LoadProgress) => void): Promise<LoadedModels> {
  loading ??= (async () => {
    const ort = await getOrt();
    // Single-threaded, deliberately.
    //
    // When cross-origin isolation comes from coi-serviceworker rather than real
    // response headers — which is our situation on GitHub Pages — ORT's worker
    // threads never start, and session creation hangs forever instead of
    // failing. Measured on the deployed site: one thread creates a session in
    // 0.3 s, four threads still had not returned after 15 s. crossOriginIsolated
    // reports true either way, so it cannot be used to tell the two apart.
    ort.env.wasm.numThreads = 1;

    const opts: OrtTypes.InferenceSession.SessionOptions = {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    };

    onProgress?.({ fraction: 0, label: 'segmentation' });
    const segmentation = await withTimeout(
      ort.InferenceSession.create(`${base()}models/segmentation-int8.onnx`, opts),
      'segmentation model');

    onProgress?.({ fraction: 0.2, label: 'embedding' });
    const embedding = await withTimeout(
      ort.InferenceSession.create(`${base()}models/embedding-int8.onnx`, opts),
      'embedding model');

    onProgress?.({ fraction: 1, label: 'ready' });
    return { segmentation, embedding };
  })().catch((err: unknown) => {
    loading = null; // let the user retry rather than be stuck with a dead promise
    throw err;
  });
  return loading;
}

/** Runs segmentation over one window of audio, returning raw per-frame logits. */
export async function runSegmentation(
  session: OrtTypes.InferenceSession,
  window: Float32Array,
): Promise<Float32Array> {
  const ort = await getOrt();
  const input = new ort.Tensor('float32', window, [1, 1, window.length]);
  const out = await session.run({ input_values: input });
  const logits = out['logits'];
  if (!logits) throw new Error('segmentation model produced no logits');
  return logits.data as Float32Array;
}

/** Runs the embedding model over precomputed fbank features. */
export async function runEmbedding(
  session: OrtTypes.InferenceSession,
  features: Float32Array,
  numFrames: number,
  numBins: number,
): Promise<Float32Array> {
  const ort = await getOrt();
  const input = new ort.Tensor('float32', features, [1, numFrames, numBins]);
  const out = await session.run({ input_features: input });
  const emb = out['last_hidden_state'];
  if (!emb) throw new Error('embedding model produced no output');
  return emb.data as Float32Array;
}
