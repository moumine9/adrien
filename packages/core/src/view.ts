import { join, relative } from 'node:path';
import type { LogConfig } from './config.ts';
import { gitToplevel, readTreeAtRef, resolveBaseRef } from './git.ts';
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
  if (!top || !baseRef) {
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
  const files = await readTreeAtRef(top, baseRef, toPosix(relative(top, join(logRoot, config.adr_dir))));
  const baseLog = parseLogFiles(
    files.filter((f) => f.path.endsWith('.md')).map((f) => ({ path: f.path.slice(prefix.length), text: f.text })),
    config,
  );
  return {
    mode: 'git',
    baseRef,
    base: baseLog.adrs,
    pending: diff(baseLog.adrs, working.adrs),
    working: working.adrs,
    problems: working.problems,
  };
}

/** What the default branch would hold after merging: base with every pending change applied. */
export function workingAdrs(view: LogView): Adr[] {
  return view.working;
}
