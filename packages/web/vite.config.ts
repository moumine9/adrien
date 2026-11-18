import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { mockApi } from './mock/plugin.ts';

/** Where `adrien serve` listens by default; `pnpm dev` proxies `/api` to it. */
const API_TARGET = process.env.ADRIEN_API ?? 'http://127.0.0.1:4310';

export default defineConfig(({ mode }) => {
  const mock = mode === 'mock';
  return {
    // Relative, so the CLI can serve the built folder from wherever it copies it.
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      mock &&
        mockApi({
          variant: process.env.ADRIEN_MOCK,
          latencyMs: process.env.ADRIEN_MOCK_LATENCY ? Number(process.env.ADRIEN_MOCK_LATENCY) : undefined,
        }),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: mock ? {} : { proxy: { '/api': { target: API_TARGET, changeOrigin: false } } },
    preview: mock ? {} : { proxy: { '/api': { target: API_TARGET, changeOrigin: false } } },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // Stable file names: the CLI copies this folder as is and the server needs no manifest.
      rolldownOptions: {
        output: {
          entryFileNames: 'assets/app.js',
          chunkFileNames: 'assets/[name].js',
          assetFileNames: 'assets/[name][extname]',
        },
      },
    },
  };
});
