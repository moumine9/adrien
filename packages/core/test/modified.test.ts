import { rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_FILE, parseLogConfigText } from '../src/config.ts';
import { git as runGit } from '../src/git.ts';
import { modifiedAtById } from '../src/modified.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { commitAll, git, initRepo } from './helpers/git.ts';

const config = () => parseLogConfigText(configYaml(), CONFIG_FILE);
const A = 'docs/adr/ADR-0001-a.md';
const B = 'docs/adr/ADR-0002-b.md';
const committerDate = (root: string, path: string) =>
  new Date(git(root, 'log', '-1', '--format=%cI', '--', path)).toISOString();
const mtime = (root: string, path: string) => statSync(join(root, path)).mtime.toISOString();

function twoAdrs(root: string): void {
  writeFiles(root, {
    [A]: adrText({ id: 'ADR-0001', title: 'A' }),
    [B]: adrText({ id: 'ADR-0002', title: 'B' }),
  });
}

test('a committed ADR is dated by the last commit on the base ref that touched its file, not by its mtime', async () => {
  const root = tmpDir();
  twoAdrs(root);
  initRepo(root);
  writeFiles(root, { [B]: adrText({ id: 'ADR-0002', title: 'B again' }) });
  commitAll(root, 'edit b');
  // A checkout resets mtimes: make the file look a year old, the commit date must still win.
  const old = new Date('2020-01-01T00:00:00Z');
  utimesSync(join(root, A), old, old);
  const view = await loadLogView(root, config());
  const dates = await modifiedAtById(root, view);
  expect(dates.get('ADR-0001')).toBe(committerDate(root, A));
  expect(dates.get('ADR-0002')).toBe(committerDate(root, B));
});

test('an ADR with a pending change is dated by the file in the working copy', async () => {
  const root = tmpDir();
  twoAdrs(root);
  initRepo(root);
  writeFiles(root, {
    [A]: adrText({ id: 'ADR-0001', title: 'A edited' }),
    'docs/adr/ADR-0003-c.md': adrText({ id: 'ADR-0003', title: 'C' }),
  });
  const view = await loadLogView(root, config());
  const dates = await modifiedAtById(root, view);
  expect(dates.get('ADR-0001')).toBe(mtime(root, A));
  expect(dates.get('ADR-0003')).toBe(mtime(root, 'docs/adr/ADR-0003-c.md'));
  expect(dates.get('ADR-0002')).toBe(committerDate(root, B));
});

test('without git, the file mtime dates the ADR', async () => {
  const root = tmpDir();
  twoAdrs(root);
  const view = await loadLogView(root, config());
  expect(view.mode).toBe('files');
  const dates = await modifiedAtById(root, view);
  expect(dates.get('ADR-0001')).toBe(mtime(root, A));
});

test('an ADR deleted in the working copy keeps its commit date, and one that disappeared is not invented', async () => {
  const root = tmpDir();
  twoAdrs(root);
  initRepo(root);
  git(root, 'rm', '-q', B);
  const view = await loadLogView(root, config());
  const dates = await modifiedAtById(root, view);
  expect(dates.get('ADR-0002')).toBe(committerDate(root, B));
  expect(dates.has('ADR-0009')).toBe(false);
});

test('an id used by several files has no date', async () => {
  const root = tmpDir();
  writeFiles(root, {
    [A]: adrText({ id: 'ADR-0001', title: 'A' }),
    'docs/adr/ADR-0001-copy.md': adrText({ id: 'ADR-0001', title: 'Copy' }),
  });
  initRepo(root);
  const view = await loadLogView(root, config());
  const dates = await modifiedAtById(root, view);
  expect(dates.get('ADR-0001')).toBeNull();
});

