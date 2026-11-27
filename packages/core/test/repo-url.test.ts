import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { toPosix } from '../src/log.ts';
import { forgeHistoryUrl, isGitUrl, normalizeRepoUrl } from '../src/repo-url.ts';

test.each([
  'git@gitlab.com:acme/billing-service.git',
  'https://gitlab.com/acme/billing-service',
  'https://user:tok@GitLab.com/acme/billing-service.git/',
  'ssh://git@gitlab.com:2222/acme/billing-service.git',
])('normalizes %s to host/group/name', (url) => {
  expect(normalizeRepoUrl(url)).toBe('gitlab.com/acme/billing-service');
});

test('a local path and its file:// URL normalize to the same absolute posix path', () => {
  // On Windows an absolute path gains the current drive (`D:/srv/...`), so compare against the resolved form.
  const expected = toPosix(resolve('/srv/git/decisions'));
  expect(normalizeRepoUrl('/srv/git/decisions.git')).toBe(expected);
  expect(normalizeRepoUrl(pathToFileURL(resolve('/srv/git/decisions.git')).href)).toBe(expected);
});

test('isGitUrl tells URLs from paths', () => {
  expect(isGitUrl('https://gitlab.com/acme/decisions.git')).toBe(true);
  expect(isGitUrl('git@gitlab.com:acme/decisions.git')).toBe(true);
  expect(isGitUrl('file:///srv/decisions')).toBe(true);
  expect(isGitUrl('../decisions')).toBe(false);
  expect(isGitUrl('C:\\code\\decisions')).toBe(false);
});

describe('forgeHistoryUrl', () => {
  test('links a GitHub remote to the commits of a file, scp-like or with credentials', () => {
    const expected = 'https://github.com/o/r/commits/main/docs/adr/ADR-0001-x.md';
    expect(forgeHistoryUrl('git@github.com:o/r.git', 'main', 'docs/adr/ADR-0001-x.md')).toBe(expected);
    expect(forgeHistoryUrl('https://user:token@github.com/o/r.git', 'main', 'docs/adr/ADR-0001-x.md')).toBe(expected);
  });

  test('keeps the port of an https GitLab remote and never its credentials', () => {
    const url = forgeHistoryUrl('https://user:token@gitlab.example.com:8443/g/r.git', 'main', 'adr/x.md');
    expect(url).toBe('https://gitlab.example.com:8443/g/r/-/commits/main/adr/x.md');
    expect(url).not.toContain('user');
    expect(url).not.toContain('token');
  });

  test('drops the SSH port of an ssh GitLab remote', () => {
    expect(forgeHistoryUrl('ssh://git@gitlab.example.com:2222/g/r.git', 'main', 'adr/x.md')).toBe(
      'https://gitlab.example.com/g/r/-/commits/main/adr/x.md',
    );
  });

  test('keeps nested groups and encodes each segment of the file and branch', () => {
    expect(forgeHistoryUrl('https://gitlab.example.com/g/sub/r.git', 'main', 'adr/a b#1.md')).toBe(
      'https://gitlab.example.com/g/sub/r/-/commits/main/adr/a%20b%231.md',
    );
  });

  test('keeps the slashes of a branch name', () => {
    expect(forgeHistoryUrl('git@github.company.com:o/r.git', 'release/1.x', 'adr/x.md')).toBe(
      'https://github.company.com/o/r/commits/release/1.x/adr/x.md',
    );
  });

  test.each([
    'https://git.example.com/o/r.git',
    'git@work-alias:o/r.git',
    '/srv/repos/r',
    'file:///srv/repos/r',
    'https://git hub.com/o/r.git',
    'git@github-work:o/r.git',
    'git@github.com-work:o/r.git',
    'ssh://git@github-work/o/r.git',
  ])('gives null for %s, which is not a known forge', (remote) => {
    expect(forgeHistoryUrl(remote, 'main', 'adr/x.md')).toBeNull();
  });
});
