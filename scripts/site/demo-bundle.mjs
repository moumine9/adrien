/**
 * The demo's mock API is in the demo build only (packages/web/src/main.tsx). `adrien serve` ships the normal web build, so
 * a demo chunk there would put the mock into the product. This module has no side effects on import.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** Throws unless `distDir` holds a normal web build (index.html and assets/app.js) and no demo chunk (assets/demo.js). */
export function assertNoDemoBundle(distDir) {
  if (!existsSync(join(distDir, 'index.html')) || !existsSync(join(distDir, 'assets', 'app.js'))) {
    throw new Error(
      `No normal web build in ${distDir}: expected index.html and assets/app.js. Build packages/web first (pnpm run build).`,
    );
  }
  const demo = join(distDir, 'assets', 'demo.js');
  if (existsSync(demo)) {
    throw new Error(
      `${demo} is in the normal web build, so adrien serve would ship the demo mock. Keep the demo import in ` +
        `packages/web/src/main.tsx behind import.meta.env.MODE === 'demo'.`,
    );
  }
}
