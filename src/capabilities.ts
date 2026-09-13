/** What this browser can actually do. Checked before anything else runs. */

export interface Capabilities {
  wasm: boolean;
  audioWorklet: boolean;
  microphone: boolean;
  crossOriginIsolated: boolean;
  webgpu: boolean;
  threads: number;
}

export function detectCapabilities(): Capabilities {
  return {
    wasm: typeof WebAssembly === 'object',
    audioWorklet: typeof AudioWorkletNode !== 'undefined',
    microphone: typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia,
    // Without cross-origin isolation there is no SharedArrayBuffer, so ONNX
    // Runtime falls back to a single thread. See ADR 0001.
    crossOriginIsolated: typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated,
    webgpu: typeof navigator !== 'undefined' && 'gpu' in navigator,
    threads: typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency ?? 1) : 1,
  };
}

/** Ronda cannot run at all without these. */
export function isSupported(c: Capabilities): boolean {
  return c.wasm && c.audioWorklet && c.microphone;
}
