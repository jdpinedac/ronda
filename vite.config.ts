import { defineConfig } from 'vitest/config';

// GitHub Pages serves the project at /<repo>/. Override with BASE_PATH when
// deploying elsewhere (a custom domain wants '/').
const base = process.env.BASE_PATH ?? '/ronda/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        analyze: 'analyze.html',
      },
    },
  },
  worker: { format: 'es' },
  // onnxruntime-web loads its .wasm binaries at runtime from public/ort/,
  // populated by scripts/sync-ort-wasm.mjs. Keep them out of the bundle.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  server: {
    headers: {
      // Cross-origin isolation enables multi-threaded WASM in development.
      // GitHub Pages cannot set these, so production relies on coi-serviceworker.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
