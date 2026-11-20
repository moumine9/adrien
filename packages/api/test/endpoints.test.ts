import { rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE, DEFAULT_TAGS, loadLogView, resolveContext, workingRevision } from '@adrien/core';
import { adrText, configYaml, DEFAULT_COMPONENTS, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { git, initRepo } from '../../core/test/helpers/git.ts';
import { type ApiOptions, createApp } from '../src/app.ts';
import type {
  AdrResponse,
  AdrsResponse,
  ApiError,
  CheckResponse,
  ForResponse,
  GraphResponse,
  MetaResponse,
} from '../src/contract.ts';

const rule = 'Format dates with the locale helper.';

const dates = {
  id: 'ADR-0001',
  title: 'Render dates in the user locale',
  status: 'accepted',
  tags: ['frontend'],
  components: ['web'],
  code: ['web:src/**'],
  review_rule: rule,
  related: ['ADR-0003'],
} as const;

const ADRS = {
  'docs/adr/ADR-0001-dates.md': adrText(
    {
      ...dates,
      tags: [...dates.tags],
      components: [...dates.components],
      code: [...dates.code],
      related: ['ADR-0003'],
    },
    '\n## Decision\n\nRender dates in the user locale.\n',
  ),
  'docs/adr/ADR-0002-postgres.md': adrText({
    id: 'ADR-0002',
    title: 'Store invoices in Postgres',
    status: 'superseded',
    superseded_by: 'ADR-0003',
    tags: ['backend', 'database'],
    components: ['billing-service'],
  }),
  'docs/adr/ADR-0003-event-log.md': adrText(
    {
      id: 'ADR-0003',
      title: 'Store invoices in an event log',
      status: 'accepted',
      supersedes: ['ADR-0002'],
      // ADR-0001 links back (one edge), ADR-0099 does not exist, and a link to itself says nothing: no edges for those.
      related: ['ADR-0001', 'ADR-0099', 'ADR-0003'],
      tags: ['backend'],
      components: ['billing-service'],
      review_rule: 'Append invoice events, never update them.',
    },
    '\n## Decision\n\nAppend invoice events to a log.\n',
  ),
  // A template placeholder left in: a style warning that only lint=1 reports.
  'docs/adr/ADR-0004-tokens.md': adrText(
    { id: 'ADR-0004', title: 'Rotate API tokens monthly', tags: ['security'] },
    '\n## Context\n\n{why tokens must rotate}\n',
  ),
};

/** A log that is not in git: statuses are read as written. */
function filesLog(extra: Record<string, string> = {}): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), 'apps/web/src/a.ts': 'export {};\n', ...ADRS, ...extra });
  return root;
}

/** A log on its default branch, with this checkout editing ADR-0001, adding ADR-0005 and deleting ADR-0004. */
function gitLog(): string {
  const root = filesLog();
  initRepo(root, { origin: true });
  writeFiles(root, {
    'docs/adr/ADR-0001-dates.md': adrText({
      ...dates,
      title: 'Render dates and times in the user locale',
      tags: [...dates.tags],
      components: [...dates.components],
      code: [...dates.code],
      related: ['ADR-0003'],
    }),
    'docs/adr/ADR-0005-rates.md': adrText({ id: 'ADR-0005', title: 'Cache exchange rates for an hour' }),
  });
  rmSync(join(root, 'docs/adr/ADR-0004-tokens.md'));
  return root;
}

async function request(path: string, opts: Partial<ApiOptions> & { cwd: string }): Promise<Response> {
  return await createApp({ env: { ADRIEN_HOME: tmpDir() }, version: '1.2.3', ...opts }).request(path);
}

async function get<T>(cwd: string, path: string, opts: Partial<ApiOptions> = {}) {
  const res = await request(path, { cwd, ...opts });
  return { status: res.status, headers: res.headers, body: (await res.json()) as T };
}

