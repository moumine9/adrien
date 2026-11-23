import { defineConfig } from '@playwright/test';

const PORT = 5199;
// The `workspaces` mock variant (two workspaces) runs on its own port, for the workspaces spec only.
const WORKSPACES_PORT = 5200;
const WORKSPACES_SPEC = /workspaces\.spec\.ts$/;

/**
 * Browser checks against the Vite dev server with the mock API. They use the system Chrome, so no browser is
 * downloaded. `pnpm --filter @adrien/web test:e2e` (smoke, layout and workspaces) runs in CI as the `e2e` job; `shots`
 * (screenshots) is run by hand.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './.shots/.results',
  reporter: 'list',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // `e2e` is a required check: one retry in CI keeps a single flaky run from blocking a merge (a test that fails twice still fails).
  retries: process.env.CI ? 1 : 0,
  use: { channel: 'chrome', trace: 'retain-on-failure' },
  projects: [
    {
      name: 'single',
      testIgnore: WORKSPACES_SPEC,
      use: { baseURL: `http://127.0.0.1:${PORT}` },
    },
    {
      name: 'workspaces',
      testMatch: WORKSPACES_SPEC,
      use: { baseURL: `http://127.0.0.1:${WORKSPACES_PORT}` },
    },
  ],
  webServer: [
    {
      command: `pnpm exec vite --mode mock --host 127.0.0.1 --port ${PORT} --strictPort`,
      url: `http://127.0.0.1:${PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { ADRIEN_MOCK_LATENCY: '0' },
    },
    {
      command: `pnpm exec vite --mode mock --host 127.0.0.1 --port ${WORKSPACES_PORT} --strictPort`,
      url: `http://127.0.0.1:${WORKSPACES_PORT}`,
      reuseExistingServer: !process.env.CI,
      env: { ADRIEN_MOCK_LATENCY: '0', ADRIEN_MOCK: 'workspaces' },
    },
  ],
});
