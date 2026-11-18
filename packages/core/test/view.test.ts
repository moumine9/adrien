import { rmSync } from 'node:fs';
import { join } from 'node:path';
import type { LogConfig } from '../src/config.ts';
import { loadLogView, workingAdrs } from '../src/view.ts';
import { adrText, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { commitAll, git, initRepo } from './helpers/git.ts';

const config: LogConfig = { product: 'acme', adr_dir: 'docs/adr', id_format: 'ADR-{n:4}', tags: [], components: {} };
const accepted = adrText({ id: 'ADR-0001', title: 'Use Postgres', status: 'accepted', review_rule: 'Use Postgres.' });

function logWith(files: Record<string, string>): string {
  const root = tmpDir();
  writeFiles(root, files);
  return root;
}

test('files mode when the log is not a git repo', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  const view = await loadLogView(root, config);
  expect(view).toMatchObject({ mode: 'files', baseRef: null, pending: [] });
  expect(view.base.map((a) => a.meta.id)).toEqual(['ADR-0001']);
});

test('files mode in a fresh repo with no commits', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  git(root, 'init', '-q');
  const view = await loadLogView(root, config);
  expect(view.mode).toBe('files');
  expect(view.base).toHaveLength(1);
});

test('git mode: a pushed ADR is base, nothing pending', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root, { origin: true });
  const view = await loadLogView(root, config);
  expect(view).toMatchObject({ mode: 'git', baseRef: 'origin/main', pending: [] });
  expect(view.base.map((a) => a.meta.id)).toEqual(['ADR-0001']);
});

test('an uncommitted status change is pending; base keeps the merged status', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0001-a.md': accepted.replace('status: accepted', 'status: deprecated') });
  const view = await loadLogView(root, config);
  expect(view.base[0]?.meta.status).toBe('accepted');
  expect(view.pending).toHaveLength(1);
  expect(view.pending[0]).toMatchObject({ id: 'ADR-0001', kind: 'modified' });
  expect(view.pending[0]?.current?.meta.status).toBe('deprecated');
});

test('a new ADR committed on a feature branch is pending "added"', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root, { origin: true });
  git(root, 'switch', '-q', '-c', 'feature');
  writeFiles(root, { 'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B' }) });
  commitAll(root, 'add ADR-0002');
  const view = await loadLogView(root, config);
  expect(view.pending.map((p) => [p.id, p.kind])).toEqual([['ADR-0002', 'added']]);
  expect(view.base.map((a) => a.meta.id)).toEqual(['ADR-0001']);
});

test('a deleted ADR is pending "deleted"', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root, { origin: true });
  rmSync(join(root, 'docs/adr/ADR-0001-a.md'));
  const view = await loadLogView(root, config);
  expect(view.pending).toMatchObject([{ id: 'ADR-0001', kind: 'deleted' }]);
  expect(view.pending[0]?.base?.meta.status).toBe('accepted');
});

test('uses local main as base when there is no remote', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root);
  const view = await loadLogView(root, config);
  expect(view).toMatchObject({ mode: 'git', baseRef: 'main', pending: [] });
});

test('a CRLF-only difference is not pending', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0001-a.md': accepted.replace(/\n/g, '\r\n') });
  expect((await loadLogView(root, config)).pending).toEqual([]);
});

test('reads base from a log that lives in a subdirectory of the repo', async () => {
  const repo = logWith({ 'decisions/docs/adr/ADR-0001-a.md': accepted });
  initRepo(repo, { origin: true });
  const view = await loadLogView(join(repo, 'decisions'), config);
  expect(view.mode).toBe('git');
  expect(view.base.map((a) => a.path)).toEqual(['docs/adr/ADR-0001-a.md']);
});

test('workingAdrs is what the default branch would hold after merging, duplicates included', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root, { origin: true });
  writeFiles(root, {
    'docs/adr/ADR-0001-a.md': accepted.replace('status: accepted', 'status: deprecated'),
    'docs/adr/ADR-0001-dup.md': adrText({ id: 'ADR-0001', title: 'Duplicate id' }),
  });
  const view = await loadLogView(root, config);
  expect(workingAdrs(view).map((a) => [a.meta.id, a.meta.status])).toEqual([
    ['ADR-0001', 'deprecated'],
    ['ADR-0001', 'proposed'],
  ]);
  expect(view.pending.map((p) => p.kind).sort()).toEqual(['added', 'modified']);
});

test('ADRs merged upstream after branching are base, never "pending deleted"', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  const { origin } = initRepo(root, { origin: true });
  const other = tmpDir();
  git(other, 'clone', '-q', origin ?? '', '.');
  writeFiles(other, { 'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B' }) });
  commitAll(other, 'add ADR-0002 upstream');
  git(other, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');

  const view = await loadLogView(root, config);
  expect(view.base.map((a) => a.meta.id)).toEqual(['ADR-0001', 'ADR-0002']);
  expect(view.pending).toEqual([]);
});
