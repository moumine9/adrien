import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';
import { readCommon } from './common.ts';
import { CONFIG_FILE, isWorkspaceName, loadLogConfig, parseLogConfigText, workspaceNameOf } from './config.ts';
import type { Context } from './context.ts';
import { AdrienError } from './errors.ts';
import { remoteUrl } from './git.ts';
import { withAdrLocks } from './lock.ts';
import { readWorkingLog, revisionOfText, writeAdr } from './log.ts';
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
  /** The target log's configuration: its planned text, and the revision it was planned on. */
  config: { logRoot: string; path: string; revision: string; text: string };
  edits: RenameEdit[];
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

/** The config text with its `workspace` set, keeping comments and key order. Validated, so a bad result never reaches disk. */
function setWorkspaceName(text: string, name: string, label: string): string {
  const doc = YAML.parseDocument(text);
  doc.set('workspace', name);
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
  const notes: string[] = [];
  const linked: Context[] = [];
  for (const other of others) {
    const read = await readCommon(other);
    if (!read || !('common' in read)) continue;
    // A common named by a path is the target when it is the target's root. A common named by a git URL is a cached clone
    // of that repo's root: it is the target when the URL is the target's own origin and the log it holds has the old name.
    // Either alone is not enough: another repo can hold a log with the same name, and a log in a subfolder of a repo is
    // not the log at that repo's root.
    const commonUrl = other.config.common as string;
    const sameRepo = isGitUrl(commonUrl) && identity !== null && normalizeRepoUrl(commonUrl) === identity;
    const sameName = read.common.name === from;
    if (read.common.ctx.logRoot === target.logRoot || (sameRepo && sameName)) linked.push(other);
    else if (isGitUrl(commonUrl) && (sameRepo || sameName)) {
      const why = sameRepo
        ? `holds a log named "${read.common.name}", not this one`
        : identity === null
          ? 'cannot be matched to this log, which has no `origin`'
          : "is not this log's repository";
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

  const edits: RenameEdit[] = [];
  for (const ctx of [target, ...linked]) {
    const working = readWorkingLog(ctx.logRoot, ctx.config);
    for (const problem of working.problems) {
      notes.push(`${problem.path} could not be read in ${ctx.logSource}, so its references were not checked.`);
    }
    const ownIds = new Set(working.adrs.map((adr) => adr.meta.id));
    for (const adr of working.adrs) {
      const refs = [
        ...refsIn('related', adr.meta.related, ownIds, from, to, `${adr.meta.id} in ${ctx.logSource}`),
        ...refsIn('exception_to', adr.meta.exception_to, NO_IDS, from, to, adr.meta.id),
      ];
      if (refs.length === 0) continue;
      assertWritable(ctx);
      edits.push({
        logRoot: ctx.logRoot,
        readOnly: ctx.readOnly,
        id: adr.meta.id,
        path: adr.path,
        revision: adr.revision as string,
        refs,
      });
    }
  }

  const configText = readFileSync(join(target.logRoot, CONFIG_FILE), 'utf8');
  return {
    from,
    to,
    config: {
      logRoot: target.logRoot,
      path: CONFIG_FILE,
      revision: revisionOfText(configText),
      text: setWorkspaceName(configText, to, join(target.logRoot, CONFIG_FILE)),
    },
    edits,
    notes,
  };
}

/** Runs `fn` while holding the locks of each log's edited ADRs, one log after another, in the order given. */
function withLogs<T>(groups: ReadonlyArray<[string, RenameEdit[]]>, env: NodeJS.ProcessEnv, fn: () => T): T {
  const [head, ...rest] = groups;
  if (!head) return fn();
  return withAdrLocks(
    head[0],
    head[1].map((edit) => edit.id),
    () => withLogs(rest, env, fn),
    lockOptions(env),
  );
}

/**
 * Applies a plan. Every log's ADRs are locked and checked against the revisions planned, and the config against its own,
 * before the first write, so a change made since the plan refuses the whole rename with nothing written. ADRs are written
 * first and the config last.
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
  const configFile = join(plan.config.logRoot, plan.config.path);

  withLogs(groups, env, () => {
    if (revisionOfText(readFileSync(configFile, 'utf8')) !== plan.config.revision) throw conflict(plan.config.path);
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
    for (const write of writes) writeAdr(write.logRoot, write.adr);
    writeFileSync(configFile, plan.config.text);
  });
}
