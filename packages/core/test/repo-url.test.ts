import { isGitUrl, normalizeRepoUrl } from '../src/repo-url.ts';

test.each([
  'git@gitlab.com:acme/billing-service.git',
  'https://gitlab.com/acme/billing-service',
  'https://user:tok@GitLab.com/acme/billing-service.git/',
  'ssh://git@gitlab.com:2222/acme/billing-service.git',
])('normalizes %s to host/group/name', (url) => {
  expect(normalizeRepoUrl(url)).toBe('gitlab.com/acme/billing-service');
});

test('a local path and its file:// URL normalize to the same absolute posix path', () => {
  expect(normalizeRepoUrl('/srv/git/decisions.git')).toBe('/srv/git/decisions');
  expect(normalizeRepoUrl('file:///srv/git/decisions.git')).toBe('/srv/git/decisions');
});

test('isGitUrl tells URLs from paths', () => {
  expect(isGitUrl('https://gitlab.com/acme/decisions.git')).toBe(true);
  expect(isGitUrl('git@gitlab.com:acme/decisions.git')).toBe(true);
  expect(isGitUrl('file:///srv/decisions')).toBe(true);
  expect(isGitUrl('../decisions')).toBe(false);
  expect(isGitUrl('C:\\code\\decisions')).toBe(false);
});
