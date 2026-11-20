import { statSync } from 'node:fs';
import { join, posix, relative } from 'node:path';
import type { LogConfig } from './config.ts';
import { git, gitToplevel } from './git.ts';
import { toPosix } from './log.ts';
import type { Adr } from './model.ts';
import type { LogView } from './view.ts';

type RunGit = (cwd: string, args: string[]) => Promise<string | null>;

/** The ISO time of the file's last write, or null when it cannot be read. */
function mtimeOf(logRoot: string, path: string): string | null {
  try {
    return statSync(join(logRoot, ...path.split('/'))).mtime.toISOString();
  } catch {
    return null;
  }
}

/**
 * The committer date of the last commit reachable from `ref` that touched each file under `dirs` (paths from the
 * repository top), from a single `git log`. Empty when the history is shallow: its oldest commit would claim every file.
 */
async function commitDates(top: string, ref: string, dirs: string[], run: RunGit): Promise<Map<string, string>> {
  const dates = new Map<string, string>();
  if ((await run(top, ['rev-parse', '--is-shallow-repository']))?.trim() !== 'false') return dates;
  const out = await run(top, [
    '-c',
    'core.quotepath=false',
    'log',
    '--no-renames',
    '--format=@@%cI',
    '--name-only',
    ref,
    '--',
    ...dirs,
  ]);
  let date = '';
  // Newest first: the first commit that names a path is the last one that touched it.
  for (const line of (out ?? '').split('\n')) {
    if (line.startsWith('@@')) date = new Date(line.slice(2)).toISOString();
    else if (line && !dates.has(line)) dates.set(line, date);
  }
  return dates;
}

/**
 * When each ADR was last changed, by id: the version in this checkout, as the revision describes it.
 * An ADR the checkout changes (or any ADR when there is no default branch to read) is dated by its file's mtime.
 * An unchanged one is dated by the last commit of this checkout (`HEAD`) that touched its file, never by its mtime, which
 * a clone resets. An ADR only the default branch holds (deleted here, or added upstream) is dated by the last commit on
 * that branch. Null when it cannot be known (a shallow history, an id used by several files). At most two `git log`
 * calls serve every ADR.
 */
export async function modifiedAtById(
  logRoot: string,
  config: LogConfig,
  view: LogView,
  run: RunGit = git,
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  const changed = new Set(view.pending.map((c) => c.id));
  // There is a default branch to read only in git mode, where the log is inside a repository.
  const top = view.baseRef ? await gitToplevel(logRoot) : null;
  const prefix = top ? toPosix(relative(top, logRoot)) : '';
  const fromTop = (path: string) => posix.join(prefix, path);
  // The folders the ADRs actually sit in, in either version: a default branch may keep them where this checkout does not.
  const dirs = (adrs: Adr[]) => [...new Set(adrs.map((a) => posix.dirname(fromTop(a.path))))];
  const datesAt = async (ref: string, adrs: Adr[]) =>
    top && adrs.length ? await commitDates(top, ref, dirs(adrs), run) : new Map<string, string>();

  const held = (id: string) => view.working.filter((a) => a.meta.id === id).length;
  const unchanged = view.working.filter((a) => view.mode === 'git' && !changed.has(a.meta.id) && held(a.meta.id) === 1);
  const baseOnly = view.base.filter((a) => !view.working.some((w) => w.meta.id === a.meta.id));
  const [atHead, atBase] = [await datesAt('HEAD', unchanged), await datesAt(view.baseRef as string, baseOnly)];

  for (const adr of view.working) {
    const id = adr.meta.id;
    if (held(id) > 1) result.set(id, null);
    else if (view.mode === 'files' || changed.has(id)) result.set(id, mtimeOf(logRoot, adr.path));
    else result.set(id, atHead.get(fromTop(adr.path)) ?? null);
  }
  for (const adr of baseOnly) result.set(adr.meta.id, atBase.get(fromTop(adr.path)) ?? null);
  return result;
}
