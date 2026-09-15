import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Measurement, not tests: nothing here asserts. Run with `npm run bench`.
export default defineConfig({
  root: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  test: {
    environment: 'node',
    include: ['bench/*.report.ts'],
    testTimeout: 0,
    hookTimeout: 0,
    reporters: [['default', { summary: false }]],
  },
});
