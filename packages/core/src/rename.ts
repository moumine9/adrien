import { existsSync, readFileSync, renameSync } from 'node:fs';
import { join, posix } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import YAML from 'yaml';
import { type CommonResolution, readCommon } from './common.ts';
import { CONFIG_FILE, isWorkspaceName, loadLogConfig, parseLogConfigText, workspaceNameOf } from './config.ts';
import type { Context } from './context.ts';
import { AdrienError } from './errors.ts';
import { serializeAdr } from './frontmatter.ts';
import { gitToplevel, remoteUrl } from './git.ts';
import { withAdrLocks, withFolderLock } from './lock.ts';
import { assertInsideLog, readWorkingLog, revisionOfText, toPosix, writeTextAtomic } from './log.ts';
import { assertWritable, lockOptions } from './ops.ts';
import { parseRef } from './ref.ts';
import { isGitUrl, normalizeRepoUrl } from './repo-url.ts';

/** A link field entry to rename: the field it sits in, and the entry before and after the rename. */
export interface RenameRef {
  field: 'related' | 'exception_to';
  from: string;
  to: string;
}

/** An ADR whose `related` or `exception_to` names the old workspace. `revision` is the file it was planned on. */
export interface RenameEdit {
  logRoot: string;
  readOnly: boolean;
  id: string;
  path: string;
  revision: string;
  refs: RenameRef[];
}

/** What a rename will do, planned without writing anything. Apply it with `applyWorkspaceRename`. */
export interface WorkspaceRenamePlan {
  from: string;
  to: string;
  /** The target log's configuration: its planned text, and the revision it was planned on. Null for a catch-up. */
  config: { logRoot: string; path: string; revision: string; text: string } | null;
  /** The target log's ADR folder, moved from `from` to `to` (posix paths relative to its root). Null when it stays. */
  move: { logRoot: string; from: string; to: string } | null;
  edits: RenameEdit[];
  /** The configuration of every other log the plan depends on, as read: a change since refuses the apply. */
  configs: Array<{ logRoot: string; revision: string }>;
  /** What could not be checked, for the person to look at. */
  notes: string[];
}

const NO_IDS: ReadonlySet<string> = new Set();

const collision = (where: string, entry: string, next: string) =>
  new AdrienError(
    'INVALID_INPUT',
    `Renaming would make "${entry}" in ${where} read "${next}", which is a local id of that log: choose another name.`,
  );

const conflict = (path: string) =>
  new AdrienError('ADR_CONFLICT', `${path} changed since the rename was planned: plan it again.`);

/**
 * One entry of a link field, renamed when it names the old workspace. In `related`, an id of the log holding it wins: a
 * local id that contains a slash is never a workspace reference. `exception_to` always names a workspace, so it passes
 * no local ids.
 */
function renameEntry(entry: string, ownIds: ReadonlySet<string>, from: string, to: string): string {
  if (ownIds.has(entry)) return entry;
  const ref = parseRef(entry);
  return ref.workspace === from ? `${to}/${ref.id}` : entry;
}

function refsIn(
  field: RenameRef['field'],
  entries: readonly string[],
  ownIds: ReadonlySet<string>,
  from: string,
  to: string,
  where: string,
): RenameRef[] {
  return entries.flatMap((entry) => {
    const next = renameEntry(entry, ownIds, from, to);
    if (field === 'related' && next !== entry && ownIds.has(next)) throw collision(where, entry, next);
    return next === entry ? [] : [{ field, from: entry, to: next }];
  });
}

/**
 * The edits of one log: its `related` and `exception_to` entries that name `from`, rewritten to `to`. Its problems are
 * noted, and a log that must be written is refused when it is read-only.
 */
function editsIn(ctx: Context, from: string, to: string, notes: string[]): RenameEdit[] {
  const working = readWorkingLog(ctx.logRoot, ctx.config);
  for (const problem of working.problems) {
    notes.push(`${problem.path} could not be read in ${ctx.logSource}, so its references were not checked.`);
  }
  const ownIds = new Set(working.adrs.map((adr) => adr.meta.id));
  return working.adrs.flatMap((adr) => {
    const refs = [
      ...refsIn('related', adr.meta.related, ownIds, from, to, `${adr.meta.id} in ${ctx.logSource}`),
      ...refsIn('exception_to', adr.meta.exception_to, NO_IDS, from, to, adr.meta.id),
    ];
    if (refs.length === 0) return [];
    assertWritable(ctx);
    return [
      {
        logRoot: ctx.logRoot,
        readOnly: ctx.readOnly,
        id: adr.meta.id,
        path: adr.path,
        revision: adr.revision as string,
        refs,
      },
    ];
  });
}