const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('GET /api/meta', () => {
  test('describes a plain-files log', async () => {
    const { status, body } = await get<MetaResponse>(filesLog(), '/api/meta');
    expect(status).toBe(200);
    expect(body).toEqual({
      version: '1.2.3',
      product: 'acme',
      adrDir: 'docs/adr',
      mode: 'files',
      baseRef: null,
      baseUnresolved: false,
      forkUnresolved: false,
      tags: DEFAULT_TAGS,
      components: DEFAULT_COMPONENTS,
      counts: {
        total: 4,
        pending: 0,
        byStatus: { proposed: 1, accepted: 2, rejected: 0, superseded: 1, deprecated: 0 },
      },
    });
  });

  test('reports 0.0.0 when no version is given, and reads the process env by default', async () => {
    const res = await createApp({ cwd: filesLog() }).request('/api/meta');
    expect(((await res.json()) as MetaResponse).version).toBe('0.0.0');
  });

  test('says when no default branch can be found', async () => {
    const root = filesLog();
    initRepo(root);
    git(root, 'branch', '-m', 'trunk');
    const { body } = await get<MetaResponse>(root, '/api/meta');
    expect(body).toMatchObject({ mode: 'files', baseUnresolved: true, forkUnresolved: false });
  });

  test('re-reads the log on every request', async () => {
    const root = filesLog();
    const app = createApp({ cwd: root, env: { ADRIEN_HOME: tmpDir() } });
    const before = (await (await app.request('/api/meta')).json()) as MetaResponse;
    writeFiles(root, { 'docs/adr/ADR-0005-rates.md': adrText({ id: 'ADR-0005', title: 'Cache exchange rates' }) });
    const after = (await (await app.request('/api/meta')).json()) as MetaResponse;
    expect([before.counts.total, after.counts.total]).toEqual([4, 5]);
  });
});

describe('GET /api/adrs', () => {
  test('lists every ADR as a row', async () => {
    const { status, body } = await get<AdrsResponse>(filesLog(), '/api/adrs');
    expect(status).toBe(200);
    expect(ids(body.results)).toEqual(['ADR-0001', 'ADR-0002', 'ADR-0003', 'ADR-0004']);
    expect(body.results[0]).toEqual({
      id: 'ADR-0001',
      title: 'Render dates in the user locale',
      status: 'accepted',
      tags: ['frontend'],
      components: ['web'],
      review_rule: rule,
      layer: 'base',
      pending_kind: null,
      path: 'docs/adr/ADR-0001-dates.md',
      revision: expect.stringMatching(/^[0-9a-f]{12}$/),
      modifiedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
    });
  });

  test.each([
    ['tag=backend&tag=database', ['ADR-0002']],
    ['component=web&component=billing-service', ['ADR-0001', 'ADR-0002', 'ADR-0003']],
    ['status=accepted&status=proposed', ['ADR-0001', 'ADR-0003', 'ADR-0004']],
    ['tag=backend&status=accepted', ['ADR-0003']],
    ['pending=1', []],
    ['q=', ['ADR-0001', 'ADR-0002', 'ADR-0003', 'ADR-0004']],
    ['q=%21%21', []],
    ['q=invoice&status=accepted', ['ADR-0003']],
  ])('filters with %s', async (query, expected) => {
    const { body } = await get<AdrsResponse>(filesLog(), `/api/adrs?${query}`);
    expect(ids(body.results)).toEqual(expected);
  });

  test('q searches the full text, ranked', async () => {
    const { body } = await get<AdrsResponse>(filesLog(), '/api/adrs?q=invoices');
    expect(ids(body.results).sort()).toEqual(['ADR-0002', 'ADR-0003']);
    const byBody = await get<AdrsResponse>(filesLog(), '/api/adrs?q=append');
    expect(ids(byBody.body.results)).toEqual(['ADR-0003']);
  });

  test('q is not capped below the size of the log', async () => {
    const many = Object.fromEntries(
      Array.from({ length: 30 }, (_, i) => {
        const id = `ADR-${String(i + 10).padStart(4, '0')}`;
        return [`docs/adr/${id}-cache.md`, adrText({ id, title: `Cache layer number ${i}` })];
      }),
    );
    const { body } = await get<AdrsResponse>(filesLog(many), '/api/adrs?q=cache');
    expect(body.results).toHaveLength(30);
  });

  test('an unknown status is a 400', async () => {
    const { status, body } = await get<ApiError>(filesLog(), '/api/adrs?status=accepted&status=maybe');
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
    expect(body.error.message).toContain('maybe');
  });
});

