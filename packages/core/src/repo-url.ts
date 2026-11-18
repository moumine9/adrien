import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './log.ts';

const SCP_LIKE = /^(?:[\w.-]+@)?([\w.-]+):(?!\/\/)(.+)$/;
const WINDOWS_DRIVE = /^[A-Za-z]:[\\/]/;

export function isGitUrl(s: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/|file:\/\/)/.test(s);
}

const trimRepoPath = (p: string): string =>
  p
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');

/**
 * Comparable identity of a repo: `host/group/name` for remotes (no credentials, port or `.git`), an absolute posix
 * path for local repos and `file://` URLs.
 */
export function normalizeRepoUrl(url: string): string {
  const s = url.trim();
  if (s.startsWith('file://')) return trimRepoLocal(fileURLToPath(s));
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    const u = new URL(s);
    return `${u.hostname.toLowerCase()}/${trimRepoPath(u.pathname)}`;
  }
  const scp = WINDOWS_DRIVE.test(s) ? null : SCP_LIKE.exec(s);
  if (scp) return `${(scp[1] as string).toLowerCase()}/${trimRepoPath(scp[2] as string)}`;
  return trimRepoLocal(s);
}

function trimRepoLocal(p: string): string {
  return toPosix(resolve(p))
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}