/**
 * The configuration file of a log, read once: its text and revision. A file that no longer parses to the configuration
 * the context was resolved with has changed since, and everything decided from that context would be stale.
 */
function readConfigOnce(ctx: Context): { text: string; revision: string } {
  const file = join(ctx.logRoot, CONFIG_FILE);
  const text = readFileSync(file, 'utf8');
  if (!isDeepStrictEqual(parseLogConfigText(text, file), ctx.config)) throw conflict(CONFIG_FILE);
  return { text, revision: revisionOfText(text) };
}

/**
 * The config text with its `workspace` set, and `adr_dir` set too when the ADR folder moves (`adrDir` is not null).
 * Keeps comments and key order. Validated, so a bad result never reaches disk.
 */
function setWorkspaceName(text: string, name: string, adrDir: string | null, label: string): string {
  const doc = YAML.parseDocument(text);
  doc.set('workspace', name);
  if (adrDir !== null) doc.set('adr_dir', adrDir);
  const next = doc.toString();
  parseLogConfigText(next, label);
  return next;
}

/**
 * Plans the rename of the target log's workspace to `to`: its `workspace` field, and every `related` and `exception_to`
 * entry that names the old name. The target is rewritten, and so is each other log whose `common` field resolves to the
 * target: a common log never refers to its products. Nothing is written here.
 */