describe('GET /api/adrs/:id', () => {
  test('returns the binding version', async () => {
    const { status, body } = await get<AdrResponse>(filesLog(), '/api/adrs/ADR-0001');
    expect(status).toBe(200);
    expect(body).toMatchObject({
      id: 'ADR-0001',
      base: {
        meta: { id: 'ADR-0001', title: 'Render dates in the user locale', status: 'accepted', review_rule: rule },
        body: '\n## Decision\n\nRender dates in the user locale.\n',
        path: 'docs/adr/ADR-0001-dates.md',
      },
      pending: null,
    });
  });

  test('carries the revision `adrien show --json` returns, and when the version in this checkout was written', async () => {
    const root = gitLog();
    const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: tmpDir() } });
    const view = await loadLogView(ctx.logRoot, ctx.config);
    const edited = await get<AdrResponse>(root, '/api/adrs/ADR-0001');
    expect(edited.body.revision).toBe(workingRevision(view, 'ADR-0001'));
    expect(edited.body.revision).toMatch(/^[0-9a-f]{12}$/);
    expect(edited.body.modifiedAt).toBe(statSync(join(root, 'docs/adr/ADR-0001-dates.md')).mtime.toISOString());
    // Unchanged here: dated by the commit that touched it, not by the file.
    const same = await get<AdrResponse>(root, '/api/adrs/ADR-0002');
    expect(same.body.revision).toBe(workingRevision(view, 'ADR-0002'));
    expect(same.body.modifiedAt).toBe(
      new Date(git(root, 'log', '-1', '--format=%cI', 'HEAD', '--', 'docs/adr/ADR-0002-postgres.md')).toISOString(),
    );
    // Deleted in this checkout: no revision to base a change on, but the binding version has a date.
    const deleted = await get<AdrResponse>(root, '/api/adrs/ADR-0004');
    expect(deleted.body.revision).toBeNull();
    expect(deleted.body.modifiedAt).not.toBeNull();
  });

  test('list rows carry the same stamps as the detail', async () => {
    const root = gitLog();
    const list = await get<AdrsResponse>(root, '/api/adrs');
    for (const row of list.body.results) {
      const detail = await get<AdrResponse>(root, `/api/adrs/${row.id}`);
      expect([row.id, row.revision, row.modifiedAt]).toEqual([row.id, detail.body.revision, detail.body.modifiedAt]);
    }
    expect(list.body.results.some((r) => r.revision)).toBe(true);
  });

  test('an unknown id is a 404', async () => {
    const { status, body } = await get<ApiError>(filesLog(), '/api/adrs/ADR-0999');
    expect(status).toBe(404);
    expect(body.error).toEqual({ code: 'ADR_NOT_FOUND', message: 'No ADR ADR-0999 in the log' });
  });
});

