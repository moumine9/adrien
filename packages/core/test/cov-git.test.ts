import { join } from 'node:path';
import { gitToplevel, listFiles, readTreeAtRef } from '../src/git.ts';
import { tmpDir, writeFiles } from './helpers/fixtures.ts';
import { git, initRepo } from './helpers/git.ts';

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
