import { defineConfig } from '@playwright/test';

/**
 * End-to-end smoke tests against the built site, served the way GitHub
 * Pages serves it (no COOP/COEP headers; coi-serviceworker fills in). They
 * load the real models and analyse the bundled example, so one run takes
 * about a minute on a CI runner. Run `npm run build` first.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 30_000 },
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: 'http://localhost:4173/ronda/',
    browserName: 'chromium',
    viewport: { width: 390, height: 844 },
  },
  webServer: {
    command: 'npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173/ronda/',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