describe('GET /api/graph', () => {
  test('one node per ADR, one edge per supersession or link, both ends present', async () => {
    const { status, body } = await get<GraphResponse>(filesLog(), '/api/graph');
    expect(status).toBe(200);
    expect(body.nodes).toEqual([
      {
        id: 'ADR-0001',
        title: 'Render dates in the user locale',
        status: 'accepted',
        tags: ['frontend'],
        pending: false,
      },
      {
        id: 'ADR-0002',
        title: 'Store invoices in Postgres',
        status: 'superseded',
        tags: ['backend', 'database'],
        pending: false,
      },
      {
        id: 'ADR-0003',
        title: 'Store invoices in an event log',
        status: 'accepted',
        tags: ['backend'],
        pending: false,
      },
      { id: 'ADR-0004', title: 'Rotate API tokens monthly', status: 'proposed', tags: ['security'], pending: false },
    ]);
    // supersedes and superseded_by name the same supersession; related links both ways are one link.
    expect(body.edges).toEqual([
      { from: 'ADR-0001', to: 'ADR-0003', type: 'related' },
      { from: 'ADR-0003', to: 'ADR-0002', type: 'supersedes' },
    ]);
  });

  test('superseded_by alone still draws the supersession, from the newer ADR', async () => {
    const root = filesLog({
      'docs/adr/ADR-0003-event-log.md': adrText({ id: 'ADR-0003', title: 'Store invoices in an event log' }),
    });
    const { body } = await get<GraphResponse>(root, '/api/graph');
    expect(body.edges.filter((e) => e.type === 'supersedes')).toEqual([
      { from: 'ADR-0003', to: 'ADR-0002', type: 'supersedes' },
    ]);
  });

  test('two ADRs sharing an id make one node, and the counts agree with the graph', async () => {
    const root = filesLog({
      'docs/adr/ADR-0004-cache.md': adrText({ id: 'ADR-0004', title: 'Cache exchange rates', status: 'accepted' }),
    });
    const graph = await get<GraphResponse>(root, '/api/graph');
    expect(graph.body.nodes.filter((n) => n.id === 'ADR-0004')).toEqual([
      { id: 'ADR-0004', title: 'Cache exchange rates', status: 'accepted', tags: [], pending: false },
    ]);
    const meta = await get<MetaResponse>(root, '/api/meta');
    expect(meta.body.counts.total).toBe(graph.body.nodes.length);
    expect(meta.body.counts.byStatus.accepted).toBe(3);
  });
});

