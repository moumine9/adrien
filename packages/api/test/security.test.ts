import { CONFIG_FILE } from '@adrien/core';
import { configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { type ApiOptions, createApp } from '../src/app.ts';
import type { ApiError } from '../src/contract.ts';

function app(opts: Partial<ApiOptions> = {}) {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml() });
  return createApp({ cwd: root, env: { ADRIEN_HOME: tmpDir() }, ...opts });
}

const corsHeaders = (res: Response) => [...res.headers.keys()].filter((k) => k.startsWith('access-control-'));

describe('Host header (DNS-rebinding defence)', () => {
  test.each(['localhost', 'localhost:4310', 'LocalHost:4310', '127.0.0.1', '127.0.0.1:4310', '[::1]', '[::1]:4310'])(
    '%s is served',
    async (host) => {
      const res = await app().request('/api/meta', { headers: { Host: host } });
      expect(res.status).toBe(200);
    },
  );

  test.each([
    'evil.example',
    'evil.example:4310',
    'localhost.evil.example',
    '127.0.0.1.evil.example:4310',
    '[::2]:4310',
    '[::1',
    'localhost:4310:1',
    '',
  ])('"%s" is refused with 403', async (host) => {
    const res = await app().request('/api/meta', { headers: { Host: host } });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiError;
    expect(body.error.code).toBe('FORBIDDEN_HOST');
  });

  test('without a Host header, the host of the URL is checked', async () => {
    expect((await app().request('http://evil.example/api/meta')).status).toBe(403);
    expect((await app().request('http://127.0.0.1:4310/api/meta')).status).toBe(200);
  });

  test('the static files are guarded too', async () => {
    const res = await app().request('/', { headers: { Host: 'evil.example' } });
    expect(res.status).toBe(403);
  });

  test('the host the server was started with is allowed', async () => {
    const named = app({ host: 'adrien.test' });
    expect((await named.request('/api/meta', { headers: { Host: 'adrien.test:4310' } })).status).toBe(200);
    expect((await named.request('/api/meta', { headers: { Host: 'other.test:4310' } })).status).toBe(403);
    const v6 = app({ host: '::2' });
    expect((await v6.request('/api/meta', { headers: { Host: '[::2]:4310' } })).status).toBe(200);
    const bracketed = app({ host: '[::2]' });
    expect((await bracketed.request('/api/meta', { headers: { Host: '[::2]' } })).status).toBe(200);
  });
});

describe('methods', () => {
  test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])('%s is refused with 405', async (method) => {
    const res = await app().request('/api/meta', { method, headers: { Origin: 'http://evil.example' } });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
    expect(((await res.json()) as ApiError).error.code).toBe('METHOD_NOT_ALLOWED');
    expect(corsHeaders(res)).toEqual([]);
  });

  test('a write to a static path is refused too', async () => {
    expect((await app().request('/index.html', { method: 'POST' })).status).toBe(405);
  });

  test('HEAD answers like GET, without a body', async () => {
    const res = await app().request('/api/meta', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^application\/json/);
    expect(await res.text()).toBe('');
  });
});

describe('headers', () => {
  test('no CORS headers, even for a cross-origin request', async () => {
    const res = await app().request('/api/meta', { headers: { Origin: 'http://evil.example' } });
    expect(res.status).toBe(200);
    expect(corsHeaders(res)).toEqual([]);
  });

  test.each([
    ['a success', '/api/meta', {}, 200],
    ['a 404', '/api/nope', {}, 404],
    ['a refused host', '/api/meta', { headers: { Host: 'evil.example' } }, 403],
    ['a refused method', '/api/meta', { method: 'POST' }, 405],
    ['a 500', '/api/adrs/x', { cwdWithoutLog: true }, 500],
  ])('API responses are never cached: %s', async (_label, path, init, status) => {
    const { cwdWithoutLog, ...requestInit } = init as RequestInit & { cwdWithoutLog?: boolean };
    const target = cwdWithoutLog ? createApp({ cwd: tmpDir(), env: { ADRIEN_HOME: tmpDir() } }) : app();
    const res = await target.request(path, requestInit);
    expect(res.status).toBe(status);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('serving beyond this machine', () => {
  test('a host named in allowedHosts is served, with or without a port, and others stay refused', async () => {
    const a = app({ allowedHosts: ['adr.example.com'] });
    expect((await a.request('/api/meta', { headers: { Host: 'adr.example.com' } })).status).toBe(200);
    expect((await a.request('/api/meta', { headers: { Host: 'ADR.example.com:8443' } })).status).toBe(200);
    expect((await a.request('/api/meta', { headers: { Host: 'adr.example.com.evil.example' } })).status).toBe(403);
    expect((await a.request('/api/meta', { headers: { Host: 'other.example' } })).status).toBe(403);
  });

  test('the refusal tells how to allow a host', async () => {
    const body = (await (await app().request('/api/meta', { headers: { Host: 'evil.example' } })).json()) as ApiError;
    expect(body.error.message).toContain('--allowed-host');
  });
});

describe('access token', () => {
  const basic = (user: string, pass: string) => `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

  test('without a token configured, no credentials are asked for', async () => {
    expect((await app().request('/api/meta')).status).toBe(200);
  });

  test('a request without credentials is refused with 401 and a Basic challenge', async () => {
    const res = await app({ token: 's3cret' }).request('/api/meta');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic realm="Adrien"/);
    expect(((await res.json()) as ApiError).error.code).toBe('UNAUTHORIZED');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  test.each([
    ['a Bearer token', 'Bearer s3cret'],
    ['Basic with the token as the password', basic('anyone', 's3cret')],
    ['Basic with an empty user name', basic('', 's3cret')],
  ])('%s is accepted', async (_name, authorization) => {
    const res = await app({ token: 's3cret' }).request('/api/meta', { headers: { Authorization: authorization } });
    expect(res.status).toBe(200);
  });

  test.each([
    ['a wrong Bearer token', 'Bearer s3cre'],
    ['a longer token', 'Bearer s3cret!'],
    ['a wrong Basic password', basic('anyone', 'nope')],
    ['the token as the user name only', basic('s3cret', '')],
    ['an unknown scheme', 'Token s3cret'],
    ['malformed Basic', 'Basic !!!'],
    ['an empty header', ''],
  ])('%s is refused', async (_name, authorization) => {
    const res = await app({ token: 's3cret' }).request('/api/meta', { headers: { Authorization: authorization } });
    expect(res.status).toBe(401);
  });

  test('the web files are behind the token too', async () => {
    expect((await app({ token: 's3cret' }).request('/')).status).toBe(401);
  });

  test('the Host check comes before the token, so a rebinding page learns nothing', async () => {
    const res = await app({ token: 's3cret' }).request('/api/meta', { headers: { Host: 'evil.example' } });
    expect(res.status).toBe(403);
  });

  test('/healthz answers ok without credentials and reveals nothing', async () => {
    const res = await app({ token: 's3cret' }).request('/healthz');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok\n');
    expect((await app({ token: 's3cret' }).request('/healthz', { headers: { Host: 'evil.example' } })).status).toBe(
      403,
    );
  });
});
