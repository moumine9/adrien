import { request } from 'node:http';
import { join } from 'node:path';
import { CONFIG_FILE } from '@adrien/core';
import { configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import type { MetaResponse } from '../src/contract.ts';
import { DEFAULT_HOST, DEFAULT_PORT, type ServerHandle, startServer } from '../src/server.ts';

function log(): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), 'web/index.html': '<!doctype html><title>Adrien</title>\n' });
  return root;
}

async function start(cwd: string, opts: { host?: string; port?: number } = {}): Promise<ServerHandle> {
  const server = await startServer({ cwd, env: { ADRIEN_HOME: tmpDir() }, version: '1.2.3', port: 0, ...opts });
  onTestFinished(() => server.close());
  return server;
}

/** A raw request, so the Host header can be forged (fetch sets its own). */
function rawGet(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { Host: host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on('error', reject);
    req.end();
  });
}

test('defaults to 127.0.0.1:4310', () => {
  expect([DEFAULT_HOST, DEFAULT_PORT]).toEqual(['127.0.0.1', 4310]);
});

test('listens on 127.0.0.1 by default and answers over a real socket', async () => {
  const root = log();
  const server = await startServer({ cwd: root, env: { ADRIEN_HOME: tmpDir() }, version: '1.2.3', port: 0 });
  onTestFinished(() => server.close());
  expect(server.address).toBe('127.0.0.1');
  expect(server.port).toBeGreaterThan(0);
  expect(server.url).toBe(`http://127.0.0.1:${server.port}`);

  const res = await fetch(`${server.url}/api/meta`);
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  expect(((await res.json()) as MetaResponse).product).toBe('acme');
});

test('serves the web app from webDir, client routes included', async () => {
  const root = log();
  const server = await startServer({ cwd: root, env: { ADRIEN_HOME: tmpDir() }, port: 0, webDir: join(root, 'web') });
  onTestFinished(() => server.close());
  expect(await (await fetch(`${server.url}/graph`)).text()).toContain('<title>Adrien</title>');
});

test('refuses a forged Host header on the wire', async () => {
  const server = await start(log());
  expect(await rawGet(`${server.url}/api/meta`, 'evil.example')).toBe(403);
  expect(await rawGet(`${server.url}/api/meta`, `localhost:${server.port}`)).toBe(200);
});

test('an IPv6 host is bracketed in the URL', async () => {
  let server: ServerHandle;
  try {
    server = await start(log(), { host: '::1' });
  } catch {
    return; // no IPv6 loopback on this machine
  }
  expect(server.url).toBe(`http://[::1]:${server.port}`);
  expect((await fetch(`${server.url}/api/meta`)).status).toBe(200);
});

test('close() stops listening, even with a connection kept alive', async () => {
  const root = log();
  const server = await startServer({ cwd: root, env: { ADRIEN_HOME: tmpDir() }, port: 0 });
  await fetch(`${server.url}/api/meta`, { keepalive: true });
  await server.close();
  await expect(fetch(`${server.url}/api/meta`)).rejects.toThrow();
});

test('a port in use rejects instead of hanging', async () => {
  const first = await start(log());
  await expect(start(log(), { port: first.port })).rejects.toMatchObject({ code: 'EADDRINUSE' });
});
