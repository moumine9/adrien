/**
 * Builds the project site into site-dist/, ready for GitHub Pages: the landing page (site/), the docs rendered from the
 * repository's Markdown (docs/, see scripts/site/docs.mjs), and the live demo of the web visualizer with its mock data.
 * This script only arranges the parts; the pieces do their own work.
 */
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderDocs } from './site/docs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const webDir = join(root, 'packages', 'web');
const out = join(root, 'site-dist');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    throw new Error(
      `\`${[command, ...args].join(' ')}\` failed${result.status === null ? '' : ` with ${result.status}`}`,
    );
  }
}

// The demo: the web visualizer built with its mock API installed (see packages/web/src/lib/demo.ts).
run('pnpm', ['run', 'build:demo'], webDir);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The landing page and its stylesheet, as they are.
cpSync(join(root, 'site'), out, { recursive: true });

// The brand mark, copied from the one source every surface uses.
cpSync(join(root, 'assets', 'icon.svg'), join(out, 'icon.svg'));

// The same self-hosted Archivo the web app uses (latin subset), from its installed package.
const fontFile = createRequire(join(webDir, 'package.json')).resolve(
  '@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2',
);
mkdirSync(join(out, 'fonts'), { recursive: true });
cpSync(fontFile, join(out, 'fonts', 'archivo-latin-wdth-normal.woff2'));

cpSync(join(webDir, 'dist-demo'), join(out, 'demo'), { recursive: true });

const pages = renderDocs({ sourceRoot: root, outDir: join(out, 'docs') });

for (const required of ['index.html', 'demo/index.html', 'docs/index.html']) {
  if (!existsSync(join(out, required))) throw new Error(`The site is missing ${required}`);
}
console.log(`site-dist: landing page, demo, and ${pages.length} docs pages (${pages.join(', ')})`);