describe('a checkout with pending changes', () => {
  test('meta counts the world after merging, and the pending changes', async () => {
    const root = gitLog();
    const meta = await get<MetaResponse>(root, '/api/meta');
    expect(meta.body).toMatchObject({
      mode: 'git',
      baseRef: expect.stringMatching(/^origin\//),
      baseUnresolved: false,
      forkUnresolved: false,
      counts: {
        total: 4,
        pending: 3,
        byStatus: { proposed: 1, accepted: 2, rejected: 0, superseded: 1, deprecated: 0 },
      },
    });
    const graph = await get<GraphResponse>(root, '/api/graph');
    const pending = await get<AdrsResponse>(root, '/api/adrs?pending=1');
    const { counts } = meta.body;
    expect(Object.values(counts.byStatus).reduce((a, b) => a + b, 0)).toBe(counts.total);
    expect(graph.body.nodes).toHaveLength(counts.total);
    expect(pending.body.results).toHaveLength(counts.pending);
  });

  test('pending=1 lists only the changes, with their kind', async () => {
    const { body } = await get<AdrsResponse>(gitLog(), '/api/adrs?pending=1');
    expect(body.results.map((r) => [r.id, r.layer, r.pending_kind])).toEqual([
      ['ADR-0001', 'pending', 'modified'],
      ['ADR-0004', 'pending', 'deleted'],
      ['ADR-0005', 'pending', 'added'],
    ]);
  });

  test('an ADR shows its binding version and its pending change', async () => {
    const root = gitLog();
    const modified = await get<AdrResponse>(root, '/api/adrs/ADR-0001');
    expect(modified.body.base?.meta.title).toBe('Render dates in the user locale');
    expect(modified.body.pending).toMatchObject({
      kind: 'modified',
      meta: { title: 'Render dates and times in the user locale' },
      path: 'docs/adr/ADR-0001-dates.md',
    });

    const added = await get<AdrResponse>(root, '/api/adrs/ADR-0005');
    expect(added.body).toMatchObject({ base: null, pending: { kind: 'added', meta: { id: 'ADR-0005' } } });

    const deleted = await get<AdrResponse>(root, '/api/adrs/ADR-0004');
    expect(deleted.body.base?.meta.id).toBe('ADR-0004');
    expect(deleted.body.pending).toEqual({ kind: 'deleted' });
  });

  test('the graph is the world after merging, with pending nodes flagged', async () => {
    const { body } = await get<GraphResponse>(gitLog(), '/api/graph');
    expect(body.nodes.map((n) => [n.id, n.title, n.pending])).toEqual([
      ['ADR-0001', 'Render dates and times in the user locale', true],
      ['ADR-0002', 'Store invoices in Postgres', false],
      ['ADR-0003', 'Store invoices in an event log', false],
      ['ADR-0005', 'Cache exchange rates for an hour', true],
    ]);
  });
});

describe('GET /api/for', () => {
  test('returns the decisions governing each file', async () => {
    const { status, body } = await get<ForResponse>(filesLog(), '/api/for?path=apps/web/src/a.ts&path=README.md');
    expect(status).toBe(200);
    expect(body.notes).toBeUndefined();
    expect(body.files).toMatchObject([
      {
        file: 'apps/web/src/a.ts',
        component: 'web',
        decisions: [{ id: 'ADR-0001', binding: true, match: 'anchor', review_rule: rule }],
      },
      { file: 'README.md', component: null, decisions: [] },
    ]);
  });

  test('notes that bindingness is unverified without a default branch', async () => {
    const root = filesLog();
    initRepo(root);
    git(root, 'branch', '-m', 'trunk');
    const { body } = await get<ForResponse>(root, '/api/for?path=apps/web/src/a.ts');
    expect(body.notes).toEqual([expect.stringContaining('No default branch was found')]);
  });

  test.each(['/api/for', '/api/for?path='])('%s without a path is a 400', async (path) => {
    const { status, body } = await get<ApiError>(filesLog(), path);
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });
});

describe('GET /api/check', () => {
  test('reports the problems, and lint=1 adds the style warnings', async () => {
    const root = filesLog();
    const plain = await get<CheckResponse>(root, '/api/check');
    expect(plain.status).toBe(200);
    expect(plain.body.diagnostics).toContainEqual(
      expect.objectContaining({ severity: 'error', code: 'broken-link', id: 'ADR-0003' }),
    );
    const count = (body: CheckResponse, severity: string) =>
      body.diagnostics.filter((d) => d.severity === severity).length;
    expect(plain.body.errors).toBe(count(plain.body, 'error'));
    expect(plain.body.warnings).toBe(count(plain.body, 'warning'));

    const linted = await get<CheckResponse>(root, '/api/check?lint=1');
    expect(linted.body.warnings).toBeGreaterThan(plain.body.warnings);
    expect(linted.body.diagnostics).toContainEqual(expect.objectContaining({ code: 'unfilled-placeholder' }));
  });
});

describe('GET /api/export', () => {
  test('is the markdown overview by default, as text', async () => {
    const res = await request('/api/export', { cwd: filesLog() });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/plain/);
    const text = await res.text();
    expect(text.split('\n')[0]).toBe('# acme: architecture decisions');
    expect(text).toContain('| [ADR-0001](docs/adr/ADR-0001-dates.md) | Render dates in the user locale | accepted |');
  });

  test('format=llms is the llms.txt', async () => {
    const res = await request('/api/export?format=llms', { cwd: filesLog() });
    const text = await res.text();
    expect(text.split('\n')[0]).toBe('# acme');
    expect(text).toContain(`- [ADR-0001: Render dates in the user locale](docs/adr/ADR-0001-dates.md): ${rule}`);
  });

  test('an unknown format is a 400', async () => {
    const { status, body } = await get<ApiError>(filesLog(), '/api/export?format=pdf');
    expect(status).toBe(400);
    expect(body.error.code).toBe('INVALID_INPUT');
  });
});

describe('errors', () => {
  test('no log is a 500 with the reason', async () => {
    const { status, body } = await get<ApiError>(tmpDir(), '/api/meta');
    expect(status).toBe(500);
    expect(body.error.code).toBe('CONFIG_NOT_FOUND');
  });

  test('an unexpected failure is a 500, still as JSON', async () => {
    // The index lives in <log>/.adrien: a file in its way makes opening it fail with a plain Node error.
    const root = filesLog({ '.adrien': 'not a directory\n' });
    const { status, body } = await get<ApiError>(root, '/api/adrs');
    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).not.toBe('');
  });

  test.each(['/api', '/api/', '/api/nope', '/api/adrs/ADR-0001/extra'])('%s is a JSON 404', async (path) => {
    const { status, body } = await get<ApiError>(filesLog(), path);
    expect(status).toBe(404);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
