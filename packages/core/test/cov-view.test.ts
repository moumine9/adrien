import { CONFIG_FILE, parseLogConfigText } from '../src/config.ts';
import { loadLogView, mergedAdrs } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { commitAll, git, initRepo } from './helpers/git.ts';

test('falls back to working config when the committed config is invalid', async () => {
  const root = tmpDir();
  const config = parseLogConfigText(configYaml({ adr_dir: '.' }), CONFIG_FILE);
  writeFiles(root, { [CONFIG_FILE]: '[', '1-storage.md': '# Storage' });
  initRepo(root);
  const view = await loadLogView(root, config);
  expect(view.mode).toBe('git');
  expect(view.base.map((a) => a.meta.title)).toEqual(['Storage']);
});

test('pending edits retain the latest base version across upstream moves and deletions', async () => {
  const root = tmpDir();
  const config = parseLogConfigText(configYaml(), CONFIG_FILE);
  writeFiles(root, {
    'docs/adr/1-a.md': adrText({ id: 'ADR-0001', title: 'A' }),
    'docs/adr/2-b.md': adrText({ id: 'ADR-0002', title: 'B' }),
  });
  initRepo(root);
  git(root, 'branch', 'topic');
  git(root, 'mv', 'docs/adr/1-a.md', 'docs/adr/moved.md');
  git(root, 'rm', 'docs/adr/2-b.md');
  commitAll(root, 'move and remove');
  git(root, 'checkout', 'topic');
  writeFiles(root, {
    'docs/adr/1-a.md': adrText({ id: 'ADR-0001', title: 'Edited A' }),
    'docs/adr/2-b.md': adrText({ id: 'ADR-0002', title: 'Edited B' }),
  });
  const view = await loadLogView(root, config);
  expect(view.pending.map((c) => [c.id, c.base?.path])).toEqual([
    ['ADR-0001', 'docs/adr/moved.md'],
    ['ADR-0002', 'docs/adr/2-b.md'],
  ]);
  expect(mergedAdrs(view).map((a) => a.meta.title)).toEqual(['Edited A', 'Edited B']);
});

test('merging preserves competing additions at the same path', async () => {
  const root = tmpDir();
  const config = parseLogConfigText(configYaml(), CONFIG_FILE);
  initRepo(root);
  git(root, 'branch', 'topic');
  writeFiles(root, { 'docs/adr/1-a.md': '# Base' });
  commitAll(root, 'upstream addition');
  git(root, 'checkout', 'topic');
  writeFiles(root, { 'docs/adr/1-a.md': '# Topic' });
  const view = await loadLogView(root, config);
  expect(mergedAdrs(view).map((a) => a.meta.title)).toEqual(['Base', 'Topic']);
});