test('in a shallow clone the commit dates are unknown, never the date of the boundary commit', async () => {
  const origin = tmpDir();
  twoAdrs(origin);
  initRepo(origin);
  writeFiles(origin, { [B]: adrText({ id: 'ADR-0002', title: 'B again' }) });
  commitAll(origin, 'edit b');
  const clone = tmpDir();
  git(clone, 'clone', '-q', '--depth', '1', pathToFileURL(origin).href, '.');
  const view = await loadLogView(clone, config());
  expect(view.mode).toBe('git');
  const dates = await modifiedAtById(clone, view);
  expect(dates.get('ADR-0001')).toBeNull();
  expect(dates.get('ADR-0002')).toBeNull();
  git(clone, 'rm', '-q', B);
  expect((await modifiedAtById(clone, await loadLogView(clone, config()))).get('ADR-0002')).toBeNull();
});

test('the dates of every ADR come from one git log per version, not one per ADR', async () => {
  const root = tmpDir();
  twoAdrs(root);
  initRepo(root);
  const view = await loadLogView(root, config());
  const seen: string[][] = [];
  await modifiedAtById(root, view, (cwd, args) => {
    seen.push(args);
    return runGit(cwd, args);
  });
  expect(seen.filter((args) => args.includes('log'))).toHaveLength(1);
});

test('an ADR whose file vanished after it was read has no date', async () => {
  const root = tmpDir();
  twoAdrs(root);
  const view = await loadLogView(root, config());
  rmSync(join(root, A));
  expect((await modifiedAtById(root, view)).get('ADR-0001')).toBeNull();
});

test('a git that cannot answer leaves the committed ADRs without a date', async () => {
  const root = tmpDir();
  twoAdrs(root);
  initRepo(root);
  const view = await loadLogView(root, config());
  const answers = [() => null, (args: string[]) => (args.includes('log') ? null : 'false\n')];
  for (const answer of answers) {
    const dates = await modifiedAtById(root, view, async (cwd, args) =>
      args.includes('rev-parse') && args.includes('--show-toplevel') ? await runGit(cwd, args) : answer(args),
    );
    expect(dates.get('ADR-0001')).toBeNull();
  }
});

test('an ADR directory at the root of the log is dated too', async () => {
  const root = tmpDir();
  const flat = parseLogConfigText(configYaml({ adr_dir: '.' }), CONFIG_FILE);
  writeFiles(root, {
    [CONFIG_FILE]: configYaml({ adr_dir: '.' }),
    'ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }),
  });
  initRepo(root);
  const dates = await modifiedAtById(root, await loadLogView(root, flat));
  expect(dates.get('ADR-0001')).toBe(committerDate(root, 'ADR-0001-a.md'));
});

test('a log in a sub-folder of its repository is dated by the commits that touched its files', async () => {
  const repo = tmpDir();
  writeFiles(repo, { 'README.md': '# repo\n' });
  const root = join(repo, 'decisions');
  twoAdrs(root);
  initRepo(repo);
  const dates = await modifiedAtById(root, await loadLogView(root, config()));
  expect(dates.get('ADR-0001')).toBe(committerDate(repo, `decisions/${A}`));
});

test('an ADR is dated by this checkout, not by a newer commit that only the default branch holds', async () => {
  const root = tmpDir();
  twoAdrs(root);
  initRepo(root, { origin: true });
  const before = committerDate(root, B);
  writeFiles(root, { [B]: adrText({ id: 'ADR-0002', title: 'B upstream' }) });
  commitAll(root, 'edit b upstream');
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'reset', '-q', '--hard', 'HEAD~1');
  const view = await loadLogView(root, config());
  const dates = await modifiedAtById(root, view);
  expect(view.base.find((a) => a.meta.id === 'ADR-0002')?.meta.title).toBe('B upstream');
  expect(dates.get('ADR-0002')).toBe(before);
});

test('an ADR only the default branch holds is dated by that branch, wherever the branch keeps its ADRs', async () => {
  const root = tmpDir();
  twoAdrs(root);
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0007-new.md': adrText({ id: 'ADR-0007', title: 'Added upstream' }) });
  commitAll(root, 'add 7 upstream');
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'reset', '-q', '--hard', 'HEAD~1');
  const view = await loadLogView(root, config());
  const dates = await modifiedAtById(root, view);
  expect(dates.get('ADR-0007')).toBe(new Date(git(root, 'log', '-1', '--format=%cI', 'origin/main')).toISOString());
});
