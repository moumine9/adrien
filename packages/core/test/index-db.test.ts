import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdrIndex, toFtsQuery } from '../src/index-db.ts';
import type { Adr, AdrMeta } from '../src/model.ts';
import { loadSqlite } from '../src/sqlite.ts';
import type { LogView, PendingChange } from '../src/view.ts';
import { tmpDir } from './helpers/fixtures.ts';

function adr(id: string, over: Partial<AdrMeta> = {}, body = ''): Adr {
  return {
    path: `docs/adr/${id}.md`,
    body,
    meta: {
      id,
      title: `Title ${id}`,
      status: 'accepted',
      tags: [],
      components: [],
      code: [],
      sources: [],
      supersedes: [],
      related: [],
      deciders: [],
      origin: 'manual',
      contested: false,
      extra: {},
      ...over,
    },
  };
}

const viewOf = (base: Adr[], pending: PendingChange[] = []): LogView => ({
  mode: 'git',
  baseRef: 'origin/main',
  base,
  pending,
  working: base,
  problems: [],
});

async function indexWith(view: LogView): Promise<AdrIndex> {
  const index = await AdrIndex.open(tmpDir());
  onTestFinished(() => index.close());
  index.sync(view);
  return index;
}

const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);

test('open creates .adrien/.gitignore containing "*"', async () => {
  const root = tmpDir();
  const index = await AdrIndex.open(root);
  index.close();
  const gitignore = join(root, '.adrien', '.gitignore');
  expect(existsSync(gitignore)).toBe(true);
  expect(readFileSync(gitignore, 'utf8')).toBe('*\n');
});

test('list: tags AND, components ANY, status ANY, layer filter', async () => {
  const index = await indexWith(
    viewOf([
      adr('ADR-0001', { tags: ['backend', 'database'], components: ['billing-service'] }),
      adr('ADR-0002', { tags: ['backend'], components: ['web'], status: 'proposed' }),
      adr('ADR-0003', { tags: ['security'], components: ['billing-service', 'web'], status: 'deprecated' }),
    ]),
  );
  expect(ids(index.list({ tags: ['backend', 'database'] }))).toEqual(['ADR-0001']);
  expect(ids(index.list({ components: ['web', 'nope'] }))).toEqual(['ADR-0002', 'ADR-0003']);
  expect(ids(index.list({ status: ['accepted', 'proposed'] }))).toEqual(['ADR-0001', 'ADR-0002']);
  expect(ids(index.list({ layer: 'pending' }))).toEqual([]);
});

test('search ranks a title hit above a body-only hit', async () => {
  const index = await indexWith(
    viewOf([
      adr(
        'ADR-0001',
        { title: 'Queue jobs in Redis' },
        '\n## Context\n\nWe compared it with Postgres listen/notify.\n',
      ),
      adr('ADR-0002', { title: 'Use Postgres for persistence' }),
    ]),
  );
  expect(ids(index.search('postgres'))).toEqual(['ADR-0002', 'ADR-0001']);
});

test('search "decimal" finds the title "Arrondi décimal des factures"', async () => {
  const index = await indexWith(viewOf([adr('ADR-0001', { title: 'Arrondi décimal des factures' })]));
  expect(ids(index.search('decimal'))).toEqual(['ADR-0001']);
});

test('search never throws on FTS syntax', async () => {
  const index = await indexWith(viewOf([adr('ADR-0001', { title: 'foo bar' })]));
  expect(Array.isArray(index.search('"foo" -bar: NEAR(*'))).toBe(true);
  expect(index.search('   ')).toEqual([]);
});

test('toFtsQuery quotes every token as a prefix match', () => {
  expect(toFtsQuery('  ')).toBeNull();
  expect(toFtsQuery('c++ api:v2')).toBe('"c"* "api"* "v2"*');
});

test('a second identical sync reports only unchanged rows', async () => {
  const view = viewOf([adr('ADR-0001'), adr('ADR-0002'), adr('ADR-0003')]);
  const index = await indexWith(view);
  expect(index.sync(view)).toEqual({ inserted: 0, updated: 0, deleted: 0, unchanged: 3 });
});

test('a modified pending ADR appears as a pending row next to its base row', async () => {
  const base = adr('ADR-0001');
  const current = adr('ADR-0001', { status: 'deprecated' });
  const index = await indexWith(viewOf([base], [{ id: 'ADR-0001', kind: 'modified', base, current }]));
  expect(index.list().map((r) => [r.id, r.layer, r.status, r.pending_kind])).toEqual([
    ['ADR-0001', 'base', 'accepted', null],
    ['ADR-0001', 'pending', 'deprecated', 'modified'],
  ]);
});

test('loading SQLite silences its ExperimentalWarning but keeps other warnings', async () => {
  const writes: string[] = [];
  const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: string | Uint8Array) => {
    writes.push(String(chunk));
    return true;
  });
  onTestFinished(() => spy.mockRestore());
  await loadSqlite();
  process.emitWarning('SQLite is an experimental feature and might change at any time', 'ExperimentalWarning');
  process.emitWarning('something else', 'DeprecationWarning');
  await new Promise((r) => setImmediate(r));
  expect(writes.some((w) => w.includes('ExperimentalWarning'))).toBe(false);
  expect(writes.some((w) => w.includes('DeprecationWarning'))).toBe(true);
});
