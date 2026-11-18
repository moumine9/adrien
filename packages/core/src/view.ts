import { join, relative } from 'node:path';
import { CONFIG_FILE, type LogConfig, parseLogConfigText } from './config.ts';
import { git, gitToplevel, readFileAtRef, readTreeAtRef, resolveBaseRef } from './git.ts';
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
  /** The working-tree ADRs, duplicate ids included. These are the files this checkout can edit. */
  working: Adr[];
  /** Files that failed to parse: in the working tree, and on the default branch when this checkout lacks them. */
  problems: LoadProblem[];
  /**
   * True when the log is in a git repo with commits but none of the default-branch refs exist (a shallow or detached CI
   * checkout, an unusual branch name). Statuses are then read as written, so nothing is verified as merged.
   */
  baseUnresolved?: boolean;
  /**
   * True when the default branch exists but its common ancestor with this checkout does not (a shallow clone), so what
   * the branch changed cannot be told from what landed upstream. Pending changes are then not trustworthy.
   */
  forkUnresolved?: boolean;
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
    const hasCommits = top ? (await git(top, ['rev-parse', '--verify', '--quiet', 'HEAD'])) !== null : false;
    return {
      mode: 'files',
      baseRef: null,
      base: working.adrs,
      pending: [],
      working: working.adrs,
      problems: working.problems,
      ...(top && !baseRef && !ignored && hasCommits ? { baseUnresolved: true } : {}),
    };
  }

  const logFromTop = toPosix(relative(top, logRoot));
  const prefix = logFromTop ? `${logFromTop}/` : '';
  // A revision reads its ADRs with its own config: a branch that moves the log (or changes its id format) must not
  // hide what the default branch still holds where it always was.
  const configAt = async (ref: string): Promise<LogConfig> => {
    const text = await readFileAtRef(top, ref, `${prefix}${CONFIG_FILE}`);
    if (text === null) return config;
    try {
      return parseLogConfigText(text, `${ref}:${prefix}${CONFIG_FILE}`);
    } catch {
      return config;
    }
  };
  const logAt = async (ref: string) => {
    const atRef = await configAt(ref);
    const adrDir = toPosix(relative(top, join(logRoot, atRef.adr_dir)));
    const files = await readTreeAtRef(top, ref, adrDir);
    return parseLogFiles(
      files.filter((f) => f.path.endsWith('.md')).map((f) => ({ path: f.path.slice(prefix.length), text: f.text })),
      atRef,
    );
  };
  const atBase = await logAt(baseRef);
  const base = atBase.adrs;
  // A file the default branch cannot parse would otherwise vanish from the binding view without a word.
  const inTree = new Set([...working.adrs.map((a) => a.path), ...working.problems.map((p) => p.path)]);
  const problems = [...working.problems, ...atBase.problems.filter((p) => !inTree.has(p.path))];
  // Pending = what this checkout changed since it forked from the default branch, so ADRs merged upstream since
  // then stay plain base instead of looking deleted.
  const forkPoint = (await git(top, ['merge-base', 'HEAD', baseRef]))?.trim();
  const baseSha = (await git(top, ['rev-parse', baseRef]))?.trim();
  const fork = forkPoint && forkPoint !== baseSha ? (await logAt(forkPoint)).adrs : base;
  return {
    ...(forkPoint ? {} : { forkUnresolved: true }),
    mode: 'git',
    baseRef,
    base,
    pending: diff(fork, working.adrs).map((change) => ({ ...change, base: latest(change.base, base) })),
    working: working.adrs,
    problems,
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

/** The ADR files in this checkout (what edits and renumbering act on). */
export function workingAdrs(view: LogView): Adr[] {
  return view.working;
}

const sameAdr = (a: Adr, b: Adr): boolean => a.path === b.path && a.meta.id === b.meta.id;

/**
 * What the default branch would hold after merging this checkout: the latest base with every pending change applied.
 * Unlike `workingAdrs`, it includes ADRs merged upstream since this branch forked, so id collisions show up here.
 */
export function mergedAdrs(view: LogView): Adr[] {
  let merged = [...view.base];
  for (const change of view.pending) {
    const gone = change.base;
    if (gone) merged = merged.filter((a) => !sameAdr(a, gone));
    if (change.current) merged.push(change.current);
  }
  return merged.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
