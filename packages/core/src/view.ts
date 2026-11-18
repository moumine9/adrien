import { join, relative } from 'node:path';
import type { LogConfig } from './config.ts';
import { git, gitToplevel, readTreeAtRef, resolveBaseRef } from './git.ts';
import { type LoadProblem, parseLogFiles, readWorkingLog, toPosix } from './log.ts';
import type { Adr } from './model.ts';

export interface PendingChange {
  id: string;
  kind: 'added' | 'modified' | 'deleted';
  current?: Adr;
  base?: Adr;
}

/**
 * The log in two layers. `base` is the binding version (the default branch, or the files themselves when the log is
 * not in git); `pending` is every difference in the working tree or current branch, which is never binding.
 */
export interface LogView {
  mode: 'git' | 'files';
  baseRef: string | null;
  base: Adr[];
  pending: PendingChange[];
  /** The working-tree ADRs: what the default branch would hold after merging (duplicate ids included). */
  working: Adr[];
  problems: LoadProblem[];
}

const fingerprint = (adr: Adr): string => JSON.stringify([adr.meta, adr.body]);

/** Pairs working and base ADRs by path first (handles duplicate ids), then by id (handles moved files). */
function diff(base: Adr[], working: Adr[]): PendingChange[] {
  const baseByPath = new Map(base.map((a) => [a.path, a]));
  const unmatchedBase = new Map(base.map((a) => [a, true]));
  const pending: PendingChange[] = [];
  const unmatchedWorking: Adr[] = [];

  for (const current of working) {
    const same = baseByPath.get(current.path);
    if (same && same.meta.id === current.meta.id) {
      unmatchedBase.delete(same);
      if (fingerprint(same) !== fingerprint(current))
        pending.push({ id: current.meta.id, kind: 'modified', current, base: same });
    } else {
      unmatchedWorking.push(current);
    }
  }
  for (const current of unmatchedWorking) {
    const moved = [...unmatchedBase.keys()].find((b) => b.meta.id === current.meta.id);
    if (moved) {
      unmatchedBase.delete(moved);
      pending.push({ id: current.meta.id, kind: 'modified', current, base: moved });
    } else {
      pending.push({ id: current.meta.id, kind: 'added', current });
    }
  }
  for (const gone of unmatchedBase.keys()) pending.push({ id: gone.meta.id, kind: 'deleted', base: gone });
  return pending;
}

export async function loadLogView(logRoot: string, config: LogConfig): Promise<LogView> {
  const working = readWorkingLog(logRoot, config);
  const top = await gitToplevel(logRoot);
  const baseRef = top ? await resolveBaseRef(top) : null;
  const adrDirFromTop = top ? toPosix(relative(top, join(logRoot, config.adr_dir))) : '';
  // A log the enclosing repo ignores is not part of that repo: read it as plain files, never as pending additions.
  const ignored = top ? (await git(top, ['check-ignore', '-q', '--', adrDirFromTop || '.'])) !== null : false;
  if (!top || !baseRef || ignored) {
    return {
      mode: 'files',
      baseRef: null,
      base: working.adrs,
      pending: [],
      working: working.adrs,
      problems: working.problems,
    };
  }

  const logFromTop = toPosix(relative(top, logRoot));
  const prefix = logFromTop ? `${logFromTop}/` : '';
  const adrDir = toPosix(relative(top, join(logRoot, config.adr_dir)));
  const logAt = async (ref: string) => {
    const files = await readTreeAtRef(top, ref, adrDir);
    return parseLogFiles(
      files.filter((f) => f.path.endsWith('.md')).map((f) => ({ path: f.path.slice(prefix.length), text: f.text })),
      config,
    ).adrs;
  };
  const base = await logAt(baseRef);
  // Pending = what this checkout changed since it forked from the default branch, so ADRs merged upstream since
  // then stay plain base instead of looking deleted.
  const forkPoint = (await git(top, ['merge-base', 'HEAD', baseRef]))?.trim();
  const baseSha = (await git(top, ['rev-parse', baseRef]))?.trim();
  const fork = forkPoint && forkPoint !== baseSha ? await logAt(forkPoint) : base;
  return {
    mode: 'git',
    baseRef,
    base,
    pending: diff(fork, working.adrs).map((change) => ({ ...change, base: latest(change.base, base) })),
    working: working.adrs,
    problems: working.problems,
  };
}

/** The default-branch version of an ADR seen at the fork point (by path, then by id), so callers compare to base. */
function latest(atFork: Adr | undefined, base: Adr[]): Adr | undefined {
  if (!atFork) return undefined;
  return (
    base.find((a) => a.path === atFork.path && a.meta.id === atFork.meta.id) ??
    base.find((a) => a.meta.id === atFork.meta.id) ??
    atFork
  );
}

/** What the default branch would hold after merging: base with every pending change applied. */
export function workingAdrs(view: LogView): Adr[] {
  return view.working;
}
