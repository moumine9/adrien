import { resolve } from 'node:path';
import { normalizeRepoUrl } from '../src/repo-url.ts';

test('a drive letter before a slash is part of a local path', () => {
  expect(normalizeRepoUrl('C:/code/log.git')).toBe(resolve('C:/code/log').replaceAll('\\', '/'));
});
