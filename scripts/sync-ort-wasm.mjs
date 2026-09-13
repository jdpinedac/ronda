// Copies onnxruntime-web's WASM binary into public/ort/ so it is served from
// our own origin rather than a CDN. Run automatically before dev and build.
//
// Only the SIMD+threads build is copied (13.3 MB raw, ~3.4 MB gzipped). The
// .jsep variant needed for WebGPU is deliberately skipped: it is twice the
// size, and ADR 0001 measured WASM at ~3% of a core, leaving nothing for
// WebGPU to improve. Add it here if that ever changes.
import { cp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const src = join(dirname(require.resolve('onnxruntime-web')), '..', 'dist');
const dest = new URL('../public/ort/', import.meta.url).pathname;
const WANTED = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs'];

await mkdir(dest, { recursive: true });
for (const f of WANTED) await cp(join(src, f), join(dest, f));
console.log(`synced ${WANTED.length} onnxruntime-web runtime files -> public/ort/`);
