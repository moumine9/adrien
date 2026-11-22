import { defineConfig } from '@playwright/test';

const PORT = 5199;

/**
 * Browser checks against the Vite dev server with the mock API. They use the system Chrome, so no browser is
 * downloaded. `pnpm --filter @adrien/web test:e2e` (smoke and layout) runs in CI as the `e2e` job; `shots` (screenshots)
 * is run by hand.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './.shots/.results',
  reporter: 'list',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // `e2e` is a required check: one retry in CI keeps a single flaky run from blocking a merge (a test that fails twice still fails).
  retries: process.env.CI ? 1 : 0,
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: 'chrome', trace: 'retain-on-failure' },
  webServer: {
    command: `pnpm exec vite --mode mock --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { ADRIEN_MOCK_LATENCY: '0' },
  },
});