export async function planWorkspaceRename(opts: {
  target: Context;
  others: readonly Context[];
  to: string;
}): Promise<WorkspaceRenamePlan> {
  const { target, others, to } = opts;
  // The configuration is read once, here, before anything is awaited: the name, the revision and the text written back
  // all come from this one read.
  const targetConfig = readConfigOnce(target);
  const otherConfigs = new Map(others.map((other) => [other, readConfigOnce(other)]));
  const from = workspaceNameOf(target.config);
  if (from === null) {
    throw new AdrienError(
      'INVALID_INPUT',
      `${target.logSource} has no name to rename: set \`workspace\` in its adrien.config.yaml by hand.`,
    );
  }
  if (!isWorkspaceName(to)) {
    throw new AdrienError(
      'INVALID_INPUT',
      `"${to}" is not a valid workspace name: use lowercase letters, digits, ".", "_" or "-", starting with a letter or a digit.`,
    );
  }
  if (to === from) throw new AdrienError('INVALID_INPUT', `The workspace is already named "${to}".`);
  assertWritable(target);

  const origin = await remoteUrl(target.logRoot);
  const identity = origin ? normalizeRepoUrl(origin) : null;
  const atRepoRoot = (await gitToplevel(target.logRoot)) === target.logRoot;
  const notes: string[] = [];
  const linked: Context[] = [];
  for (const other of others) {
    const commonUrl = other.config.common;
    if (commonUrl === undefined) continue;
    // A common named by a git URL is a cached clone of that repo's root: it is the target when the URL is the target's
    // own origin and the target is that repo's root. That is settled from the URL alone, so a clone that cannot be made
    // does not hide the product. A log in a subfolder is not the log at the root, and another repo can hold a log with
    // the same name.
    const sameRepo = isGitUrl(commonUrl) && identity !== null && normalizeRepoUrl(commonUrl) === identity;
    if (sameRepo && atRepoRoot) {
      linked.push(other);
      continue;
    }
    // `common` is set, so there is a resolution to read.
    const read = (await readCommon(other)) as CommonResolution;
    if ('unreadable' in read) {
      notes.push(
        `${other.logSource} has a common log at ${commonUrl} that could not be read, so it was not checked and not rewritten.`,
      );
      continue;
    }
    if (read.common.ctx.logRoot === target.logRoot) linked.push(other);
    else if (isGitUrl(commonUrl) && (sameRepo || read.common.name === from)) {
      const why = !sameRepo
        ? identity === null
          ? 'cannot be matched to this log, which has no `origin`'
          : "is not this log's repository"
        : "is the root of this log's repository, and this log is in a subfolder of it";
      notes.push(`${other.logSource} has a common log at ${commonUrl} that ${why}, so it was not rewritten.`);
    }
  }
  const targetCommon = await readCommon(target);
  const names = [
    ...others.map((other) => workspaceNameOf(other.config)),
    targetCommon && 'common' in targetCommon ? targetCommon.common.name : null,
  ];
  if (names.includes(to)) {
    throw new AdrienError('INVALID_INPUT', `"${to}" is already the name of a log this rename reaches.`);
  }

  // The ADR folder moves only when its last segment is the old name: `<parent>/<old>` becomes `<parent>/<new>`.
  const adrDir = posix.normalize(toPosix(target.config.adr_dir)).replace(/(.)\/+$/, '$1');
  let move: WorkspaceRenamePlan['move'] = null;
  if (posix.basename(adrDir) === from) {
    const parent = posix.dirname(adrDir);
    const moved = parent === '.' ? to : `${parent}/${to}`;
    const fromPath = join(target.logRoot, ...adrDir.split('/'));
    const toPath = join(target.logRoot, ...moved.split('/'));
    assertInsideLog(target.logRoot, fromPath, adrDir);
    assertInsideLog(target.logRoot, toPath, moved);
    if (existsSync(toPath)) {
      throw new AdrienError(
        'INVALID_INPUT',
        `${moved} already exists, so the ADR folder cannot move there: choose another name, or move that folder first.`,
      );
    }
    move = { logRoot: target.logRoot, from: adrDir, to: moved };
  } else {
    notes.push(`The ADR folder ${target.config.adr_dir} is not named after the workspace, so it was left where it is.`);
  }

  const edits: RenameEdit[] = [];
  const configs: WorkspaceRenamePlan['configs'] = [];
  for (const ctx of [target, ...linked]) {
    if (ctx !== target)
      configs.push({ logRoot: ctx.logRoot, revision: (otherConfigs.get(ctx) as { revision: string }).revision });
    // A log named like the target reads `old/ADR-n` as its own decision, so those entries are not about the target.
    if (ctx !== target && workspaceNameOf(ctx.config) === from) {
      const named = readWorkingLog(ctx.logRoot, ctx.config).adrs.some((adr) =>
        [...adr.meta.related, ...adr.meta.exception_to].some((entry) => parseRef(entry).workspace === from),
      );
      if (named) {
        notes.push(
          `${ctx.logSource} has the same name as this log, so its "${from}/..." references name its own decisions and were kept.`,
        );
      }
      continue;
    }
    edits.push(...editsIn(ctx, from, to, notes));
  }

  return {
    from,
    to,
    config: {
      logRoot: target.logRoot,
      path: CONFIG_FILE,
      revision: targetConfig.revision,
      text: setWorkspaceName(targetConfig.text, to, move === null ? null : move.to, join(target.logRoot, CONFIG_FILE)),
    },
    move,
    edits,
    configs,
    notes,
  };
}

/**
 * Plans the catch-up of logs whose common log was renamed to `to` after the rename ran elsewhere: in each log, the
 * `related` and `exception_to` entries that name `from` are rewritten to `to`. Nothing is renamed and no configuration is
 * written, so the plan's `config` is null. Every log is checked first, so one that fails refuses the whole plan.
 */
export async function planReferenceCatchUp(opts: {
  logs: readonly Context[];
  from: string;
  to: string;
}): Promise<WorkspaceRenamePlan> {
  const { logs, from, to } = opts;
  const edits: RenameEdit[] = [];
  const configs: WorkspaceRenamePlan['configs'] = [];
  const notes: string[] = [];
  // Every configuration is read once, before anything is awaited.
  const readConfigs = new Map(logs.map((ctx) => [ctx, readConfigOnce(ctx)]));
  for (const ctx of logs) {
    const config = readConfigs.get(ctx) as { revision: string };
    const fail = (message: string) => new AdrienError('INVALID_INPUT', `${ctx.logSource}: ${message}`);
    if (!isWorkspaceName(to)) throw fail(`"${to}" is not a valid workspace name.`);
    if (from === to) throw fail(`The new name "${to}" is the old one: nothing to catch up.`);
    const own = workspaceNameOf(ctx.config);
    if (own === from) {
      throw fail(`it is named "${from}", so its "${from}/..." references name its own decisions.`);
    }
    if (own === to) {
      throw fail(`it is already named "${to}", so "${from}/..." references rewritten to it would read as its own.`);
    }
    if (ctx.config.common === undefined) {
      throw fail('it has no common field, so it is not a product of a common log: nothing to catch up.');
    }
    const read = (await readCommon(ctx)) as CommonResolution;
    if ('unreadable' in read) {
      throw fail(`its common log at ${read.unreadable.location} cannot be read: ${read.unreadable.message}`);
    }
    const { name } = read.common;
    if (name === from) {
      const cached = isGitUrl(ctx.config.common)
        ? ` Its common log is read from a cached clone, which is reused as it is: remove ${read.common.ctx.logRoot} so the next run clones it again.`
        : '';
      throw fail(`its common log is still named "${from}": rename it to "${to}" first, or merge that rename.${cached}`);
    }
    if (name !== to) throw fail(`its common log is named "${name}", not "${to}".`);
    configs.push({ logRoot: ctx.logRoot, revision: config.revision });
    // The common log's name was just checked, so its configuration is part of what the plan depends on.
    configs.push({ logRoot: read.common.ctx.logRoot, revision: readConfigOnce(read.common.ctx).revision });
    assertWritable(ctx);
    edits.push(...editsIn(ctx, from, to, notes));
  }
  return { from, to, config: null, move: null, edits, configs, notes };
}

