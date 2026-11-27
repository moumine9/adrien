import { join } from 'node:path';
import { CONFIG_FILE, parseLogConfigText } from '../src/config.ts';
import { adrHistoryUrl } from '../src/history-url.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { commitAll, git, initRepo } from './helpers/git.ts';

const config = () => parseLogConfigText(configYaml(), CONFIG_FILE);
const A = 'docs/adr/ADR-0001-a.md';
const B = 'docs/adr/ADR-0002-b.md';

/** A repo whose log sits in `decisions/`, with its own config, committed on main. */
function repoWithLog(): { repo: string; root: string } {
  const repo = tmpDir();
  const root = join(repo, 'decisions');
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    [A]: adrText({ id: 'ADR-0001', title: 'A' }),
    [B]: adrText({ id: 'ADR-0002', title: 'B' }),
  });
  initRepo(repo);
  return { repo, root };
}

const GITHUB = 'git@github.com:o/r.git';
const ADR_LINK = 'https://github.com/o/r/commits/main/decisions/docs/adr/ADR-0001-a.md';

test('links the committed ADR to the history of its file on the default branch of origin', async () => {
  const { repo, root } = repoWithLog();
  git(repo, 'remote', 'add', 'origin', GITHUB);
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const view = await loadLogView(root, config());
  expect(view.baseRef).toBe('origin/main');
  expect(await adrHistoryUrl(root, view, 'ADR-0001')).toBe(ADR_LINK);
});

test('keeps main when origin/HEAD points at it', async () => {
  const { repo, root } = repoWithLog();
  git(repo, 'remote', 'add', 'origin', GITHUB);
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  const view = await loadLogView(root, config());
  expect(await adrHistoryUrl(root, view, 'ADR-0001')).toBe(ADR_LINK);
});

test('gives null for an ADR that exists only in the working tree', async () => {
  const { repo, root } = repoWithLog();
  git(repo, 'remote', 'add', 'origin', GITHUB);
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  writeFiles(root, { 'docs/adr/ADR-0003-c.md': adrText({ id: 'ADR-0003', title: 'C' }) });
  const view = await loadLogView(root, config());
  expect(await adrHistoryUrl(root, view, 'ADR-0003')).toBeNull();
});

test('gives null when two committed files carry the same id', async () => {
  const { repo, root } = repoWithLog();
  writeFiles(root, { 'docs/adr/ADR-0001-copy.md': adrText({ id: 'ADR-0001', title: 'Copy' }) });
  commitAll(repo, 'add a copy');
  git(repo, 'remote', 'add', 'origin', GITHUB);
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const view = await loadLogView(root, config());
  expect(await adrHistoryUrl(root, view, 'ADR-0001')).toBeNull();
});

test('gives null when the base is the local main, with no remote-tracking ref', async () => {
  const { repo, root } = repoWithLog();
  git(repo, 'remote', 'add', 'origin', GITHUB);
  const view = await loadLogView(root, config());
  expect(view.baseRef).toBe('main');
  expect(await adrHistoryUrl(root, view, 'ADR-0001')).toBeNull();
});

test('gives null with a remote-tracking ref but no origin remote', async () => {
  const { repo, root } = repoWithLog();
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const view = await loadLogView(root, config());
  expect(view.baseRef).toBe('origin/main');
  expect(await adrHistoryUrl(root, view, 'ADR-0001')).toBeNull();
});

test('gives null when the log is no longer inside a repository', async () => {
  const { repo, root } = repoWithLog();
  git(repo, 'remote', 'add', 'origin', GITHUB);
  git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
  const view = await loadLogView(root, config());
  expect(await adrHistoryUrl(tmpDir(), view, 'ADR-0001')).toBeNull();
});

test('gives null in files mode, where the log is not a git repository', async () => {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    [A]: adrText({ id: 'ADR-0001', title: 'A' }),
  });
  const view = await loadLogView(root, config());
  expect(view.mode).toBe('files');
  expect(await adrHistoryUrl(root, view, 'ADR-0001')).toBeNull();
});
