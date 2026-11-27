import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toPosix } from './log.ts';
import { canonicalPath } from './paths.ts';

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

const encodePath = (p: string): string => p.split('/').map(encodeURIComponent).join('/');

/** A host an SSH remote names may be an alias from the SSH config (`github-work`), not a web address: only a DNS name is. */
const DNS_NAME = /^([a-z0-9-]+\.)+[a-z]{2,}$/;

/** Where a remote's forge lives (`origin`, without credentials) and the host and repo path it names. */
function remoteOrigin(s: string): { origin: string; host: string; path: string } | null {
  if (/^(https?|ssh):\/\//i.test(s)) {
    // A remote git accepts may still not be a valid URL: no link rather than a thrown error.
    if (!URL.canParse(s)) return null;
    const u = new URL(s);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'ssh:')
      return { origin: `${u.protocol}//${host}${u.port ? `:${u.port}` : ''}`, host, path: u.pathname };
    // An SSH port is not a web port: the forge is reached over https on its default port.
    return DNS_NAME.test(host) ? { origin: `https://${host}`, host, path: u.pathname } : null;
  }
  const scp = SCP_LIKE.exec(s);
  if (!scp) return null;
  const host = (scp[1] as string).toLowerCase();
  return DNS_NAME.test(host) ? { origin: `https://${host}`, host, path: scp[2] as string } : null;
}

/**
 * The web page listing the commits of one file on a GitHub or GitLab remote, on the given branch. Null for any other
 * host (an SSH host alias, a local path, `file://`), whose web address cannot be known from the remote.
 */
export function forgeHistoryUrl(remote: string, branch: string, filePath: string): string | null {
  const parts = remoteOrigin(remote.trim());
  if (!parts) return null;
  const repo = trimRepoPath(parts.path);
  const ref = encodePath(branch);
  const file = encodePath(filePath);
  if (parts.host.includes('github')) return `${parts.origin}/${repo}/commits/${ref}/${file}`;
  if (parts.host.includes('gitlab')) return `${parts.origin}/${repo}/-/commits/${ref}/${file}`;
  return null;
}

function trimRepoLocal(p: string): string {
  return toPosix(canonicalPath(resolve(p)))
    .replace(/\/+$/, '')
    .replace(/\.git$/, '');
}