/** The absolute path of a posix folder path inside a log. */
const folderPath = (logRoot: string, relPath: string): string => join(logRoot, ...relPath.split('/'));

/** Runs `fn` while holding the locks of each log's given ADR ids, one log after another, in the order given. */
function withLogs<T>(groups: ReadonlyArray<[string, string[]]>, env: NodeJS.ProcessEnv, fn: () => T): T {
  const [head, ...rest] = groups;
  if (!head) return fn();
  return withAdrLocks(head[0], head[1], () => withLogs(rest, env, fn), lockOptions(env));
}

/**
 * Applies a plan. Every log's ADRs are locked and checked against the revisions planned, and the config against its own,
 * before the first write, so a change made since the plan refuses the whole rename with nothing written. ADRs are written
 * first, then the ADR folder moves, and the config last. A move changes the path of every ADR of the target log, so every
 * ADR of that log is locked, not only the edited ones.
 */
export function applyWorkspaceRename(plan: WorkspaceRenamePlan, env: NodeJS.ProcessEnv = process.env): void {
  for (const edit of plan.edits) {
    if (edit.readOnly) {
      throw new AdrienError(
        'READ_ONLY_LOG',
        `${edit.logRoot} is a read-only cached clone: check out the log repo to rename there.`,
      );
    }
  }
  const byLog = new Map<string, RenameEdit[]>();
  for (const edit of plan.edits) byLog.set(edit.logRoot, [...(byLog.get(edit.logRoot) ?? []), edit]);
  const groups = [...byLog].sort(([a], [b]) => a.localeCompare(b));
  const { move } = plan;

  // The ids to lock: the edited ADRs of each log, and for a move every ADR of the target log.
  const lockIds = new Map<string, string[]>(groups.map(([logRoot, edits]) => [logRoot, edits.map((edit) => edit.id)]));
  if (!move) {
    applyLocked(plan, groups, lockIds, env);
    return;
  }
  // A move first takes the folder lock, which a new ADR also takes, so no proposal writes into the folder while it moves.
  // Nothing takes the folder lock while holding an ADR lock, so taking it before the ADR locks cannot deadlock. The ids
  // are read under it: an ADR that Adrien creates is then either already among them or waits until the move is done.
  withFolderLock(
    move.logRoot,
    () => {
      const everyId = readWorkingLog(move.logRoot, loadLogConfig(move.logRoot)).adrs.map((adr) => adr.meta.id);
      lockIds.set(move.logRoot, [...new Set([...(lockIds.get(move.logRoot) ?? []), ...everyId])]);
      applyLocked(plan, groups, lockIds, env);
    },
    lockOptions(env),
  );
}

