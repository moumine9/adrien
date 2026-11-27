import { posix, relative } from 'node:path';
import { git, gitToplevel } from './git.ts';
import { toPosix } from './log.ts';
import { forgeHistoryUrl } from './repo-url.ts';
import type { LogView } from './view.ts';

type RunGit = (cwd: string, args: string[]) => Promise<string | null>;

/**
 * The forge page listing the commits of an ADR's file on origin's branch. Null unless the binding version is a
 * remote-tracking branch of origin (so the link names a commit the forge has), the id names exactly one ADR there, and
 * origin is a GitHub or GitLab remote.
 */
export async function adrHistoryUrl(
  logRoot: string,
  view: LogView,
  id: string,
  run: RunGit = git,
): Promise<string | null> {
  const branch = view.baseRef?.startsWith('origin/') ? view.baseRef.slice('origin/'.length) : null;
  if (!branch) return null;
  const matches = view.base.filter((a) => a.meta.id === id);
  const adr = matches.length === 1 ? matches[0] : undefined;
  if (!adr) return null;
  const top = await gitToplevel(logRoot);
  if (!top) return null;
  const remote = (await run(top, ['remote', 'get-url', 'origin']))?.trim();
  if (!remote) return null;
  const file = posix.join(toPosix(relative(top, logRoot)), adr.path);
  return forgeHistoryUrl(remote, branch, file);
}
