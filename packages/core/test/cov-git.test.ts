import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { changedFiles, gitToplevel, listFiles, readTreeAtRef } from '../src/git.ts';
import { tmpDir, writeFiles } from './helpers/fixtures.ts';
import { commitAll, git, initRepo } from './helpers/git.ts';

test('missing directories and plain directories have distinct listing behavior', async () => {
  const root = tmpDir();
  expect(await gitToplevel(join(root, 'missing'))).toBeNull();
  expect(await listFiles(root, 'missing')).toEqual([]);
  writeFiles(root, { 'src/lib/a': '', 'src/.git/config': '', 'src/node_modules/pkg/file': '' });
  expect(await listFiles(root, 'src')).toEqual(['lib/a']);
});

test('git lists untracked files but only reads committed blobs at a ref', async () => {
  const root = tmpDir();
  writeFiles(root, { 'tracked.txt': 'café', '.gitignore': 'ignored.txt\n' });
  initRepo(root);
  git(
    root,
    'update-index',
    '--add',
    '--cacheinfo',
    '160000',
    '1'.repeat(git(root, 'rev-parse', 'HEAD').length),
    'linked',
  );
  git(root, 'commit', '-qm', 'record gitlink');
  writeFiles(root, { 'ignored.txt': '', 'new.txt': '' });
  expect(await listFiles(root)).toContain('new.txt');
  expect(await listFiles(root)).not.toContain('ignored.txt');
  expect(await readTreeAtRef(root, 'HEAD', '')).toEqual([
    { path: '.gitignore', text: 'ignored.txt\n' },
    { path: 'tracked.txt', text: 'café' },
  ]);
});

test('propagates a nonzero exit after the tree listing succeeds', async () => {
  const root = tmpDir();
  writeFiles(root, { 'record.txt': 'decision' });
  initRepo(root);
  const blob = git(root, 'rev-parse', 'HEAD:record.txt');
  // Listing names does not load blobs; resolving this blob follows a replacement cycle.
  git(root, 'update-ref', `refs/replace/${blob}`, blob);
  await expect(readTreeAtRef(root, 'HEAD', '')).rejects.toThrow('git cat-file exited');
});

test('a tracked directory replaced by a file is listed without its old paths, and does not throw', async () => {
  const root = tmpDir();
  writeFiles(root, { 'src/old.ts': 'export {};\n' });
  initRepo(root);
  rmSync(join(root, 'src'), { recursive: true });
  writeFiles(root, { src: 'now a file\n' });
  // `git ls-files` still reports src/old.ts: lstat on it fails with ENOTDIR, which means the path is gone.
  expect(await listFiles(root)).toEqual(['src']);
});

test('changedFiles lists what a range changes, relative to the repo top; null for a bad ref; [] when nothing changed', async () => {
  const root = tmpDir();
  writeFiles(root, { 'src/a.ts': 'a\n', 'src/gone.ts': 'g\n' });
  initRepo(root);
  git(root, 'checkout', '-q', '-b', 'feature');
  writeFiles(root, { 'src/a.ts': 'changed\n', 'src/new.ts': 'n\n' });
  rmSync(join(root, 'src/gone.ts'));
  commitAll(root, 'change');
  expect(await changedFiles(root, 'main', 'HEAD')).toEqual(['src/a.ts', 'src/gone.ts', 'src/new.ts']);
  expect(await changedFiles(root, 'no-such-ref', 'HEAD')).toBeNull();
  expect(await changedFiles(root, 'HEAD', 'HEAD')).toEqual([]);
});

test('changedFiles lists both sides of a rename, so moving a file out of a governed place is still seen', async () => {
  const root = tmpDir();
  writeFiles(root, { 'billing/src/store.ts': 'export const store = 1;\n' });
  initRepo(root);
  git(root, 'checkout', '-q', '-b', 'feature');
  git(root, 'mv', 'billing/src/store.ts', 'misc.ts');
  commitAll(root, 'move');
  expect(await changedFiles(root, 'main', 'HEAD')).toEqual(['billing/src/store.ts', 'misc.ts']);
});
