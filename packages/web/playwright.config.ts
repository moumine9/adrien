import { defineConfig } from '@playwright/test';

const PORT = 5199;

/**
 * Browser checks against the Vite dev server with the mock API. They use the system Chrome, so no browser is
 * downloaded. Run `pnpm --filter @adrien/web test:e2e` (smoke) or `shots` (screenshots).
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './.shots/.results',
  reporter: 'list',
  fullyParallel: true,
  use: { baseURL: `http://127.0.0.1:${PORT}`, channel: 'chrome' },
  webServer: {
    command: `pnpm exec vite --mode mock --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { ADRIEN_MOCK_LATENCY: '0' },
  },
});
