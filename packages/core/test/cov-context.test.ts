import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { vi } from 'vitest';
import { CODE_CONFIG_FILE, CONFIG_FILE } from '../src/config.ts';
import {
  adrienHome,
  componentForPath,
  ensureCachedClone,
  resolveContext,
  syncCachedClone,
  workspacePaths,
} from '../src/context.ts';
import * as gitModule from '../src/git.ts';
import { configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';

test('an explicit log outside a checkout has no component for local paths', async () => {
  const log = tmpDir();
  writeFiles(log, { [CONFIG_FILE]: configYaml() });
  const ctx = await resolveContext({ cwd: tmpDir(), log });
  expect(ctx.env).toBe(process.env);
  expect(componentForPath(ctx, 'src/main.ts')).toBeNull();
});

test('a code config can explicitly select components without a git remote', async () => {
  const dir = tmpDir();
  writeFiles(dir, {
    [CONFIG_FILE]: configYaml(),
    [`code/${CODE_CONFIG_FILE}`]: 'log: ..\ncomponents: [billing-service]',
  });
  const cwd = join(dir, 'code');
  expect((await resolveContext({ cwd, env: {} })).codeRepo).toEqual({ root: cwd, components: ['billing-service'] });
});

test('an empty workspace file still allows environment overrides', () => {
  const home = tmpDir();
  writeFiles(home, { 'workspace.yaml': '' });
  expect(adrienHome({})).toBe(join(homedir(), '.adrien'));
  expect(workspacePaths({ ADRIEN_HOME: home, ADRIEN_REPOS: 'web=checkout' })).toEqual({ web: 'checkout' });
});

test('a missing local clone source is identified in the error', async () => {
  const url = pathToFileURL(join(tmpDir(), 'missing')).href;
  await expect(ensureCachedClone(url, tmpDir())).rejects.toMatchObject({
    code: 'CONFIG_INVALID',
    message: `Could not clone the ADR log from ${url}`,
  });
});

test('sync tries origin/HEAD when the cache has no resolvable default branch', async () => {
  const dir = tmpDir();
  const git = vi.spyOn(gitModule, 'git').mockImplementation(async (_dir, args) => (args[0] === 'fetch' ? '' : null));
  try {
    await expect(syncCachedClone(dir)).rejects.toThrow('origin/HEAD');
    expect(git).toHaveBeenCalledWith(dir, ['checkout', '--quiet', '--detach', 'origin/HEAD']);
  } finally {
    git.mockRestore();
  }
});

test('sync says so when the fetch fails, instead of reporting success on a stale copy', async () => {
  const git = vi.spyOn(gitModule, 'git').mockResolvedValue(null);
  try {
    await expect(syncCachedClone(tmpDir())).rejects.toMatchObject({
      code: 'CONFIG_INVALID',
      message: expect.stringContaining('Could not fetch'),
    });
    expect(git).toHaveBeenCalledTimes(1);
  } finally {
    git.mockRestore();
  }
});
