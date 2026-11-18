import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    testTimeout: 20000,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: ['packages/*/test/**/*.test.ts'],
          exclude: [...configDefaults.exclude, 'packages/web/**'],
        },
      },
      // The web visualizer runs its own config: jsdom, React and the `@/` alias.
      './packages/web/vitest.config.ts',
    ],
    coverage: {
      provider: 'v8',
      // The core is the product's logic and is held to 100%; the CLI, MCP server and API are thin layers over it.
      include: ['packages/core/src/**/*.ts'],
      reporter: ['text', 'json-summary'],
    },
  },
});
