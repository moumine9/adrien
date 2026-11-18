import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node22',
  fixedExtension: false,
  deps: { alwaysBundle: [/^@adrien\//] },
  dts: false,
  clean: true,
});
