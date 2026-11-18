import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_FILE, type LogConfig, loadLogConfig } from '../src/config.ts';
import { loadLogView, mergedAdrs, workingAdrs } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
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

test('workingAdrs is the working tree, duplicates included', async () => {
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

test('a log inside a git repo that ignores it is read in files mode, not as pending additions', async () => {
  const repo = logWith({ '.gitignore': '.local/\n', 'README.md': '# repo\n' });
  initRepo(repo, { origin: true });
  writeFiles(repo, { '.local/log/docs/adr/ADR-0001-a.md': accepted });
  const view = await loadLogView(join(repo, '.local', 'log'), config);
  expect(view).toMatchObject({ mode: 'files', baseRef: null, pending: [] });
  expect(view.base.map((a) => a.meta.id)).toEqual(['ADR-0001']);
});

test('mergedAdrs is the latest base plus this branch’s pending changes, upstream-only ADRs included', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  const { origin } = initRepo(root, { origin: true });
  const other = tmpDir();
  git(other, 'clone', '-q', origin ?? '', '.');
  writeFiles(other, { 'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'Upstream' }) });
  commitAll(other, 'add ADR-0002 upstream');
  git(other, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');
  writeFiles(root, { 'docs/adr/ADR-0002-mine.md': adrText({ id: 'ADR-0002', title: 'Mine' }) });

  const view = await loadLogView(root, config);
  expect(workingAdrs(view).map((a) => a.path)).toEqual(['docs/adr/ADR-0001-a.md', 'docs/adr/ADR-0002-mine.md']);
  expect(mergedAdrs(view).map((a) => a.path)).toEqual([
    'docs/adr/ADR-0001-a.md',
    'docs/adr/ADR-0002-b.md',
    'docs/adr/ADR-0002-mine.md',
  ]);
});

test('mergedAdrs applies pending modifications and deletions over base', async () => {
  const root = logWith({
    'docs/adr/ADR-0001-a.md': accepted,
    'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B' }),
  });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0001-a.md': accepted.replace('status: accepted', 'status: deprecated') });
  rmSync(join(root, 'docs/adr/ADR-0002-b.md'));
  const view = await loadLogView(root, config);
  expect(mergedAdrs(view).map((a) => [a.meta.id, a.meta.status])).toEqual([['ADR-0001', 'deprecated']]);
});

test('a malformed ADR on the default branch is reported, not silently dropped', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  const { origin } = initRepo(root, { origin: true });
  const other = tmpDir();
  git(other, 'clone', '-q', origin ?? '', '.');
  writeFiles(other, { 'docs/adr/ADR-0002-bad.md': '---\n: bad: [\n---\n' });
  commitAll(other, 'add a malformed ADR upstream');
  git(other, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');

  const view = await loadLogView(root, config);
  expect(view.problems.map((p) => p.path)).toEqual(['docs/adr/ADR-0002-bad.md']);
});

test('a malformed ADR in both the tree and the default branch is reported once', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted, 'docs/adr/ADR-0002-bad.md': '---\n: bad: [\n---\n' });
  initRepo(root, { origin: true });
  expect((await loadLogView(root, config)).problems).toHaveLength(1);
});

test('a repo with commits but no recognised default branch is flagged baseUnresolved', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root);
  git(root, 'branch', '-m', 'trunk');
  const view = await loadLogView(root, config);
  expect(view).toMatchObject({ mode: 'files', baseRef: null, baseUnresolved: true });

  const fresh = logWith({ 'docs/adr/ADR-0001-a.md': accepted });
  git(fresh, 'init', '-q');
  expect((await loadLogView(fresh, config)).baseUnresolved).toBeFalsy();
  expect((await loadLogView(logWith({ 'docs/adr/ADR-0001-a.md': accepted }), config)).baseUnresolved).toBeFalsy();
});

test('a branch that moves the ADR directory leaves the default branch’s decisions binding', async () => {
  const root = logWith({ [CONFIG_FILE]: configYaml(), 'docs/adr/ADR-0001-a.md': accepted });
  initRepo(root, { origin: true });
  rmSync(join(root, 'docs/adr/ADR-0001-a.md'));
  writeFiles(root, {
    [CONFIG_FILE]: configYaml({ adr_dir: 'docs/decisions' }),
    'docs/decisions/ADR-0001-a.md': accepted,
  });
  const view = await loadLogView(root, loadLogConfig(root));
  expect(view.base.map((a) => a.path)).toEqual(['docs/adr/ADR-0001-a.md']);
  expect(view.pending).toMatchObject([{ id: 'ADR-0001', kind: 'modified' }]);
});

test('a shallow checkout with no merge base is flagged forkUnresolved', async () => {
  const seed = logWith({ [CONFIG_FILE]: configYaml(), 'docs/adr/ADR-0001-a.md': accepted });
  const { origin } = initRepo(seed, { origin: true });
  const root = tmpDir();
  git(root, 'clone', '-q', '--depth', '1', pathToFileURL(origin ?? '').href, '.');
  git(root, 'checkout', '-q', '-b', 'feature');
  writeFiles(root, { 'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B' }) });
  commitAll(root, 'branch work');
  writeFiles(seed, { 'docs/adr/ADR-0003-c.md': adrText({ id: 'ADR-0003', title: 'C' }) });
  commitAll(seed, 'upstream work');
  git(seed, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', '--depth', '1', 'origin');

  expect((await loadLogView(root, loadLogConfig(root))).forkUnresolved).toBe(true);
  expect((await loadLogView(seed, loadLogConfig(seed))).forkUnresolved).toBeFalsy();
});

test('loading the ADR tree never reads a large non-Markdown blob', async () => {
  const root = logWith({ 'docs/adr/ADR-0001-a.md': accepted, 'docs/adr/large.bin': 'x'.repeat(4 * 1024 * 1024) });
  initRepo(root);
  const blob = git(root, 'rev-parse', 'HEAD:docs/adr/large.bin');
  // A replacement cycle makes any cat-file request for this blob fail.
  git(root, 'update-ref', `refs/replace/${blob}`, blob);
  expect(() => git(root, 'cat-file', '-p', blob)).toThrow();
  const view = await loadLogView(root, config);
  expect(view.base.map((adr) => adr.meta.id)).toEqual(['ADR-0001']);
  git(root, 'rm', 'docs/adr/ADR-0001-a.md');
  commitAll(root, 'leave only the binary attachment');
  expect((await loadLogView(root, config)).base).toEqual([]);
});
