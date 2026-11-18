import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts'],
    globals: true,
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      // The core is the product's logic and is held to 100%; the CLI, MCP server and API are thin layers over it.
      include: ['packages/core/src/**/*.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
