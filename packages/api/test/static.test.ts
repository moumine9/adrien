import { mkdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE } from '@adrien/core';
import { configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { createApp } from '../src/app.ts';
import type { ApiError } from '../src/contract.ts';

const INDEX = '<!doctype html><title>Adrien</title><div id="root"></div>\n';

/** A built web app in <tmp>/web, next to a file it must never serve. */
function site() {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    'secret.txt': 'do not serve\n',
    'outside/secret.txt': 'do not serve either\n',
    'web/index.html': INDEX,
    'web/assets/app.js': 'console.log("adrien");\n',
    'web/assets/app.css': 'body { margin: 0; }\n',
    'web/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
    'web/data.unknownext': 'raw',
  });
  const webDir = join(root, 'web');
  return { root, webDir, app: createApp({ cwd: root, env: { ADRIEN_HOME: tmpDir() }, webDir }) };
}

describe('serving the web app', () => {
  test('/ is index.html', async () => {
    const res = await site().app.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe(INDEX);
  });

  test.each([
    ['/assets/app.js', 'text/javascript; charset=utf-8', 'console.log("adrien");\n'],
    ['/assets/app.css', 'text/css; charset=utf-8', 'body { margin: 0; }\n'],
    ['/favicon.svg', 'image/svg+xml; charset=utf-8', '<svg xmlns="http://www.w3.org/2000/svg"/>\n'],
    ['/index.html', 'text/html; charset=utf-8', INDEX],
    ['/data.unknownext', 'application/octet-stream', 'raw'],
  ])('%s is served as %s', async (path, type, text) => {
    const res = await site().app.request(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe(type);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(await res.text()).toBe(text);
  });

  test.each(['/adrs/ADR-0001', '/graph', '/assets', '/assets/'])(
    'client route %s falls back to index.html',
    async (path) => {
      const res = await site().app.request(path);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(INDEX);
    },
  );

  test('a missing file with an extension is a 404, not the app', async () => {
    const res = await site().app.request('/assets/missing.js');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('<div id="root">');
  });

  test('an unknown /api path is a JSON 404, never the app', async () => {
    const res = await site().app.request('/api/nope');
    expect(res.status).toBe(404);
    expect(((await res.json()) as ApiError).error.code).toBe('NOT_FOUND');
  });

  test('HEAD answers without a body', async () => {
    const res = await site().app.request('/assets/app.js', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });
});

describe('path traversal', () => {
  // `..` and `%2e%2e` segments never reach the server: URL parsing resolves them first, inside the web root.
  test.each(['/../secret.txt', '/%2e%2e/secret.txt', '/assets/%2E%2E/%2e%2e/secret.txt'])(
    '%s is resolved inside the web root',
    async (path) => {
      const res = await site().app.request(path);
      expect(await res.text()).not.toContain('do not serve');
    },
  );

  test.each([
    '/..%2fsecret.txt',
    '/assets%2f..%2f..%2fsecret.txt',
    '/..%5csecret.txt',
    '/assets/..%5c..%5csecret.txt',
    '/%2e%2e%2fsecret.txt',
    '/%2Fetc%2Fpasswd',
    '/index.html%00.js',
    '/C:%5cWindows%5cwin.ini',
    '/%E0%A4%A',
  ])('%s is refused with 400', async (path) => {
    const res = await site().app.request(path);
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain('do not serve');
  });

  test('a symlink out of the web root is not followed', async () => {
    const { root, webDir, app } = site();
    // A junction needs no privilege on Windows; elsewhere the type is ignored.
    symlinkSync(join(root, 'outside'), join(webDir, 'leak'), 'junction');
    const res = await app.request('/leak/secret.txt');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('do not serve');
  });

  test('a symlink that stays inside the web root is followed', async () => {
    const { webDir, app } = site();
    symlinkSync(join(webDir, 'assets'), join(webDir, 'static'), 'junction');
    const res = await app.request('/static/app.js');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('console.log("adrien");\n');
  });

  test('a web root reached through a symlink still serves its files', async () => {
    const { root } = site();
    symlinkSync(join(root, 'web'), join(root, 'web-link'), 'junction');
    const app = createApp({ cwd: root, env: { ADRIEN_HOME: tmpDir() }, webDir: join(root, 'web-link') });
    expect(await (await app.request('/assets/app.js')).text()).toBe('console.log("adrien");\n');
  });
});

describe('without a built web app', () => {
  function bare(webDir?: (root: string) => string) {
    const root = tmpDir();
    writeFiles(root, { [CONFIG_FILE]: configYaml() });
    return createApp({ cwd: root, env: { ADRIEN_HOME: tmpDir() }, webDir: webDir?.(root) });
  }

  test.each([
    ['no web directory is given', undefined],
    ['the web directory does not exist', (root: string) => join(root, 'missing')],
    [
      'the web directory is empty',
      (root: string) => {
        mkdirSync(join(root, 'web'));
        return join(root, 'web');
      },
    ],
    [
      'index.html is not a file',
      (root: string) => {
        mkdirSync(join(root, 'web/index.html'), { recursive: true });
        return join(root, 'web');
      },
    ],
  ])('/ says so in plain text when %s', async (_label, webDir) => {
    const app = bare(webDir);
    const res = await app.request('/');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    expect(await res.text()).toContain('/api/meta');
    // The API itself still works.
    expect((await app.request('/api/meta')).status).toBe(200);
  });
});
