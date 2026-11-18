import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { tmpDir } from './fixtures.ts';

let isolatedEnv: NodeJS.ProcessEnv | undefined;

/** Git env that ignores the developer's global/system config (signing, hooks, autocrlf). */
export function gitEnv(): NodeJS.ProcessEnv {
  if (!isolatedEnv) {
    const globalConfig = join(realpathSync(mkdtempSync(join(tmpdir(), 'adrien-gitcfg-'))), 'gitconfig');
    writeFileSync(globalConfig, '');
    isolatedEnv = {
      ...process.env,
      GIT_CONFIG_GLOBAL: globalConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
    };
  }
  return isolatedEnv;
}

export function git(cwd: string, ...args: string[]): string {
  const base = ['-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'init.defaultBranch=main'];
  return execFileSync('git', [...base, '-c', 'core.autocrlf=false', ...args], {
    cwd,
    env: gitEnv(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function commitAll(root: string, message: string): void {
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '--allow-empty', '-m', message);
}

/** `git init` + commit everything; with `origin`, also a pushed bare remote with origin/HEAD set. */
export function initRepo(root: string, opts: { origin?: boolean } = {}): { origin: string | null } {
  git(root, 'init', '-q');
  commitAll(root, 'init');
  if (!opts.origin) return { origin: null };
  const origin = tmpDir();
  git(origin, 'init', '-q', '--bare');
  git(root, 'remote', 'add', 'origin', origin);
  git(root, 'push', '-q', 'origin', 'main');
  git(root, 'remote', 'set-head', 'origin', 'main');
  return { origin };
}
