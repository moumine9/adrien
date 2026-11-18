// Puts the built web visualizer (packages/web/dist) next to the bundle, as dist/web, for `adrien serve`. Without a web
// build there is nothing to copy: the package still works, and `adrien serve` serves the API alone.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../../web/dist', import.meta.url));
const to = fileURLToPath(new URL('../dist/web', import.meta.url));

rmSync(to, { recursive: true, force: true });
if (existsSync(from)) {
  cpSync(from, to, { recursive: true });
  console.log('copy-web: packages/web/dist copied to dist/web');
} else {
  console.log('copy-web: no packages/web/dist, so adrien serve will serve the API without the web visualizer');
}
