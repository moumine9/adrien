import { createMockFetch } from '../../mock/handler.ts';
import { ApiRequestError, api, apiBase, isClientError } from './api.ts';
import { EMPTY_FILTERS } from './filters.ts';

const calls: string[] = [];

function stubFetch(impl: typeof fetch) {
  calls.length = 0;
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return impl(input, init);
  }) as typeof fetch);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api', () => {
  it('calls relative /api URLs and returns the parsed JSON', async () => {
    stubFetch(createMockFetch());
    const meta = await api.meta(undefined);
    expect(meta.product).toBe('Adrien');
    expect(calls).toEqual(['/api/meta']);
  });

  it('passes the decision filters as query parameters', async () => {
    stubFetch(createMockFetch());
    await api.adrs(undefined, { ...EMPTY_FILTERS, tag: ['security'], status: ['accepted'], pending: true, q: 'vault' });
    expect(calls[0]).toBe('/api/adrs?q=vault&status=accepted&tag=security&pending=1');
  });

  it('encodes ids and repeats path for /api/for', async () => {
    stubFetch(createMockFetch());
    await api.adr(undefined, 'ADR 1/2').catch(() => undefined);
    await api.forFiles(undefined, ['src/a b.ts', 'src/c.ts']);
    await api.check(undefined, true);
    await api.check(undefined, false);
    expect(calls).toEqual([
      '/api/adrs/ADR%201%2F2',
      '/api/for?path=src%2Fa+b.ts&path=src%2Fc.ts',
      '/api/check?lint=1',
      '/api/check',
    ]);
  });

  it('turns an API error body into an ApiRequestError with its message', async () => {
    stubFetch(createMockFetch());
    const err = await api.adr(undefined, 'ADR-9999').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 404, code: 'ADR_NOT_FOUND', message: 'No decision with id ADR-9999.' });
    expect(isClientError(err)).toBe(true);
  });

  it('explains a failure whose body is not JSON', async () => {
    stubFetch(async () => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }));
    const err = await api.meta(undefined).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'HTTP_ERROR' });
    expect((err as Error).message).toContain('502');
    expect(isClientError(err)).toBe(false);
  });

  it('explains a success that is not JSON (an HTML fallback instead of the API)', async () => {
    stubFetch(async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const err = await api.graph(undefined).catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('explains a network failure', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await api.meta(undefined).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
    expect((err as Error).message).toMatch(/adrien serve/);
  });

  it('lets an abort through untouched', async () => {
    stubFetch(async () => {
      throw new DOMException('Aborted', 'AbortError');
    });
    const err = await api.meta(undefined).catch((e: unknown) => e);
    expect((err as Error).name).toBe('AbortError');
  });
});

describe('api workspace URLs', () => {
  it('builds /api for no workspace and /api/w/<name> for a named one', () => {
    expect(apiBase(undefined)).toBe('/api');
    expect(apiBase('common')).toBe('/api/w/common');
    expect(apiBase('my log/x')).toBe('/api/w/my%20log%2Fx');
  });

  it('calls the flat routes without a workspace and the named ones with it', async () => {
    stubFetch(createMockFetch());
    await api.meta(undefined).catch(() => undefined);
    await api.meta('adrien').catch(() => undefined);
    await api.graph('my log/x').catch(() => undefined);
    expect(calls).toEqual(['/api/meta', '/api/w/adrien/meta', '/api/w/my%20log%2Fx/graph']);
  });

  it('lists the workspaces at /api/workspaces', async () => {
    stubFetch(createMockFetch('workspaces'));
    const list = await api.workspaces();
    expect(calls).toEqual(['/api/workspaces']);
    expect(list.workspaces.map((w) => w.name)).toEqual(['adrien', 'common']);
  });

  it('builds every route under the workspace', async () => {
    stubFetch(createMockFetch('workspaces'));
    await api.adrs('common', EMPTY_FILTERS);
    await api.adr('common', 'ADR-0001');
    await api.forFiles('common', ['src/a.ts']);
    await api.check('common', true);
    expect(calls).toEqual([
      '/api/w/common/adrs',
      '/api/w/common/adrs/ADR-0001',
      '/api/w/common/for?path=src%2Fa.ts',
      '/api/w/common/check?lint=1',
    ]);
  });
});
