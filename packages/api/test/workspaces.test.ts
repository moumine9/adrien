import { CONFIG_FILE } from '@adrien/core';
import { adrText, configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { type ApiOptions, createApp } from '../src/app.ts';
import type { ApiError, MetaResponse, WorkspacesResponse } from '../src/contract.ts';

/** A plain-files log with one ADR, under the given product (so its workspace name is its slug). */
function logWith(product: string, adrId: string): string {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml({ product }),
    'docs/adr/ADR-0001-first.md': adrText({ id: adrId, title: `Decision ${adrId}` }),
  });
  return root;
}

function app(opts: Partial<ApiOptions> & { cwd: string }) {
  return createApp({ env: { ADRIEN_HOME: tmpDir() }, version: '1.2.3', ...opts });
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('one workspace', () => {
  test('answers under the flat routes and under its own name, with the same data', async () => {
    const root = logWith('acme', 'ADR-0001');
    const server = app({ cwd: root });
    const flat = await server.request('/api/adrs/ADR-0001');
    const named = await server.request('/api/w/acme/adrs/ADR-0001');
    expect(flat.status).toBe(200);
    expect(named.status).toBe(200);
    expect(await json(named)).toEqual(await json(flat));
  });

  test('/api/meta names its workspace', async () => {
    const root = logWith('acme', 'ADR-0001');
    const meta = await json<MetaResponse>(await app({ cwd: root }).request('/api/w/acme/meta'));
    expect(meta).toMatchObject({ workspace: 'acme', product: 'acme' });
    expect(await json<MetaResponse>(await app({ cwd: root }).request('/api/meta'))).toMatchObject({
      workspace: 'acme',
    });
  });

  test('lists itself as the default workspace', async () => {
    const root = logWith('acme', 'ADR-0001');
    const body = await json<WorkspacesResponse>(await app({ cwd: root }).request('/api/workspaces'));
    expect(body).toEqual({ workspaces: [{ name: 'acme', product: 'acme', default: true }] });
  });

  test('an unknown name is WORKSPACE_NOT_FOUND', async () => {
    const root = logWith('acme', 'ADR-0001');
    const res = await app({ cwd: root }).request('/api/w/beta/meta');
    expect(res.status).toBe(404);
    expect((await json<ApiError>(res)).error.code).toBe('WORKSPACE_NOT_FOUND');
  });
});

describe('several workspaces', () => {
  function two() {
    const a = logWith('Alpha', 'ADR-0001');
    const b = logWith('Beta', 'ADR-0002');
    return {
      a,
      b,
      server: app({
        cwd: a,
        logs: [
          { name: 'alpha', log: a },
          { name: 'beta', log: b },
        ],
      }),
    };
  }

  test('each /api/w/<name> route serves its own log', async () => {
    const { server } = two();
    const alpha = await json<{ id: string }>(await server.request('/api/w/alpha/adrs/ADR-0001'));
    const beta = await json<{ id: string }>(await server.request('/api/w/beta/adrs/ADR-0002'));
    expect(alpha.id).toBe('ADR-0001');
    expect(beta.id).toBe('ADR-0002');
    expect((await server.request('/api/w/beta/adrs/ADR-0001')).status).toBe(404);
    expect(await json<MetaResponse>(await server.request('/api/w/beta/meta'))).toMatchObject({
      workspace: 'beta',
      product: 'Beta',
    });
  });

  test('the flat routes are WORKSPACE_REQUIRED and name the workspaces', async () => {
    const { server } = two();
    const res = await server.request('/api/adrs');
    expect(res.status).toBe(404);
    const { error } = await json<ApiError>(res);
    expect(error.code).toBe('WORKSPACE_REQUIRED');
    expect(error.message).toContain('alpha');
    expect(error.message).toContain('beta');
    expect(error.message).toContain('/api/w/<name>/');
  });

  test('/api/workspaces lists each, with default false', async () => {
    const { server } = two();
    const body = await json<WorkspacesResponse>(await server.request('/api/workspaces'));
    expect(body).toEqual({
      workspaces: [
        { name: 'alpha', product: 'Alpha', default: false },
        { name: 'beta', product: 'Beta', default: false },
      ],
    });
  });

  test('/api/for answers with the chosen workspace', async () => {
    const { server } = two();
    const res = await server.request('/api/w/alpha/for?path=src/a.ts');
    expect(res.status).toBe(200);
  });

  // A bare ".." segment is normalised by the URL before routing, so a traversal name is sent encoded: it is only ever a Map key.
  test.each(['constructor', '__proto__', 'nope', '..%2Fbeta', '%2E%2E%2Fbeta', '..%2F..%2Fetc'])(
    'the name "%s" is WORKSPACE_NOT_FOUND',
    async (name) => {
      const { server } = two();
      const res = await server.request(`/api/w/${name}/meta`);
      expect(res.status).toBe(404);
      expect((await json<ApiError>(res)).error.code).toBe('WORKSPACE_NOT_FOUND');
    },
  );

  test('a bare ".." never reaches a workspace: the URL is normalised to the flat route', async () => {
    const { server } = two();
    const res = await server.request('/api/w/../meta');
    expect((await json<ApiError>(res)).error.code).toBe('WORKSPACE_REQUIRED');
  });
});

describe('access token and freshness', () => {
  test('one token covers every workspace route, and /healthz stays open', async () => {
    const a = logWith('Alpha', 'ADR-0001');
    const b = logWith('Beta', 'ADR-0002');
    const server = app({
      cwd: a,
      token: 's3cret',
      logs: [
        { name: 'alpha', log: a },
        { name: 'beta', log: b },
      ],
    });
    expect((await server.request('/api/w/beta/meta')).status).toBe(401);
    const ok = await server.request('/api/w/beta/meta', { headers: { Authorization: 'Bearer s3cret' } });
    expect(ok.status).toBe(200);
    expect((await server.request('/healthz')).status).toBe(200);
  });

  test('a change to a log config between two requests shows without recreating the app', async () => {
    const root = tmpDir();
    writeFiles(root, { [CONFIG_FILE]: configYaml({ product: 'acme', workspace: 'acme' }) });
    const server = app({ cwd: root });
    expect((await json<MetaResponse>(await server.request('/api/w/acme/meta'))).product).toBe('acme');
    writeFiles(root, { [CONFIG_FILE]: configYaml({ product: 'renamed', workspace: 'acme' }) });
    const after = await json<MetaResponse>(await server.request('/api/w/acme/meta'));
    expect(after.product).toBe('renamed');
  });
});
