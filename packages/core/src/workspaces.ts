import { isWorkspaceName, workspaceNameOf } from './config.ts';
import { type Context, resolveContext, splitEntries } from './context.ts';
import { AdrienError } from './errors.ts';

/** One log to serve: `name` overrides the log's own workspace name; no `log` means discover it from cwd. */
export interface WorkspaceSpec {
  name?: string;
  log?: string;
}

export interface Workspace {
  name: string;
  ctx: Context;
}

export interface Workspaces {
  readonly all: readonly Workspace[];
  names(): string[];
  get(name: string): Workspace;
  only(): Workspace;
}

/**
 * Parses `name=log` or `log` entries. An entry is named only when the text before its first `=` is a valid workspace
 * name (a name with nothing after it is an error); otherwise the whole entry is a log (so a URL's `?ref=` or a path with `=` survives).
 */
export function parseWorkspaceSpecs(entries: readonly string[]): WorkspaceSpec[] {
  const specs: WorkspaceSpec[] = [];
  for (const raw of entries) {
    const entry = raw.trim();
    if (entry === '') continue;
    const eq = entry.indexOf('=');
    const name = eq > 0 ? entry.slice(0, eq).trim() : '';
    const log = eq > 0 ? entry.slice(eq + 1).trim() : '';
    if (name !== '' && isWorkspaceName(name)) {
      if (log === '') throw new AdrienError('INVALID_INPUT', `Workspace "${name}" has no log after "=".`);
      specs.push({ name, log });
    } else specs.push({ log: entry });
  }
  return specs;
}

export function workspaceSpecsFromEnv(text: string | undefined): WorkspaceSpec[] {
  return parseWorkspaceSpecs(splitEntries(text));
}

/** Resolves every spec to a workspace. Names must be unique and each log may appear once. */
export async function resolveWorkspaces(opts: {
  cwd: string;
  specs: readonly WorkspaceSpec[];
  env?: NodeJS.ProcessEnv;
}): Promise<Workspaces> {
  const specs = opts.specs.length ? opts.specs : [{}];
  const all: Workspace[] = [];
  const byName = new Map<string, Workspace>();
  const logRoots = new Set<string>();
  for (const spec of specs) {
    if (spec.name !== undefined && !isWorkspaceName(spec.name)) {
      throw new AdrienError('INVALID_INPUT', `"${spec.name}" is not a valid workspace name.`);
    }
    const ctx = await resolveContext({ cwd: opts.cwd, log: spec.log, env: opts.env });
    const name = spec.name ?? workspaceNameOf(ctx.config);
    if (name === null) {
      throw new AdrienError(
        'INVALID_INPUT',
        `The log at ${ctx.logSource} has no usable workspace name: set \`workspace\` in its adrien.config.yaml or pass name=<path>.`,
      );
    }
    if (byName.has(name)) throw new AdrienError('CONFIG_INVALID', `Two workspaces are named "${name}".`);
    if (logRoots.has(ctx.logRoot))
      throw new AdrienError('CONFIG_INVALID', `The log at ${ctx.logSource} is listed twice.`);
    const workspace = { name, ctx };
    all.push(workspace);
    byName.set(name, workspace);
    logRoots.add(ctx.logRoot);
  }
  const names = () => all.map((w) => w.name);
  return {
    all,
    names,
    get(name: string): Workspace {
      const workspace = byName.get(name);
      if (!workspace)
        throw new AdrienError('CONFIG_NOT_FOUND', `No workspace "${name}". Known: ${names().join(', ')}.`);
      return workspace;
    },
    only(): Workspace {
      const only = all.length === 1 ? all[0] : undefined;
      if (only) return only;
      throw new AdrienError(
        'CONFIG_NOT_FOUND',
        `This instance has several workspaces: name one of ${names().join(', ')}.`,
      );
    },
  };
}
