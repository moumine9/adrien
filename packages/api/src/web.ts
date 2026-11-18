import { readFile, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isInside } from '@adrien/core';
import type { Context } from 'hono';
import { getMimeType } from 'hono/utils/mime';

const NOT_BUILT =
  'The Adrien web visualizer is not part of this build. The API is served at /api/meta (see docs/api.md).\n';

/** A built web app: its real root and its index.html, which must be a file inside that root. */
async function builtApp(webDir: string): Promise<{ root: string; index: string } | null> {
  let root: string;
  try {
    root = await realpath(webDir);
  } catch {
    return null;
  }
  const index = await fileIn(root, ['index.html']);
  return index ? { root, index } : null;
}

/**
 * The URL path as path segments, or null when one is not valid percent-encoding or could leave the web root: an
 * encoded `/` or `\`, a NUL, or a dot segment (URL parsing resolves plain `..` before it gets here).
 */
function segmentsOf(pathname: string): string[] | null {
  const segments: string[] = [];
  for (const raw of pathname.split('/')) {
    if (!raw) continue;
    let segment: string;
    try {
      segment = decodeURIComponent(raw);
    } catch {
      return null;
    }
    if (segment === '.' || segment === '..' || /[/\\\0]/.test(segment)) return null;
    segments.push(segment);
  }
  return segments;
}

/** The file a path names, once symlinks are resolved, only if it is a regular file inside the web root. */
async function fileIn(root: string, segments: string[]): Promise<string | null> {
  try {
    const real = await realpath(join(root, ...segments));
    return isInside(real, root) && (await stat(real)).isFile() ? real : null;
  } catch {
    return null;
  }
}

async function send(c: Context, file: string): Promise<Response> {
  const body = new Uint8Array(await readFile(file));
  return c.body(body, 200, {
    'Content-Type': getMimeType(file) ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  });
}

/** Serves the built web visualizer, with `index.html` for client-side routes (paths without an extension). */
export function serveWeb(webDir: string | undefined): (c: Context) => Promise<Response> {
  return async (c) => {
    const app = webDir === undefined ? null : await builtApp(webDir);
    if (!app) return c.text(NOT_BUILT, 404);
    const segments = segmentsOf(new URL(c.req.url).pathname);
    if (!segments) return c.text('Bad request path.\n', 400);
    const file = await fileIn(app.root, segments);
    if (file) return send(c, file);
    if (!(segments.at(-1) ?? '').includes('.')) return send(c, app.index);
    return c.text('Not found.\n', 404);
  };
}
