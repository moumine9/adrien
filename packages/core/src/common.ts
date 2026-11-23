import { resolve } from 'node:path';
import { workspaceNameOf } from './config.ts';
import { adrienHome, type Context, ensureCachedClone, resolveContext } from './context.ts';
import { AdrienError } from './errors.ts';
import { adrsForFiles, type FileDecisions, unverifiedBaseNote } from './for-files.ts';
import { isGitUrl } from './repo-url.ts';
import { type LogView, loadLogView } from './view.ts';

/** The common log a product names in its `common` field: the decisions it holds bind the product. */
export interface CommonLog {
  name: string;
  ctx: Context;
  view: LogView;
}

/** An unreadable common log: where it is named, and why it could not be read. */
export interface UnreadableCommon {
  /** `unreachable`: it could not be reached (a missing path, a failed clone). `invalid`: it was read but cannot serve as a common log. */
  kind: 'unreachable' | 'invalid';
  location: string;
  message: string;
}

/** The common log of a product, or why it cannot be read. Null when the product names none. */
export type CommonResolution = { common: CommonLog } | { unreadable: UnreadableCommon };

/**
 * Reads the common log of `ctx` without throwing, so a product's own decisions can still be shown when it is
 * unreachable. A relative path resolves against the product log root, as a `--log` entry does. The common log's own
 * `common` field is ignored: a common log does not chain to another.
 */
export async function readCommon(ctx: Context, env?: NodeJS.ProcessEnv): Promise<CommonResolution | null> {
  const source = ctx.config.common;
  if (source === undefined) return null;
  const log = isGitUrl(source) ? source : resolve(ctx.logRoot, source);
  try {
    const commonCtx = await resolveContext({ cwd: ctx.cwd, log, env: env ?? ctx.env });
    if (commonCtx.logRoot === ctx.logRoot) {
      return {
        unreadable: {
          kind: 'invalid',
          location: source,
          message: 'it is the product log itself, which cannot be its own common log',
        },
      };
    }
    const name = workspaceNameOf(commonCtx.config);
    if (name === null) {
      return {
        unreadable: {
          kind: 'invalid',
          location: source,
          message:
            'it has no usable workspace name: set `workspace:` in its adrien.config.yaml, because references to its decisions must match its own name',
        },
      };
    }
    return { common: { name, ctx: commonCtx, view: await loadLogView(commonCtx.logRoot, commonCtx.config) } };
  } catch (e) {
    return { unreadable: { kind: 'unreachable', location: source, message: (e as Error).message } };
  }
}

/**
 * Where the cached clone of the common log is, when the product names it by a git URL; null for a path or no common
 * log. A long-running server refreshes it, because a cached clone is reused without a fetch.
 */
export async function commonCloneDir(ctx: Context, env?: NodeJS.ProcessEnv): Promise<string | null> {
  const source = ctx.config.common;
  if (source === undefined || !isGitUrl(source)) return null;
  return ensureCachedClone(source, adrienHome(env ?? ctx.env));
}

/**
 * The common log of `ctx` (strict), or null when `ctx` names none. Throws an AdrienError naming the `common` field
 * when the common log cannot be read.
 */
export async function resolveCommon(ctx: Context, env?: NodeJS.ProcessEnv): Promise<CommonLog | null> {
  const result = await readCommon(ctx, env);
  if (result && 'unreadable' in result) {
    const { location, message } = result.unreadable;
    throw new AdrienError(
      'CONFIG_NOT_FOUND',
      `The common log named by the \`common\` field of ${ctx.logSource} (${location}) cannot be read: ${message}`,
    );
  }
  return result ? result.common : null;
}

/**
 * A note for callers that show decisions: the common log could not be read, so its decisions are not shown. Null when
 * there is no common log or it was read.
 */
export function commonUnreadableNote(result: CommonResolution | null): string | null {
  if (!result || !('unreadable' in result)) return null;
  return `The common log at ${result.unreadable.location} could not be read, so its decisions are not shown: ${result.unreadable.message}`;
}

export interface FilesWithCommon {
  files: FileDecisions[];
  /** The product log's verification warning: its default branch is missing. */
  notes: string[];
  /** About the common log: its default branch is missing, or it could not be read. */
  commonNotes: string[];
}

/**
 * The decisions that govern `paths`, the product's own and its common log's, with the notes a caller shows. An
 * unreadable common log leaves the product's own decisions in place and adds a note.
 */
export async function forFilesWithCommon(ctx: Context, view: LogView, paths: string[]): Promise<FilesWithCommon> {
  const read = await readCommon(ctx);
  const common = read && 'common' in read ? read.common : null;
  const commonNotes: string[] = [];
  if (common) {
    const commonBase = unverifiedBaseNote(common.view);
    if (commonBase) commonNotes.push(`In the common log "${common.name}": ${commonBase}`);
  }
  const unreadable = commonUnreadableNote(read);
  if (unreadable) commonNotes.push(unreadable);
  const ownBase = unverifiedBaseNote(view);
  return {
    files: adrsForFiles(ctx, view, paths, common),
    notes: ownBase ? [ownBase] : [],
    commonNotes,
  };
}
