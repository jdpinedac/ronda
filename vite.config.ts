import { defineConfig } from 'vitest/config';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// GitHub Pages serves the project at /<repo>/. Override with BASE_PATH when
// deploying elsewhere (a custom domain wants '/').
const base = process.env.BASE_PATH ?? '/ronda/';

export default defineConfig({
  base,
  // Shown in every page's footer, so a tester can say which build they used.
  define: { __RONDA_VERSION__: JSON.stringify(version) },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        index: 'index.html',
        analyze: 'analyze.html',
        live: 'live.html',
      },
    },
  },
  worker: { format: 'es' },
  // onnxruntime-web is imported lazily from its /wasm subpath (see
  // src/engine/models.ts); pre-bundling it would pull the whole package in.
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
    // The whole-meeting tests cluster 227 real embeddings; under coverage
    // instrumentation that takes a minute.
    testTimeout: 180_000,
    coverage: {
      provider: 'v8',
      // Everything that ships, including the page scripts nothing tests yet:
      // the number should say what is not covered, not hide it.
      include: ['src/**/*.ts'],
      reporter: ['text', 'text-summary'],
    },
  },
});