/** The rest of an apply, under the ADR locks of `lockIds`: checks, then the writes, undone if one fails. */
function applyLocked(
  plan: WorkspaceRenamePlan,
  groups: ReadonlyArray<[string, RenameEdit[]]>,
  lockIds: ReadonlyMap<string, string[]>,
  env: NodeJS.ProcessEnv,
): void {
  const { config, move } = plan;
  withLogs(
    [...lockIds].sort(([a], [b]) => a.localeCompare(b)),
    env,
    () => {
      if (config && revisionOfText(readFileSync(join(config.logRoot, config.path), 'utf8')) !== config.revision) {
        throw conflict(config.path);
      }
      for (const { logRoot, revision } of plan.configs) {
        if (revisionOfText(readFileSync(join(logRoot, CONFIG_FILE), 'utf8')) !== revision) throw conflict(CONFIG_FILE);
      }
      const folders = move && { from: folderPath(move.logRoot, move.from), to: folderPath(move.logRoot, move.to) };
      if (move && folders) {
        assertInsideLog(move.logRoot, folders.from, move.from);
        assertInsideLog(move.logRoot, folders.to, move.to);
        if (!existsSync(folders.from)) throw conflict(move.from);
        if (existsSync(folders.to)) throw conflict(move.to);
        // A file added by hand since the ids were read (Adrien itself waits for the folder lock) is not locked, and the
        // move would take it from under whoever is writing it.
        const locked = new Set(lockIds.get(move.logRoot));
        if (readWorkingLog(move.logRoot, loadLogConfig(move.logRoot)).adrs.some((adr) => !locked.has(adr.meta.id))) {
          throw conflict(move.from);
        }
      }
      const writes = groups.flatMap(([logRoot, edits]) => {
        const { adrs } = readWorkingLog(logRoot, loadLogConfig(logRoot));
        const ownIds = new Set(adrs.map((adr) => adr.meta.id));
        return edits.map((edit) => {
          const adr = adrs.find((candidate) => candidate.path === edit.path);
          if (!adr || adr.revision !== edit.revision) throw conflict(edit.path);
          const related = adr.meta.related.map((entry) => {
            const next = renameEntry(entry, ownIds, plan.from, plan.to);
            if (next !== entry && ownIds.has(next)) throw conflict(edit.path);
            return next;
          });
          const exception_to = adr.meta.exception_to.map((entry) => renameEntry(entry, NO_IDS, plan.from, plan.to));
          return { logRoot, adr: { ...adr, meta: { ...adr.meta, related, exception_to } } };
        });
      });
      // Each file's text before the first write, so a failed write can be put back.
      const steps: Step[] = writes.map(({ logRoot, adr }) => {
        const file = join(logRoot, ...adr.path.split('/'));
        assertInsideLog(logRoot, file, adr.path);
        return textStep(file, readFileSync(file, 'utf8'), serializeAdr(adr));
      });
      if (folders) {
        const { from, to } = folders;
        steps.push({ label: from, write: () => renameSync(from, to), undo: () => renameSync(to, from) });
      }
      if (config) {
        const file = join(config.logRoot, config.path);
        steps.push(textStep(file, readFileSync(file, 'utf8'), config.text));
      }
      const written: Step[] = [];
      try {
        for (const step of steps) {
          step.write();
          written.push(step);
        }
      } catch (error) {
        rollBack(written, steps.slice(written.length), error);
      }
    },
  );
}

/** One write of an apply, and what undoes it. `label` names the file or folder in a message. */
interface Step {
  label: string;
  write: () => void;
  undo: () => void;
}

/** A step that writes `text` over `file`, and puts back `original` when undone. */
const textStep = (file: string, original: string, text: string): Step => ({
  label: file,
  write: () => writeTextAtomic(file, text),
  undo: () => writeTextAtomic(file, original),
});

/** The message of an error the file calls threw, which are always `Error`s. */
const messageOf = (error: unknown): string => (error as Error).message;

/**
 * Undoes the writes already made, in reverse order, then rethrows the original error. The write that failed was never
 * made, because a write is atomic. A write that cannot be undone is reported with the others, and the error names each one.
 */
function rollBack(written: readonly Step[], pending: readonly Step[], cause: unknown): never {
  const lines: string[] = [];
  let restoredAll = true;
  for (const step of [...written].reverse()) {
    try {
      step.undo();
      lines.push(`${step.label}: restored`);
    } catch (e) {
      restoredAll = false;
      lines.push(`${step.label}: left renamed (restore failed: ${messageOf(e)})`);
    }
  }
  if (restoredAll) throw cause;
  for (const step of pending) lines.push(`${step.label}: unchanged`);
  throw new AdrienError(
    'ADR_CONFLICT',
    `The rename failed (${messageOf(cause)}) and could not be fully undone, so the log is in a mixed state: put the files marked "left renamed" back by hand, or rename them again.\n${lines.join('\n')}`,
  );
}
