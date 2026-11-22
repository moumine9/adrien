import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineProject } from 'vitest/config';

export default defineProject({
  plugins: [react()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    name: 'web',
    environment: 'jsdom',
    globals: true,
    exclude: ['e2e/**', '**/node_modules/**'],
    include: ['src/**/*.test.{ts,tsx}', 'mock/**/*.test.ts'],
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20000,
  },
});
