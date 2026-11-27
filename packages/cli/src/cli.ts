import {
  AdrIndex,
  AdrienError,
  type Context,
  type LogView,
  loadLogView,
  resolveContext,
  type WorkspaceSpec,
  workspaceSpecsFromEnv,
} from '@adrien/core';
import type { UpdateDeps } from './commands/update.ts';

/** What every command gets: where it runs, and where its output goes. */
export interface Cli {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out(text: string): void;
  err(text: string): void;
  setCode(code: number): void;
  /** Asks the person a question and resolves with the answer. Set only in a terminal, so a command asks nothing elsewhere. */
  ask?: (question: string) => Promise<string>;
  update?: Partial<UpdateDeps>;
}

export interface GlobalOptions {
  log?: string;
  json?: boolean;
}

export const csv = (value: string | undefined): string[] =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

export const collect = (value: string, previous: string[]): string[] => [...previous, value];

export const today = (): string => new Date().toISOString().slice(0, 10);

/** The logs the global `--log` (or ADRIEN_LOG) names: `;` separates them, and `name=` names one. Only serve takes several. */
export function logSpecs(log: string | undefined): WorkspaceSpec[] {
  return workspaceSpecsFromEnv(log);
}

/** The one log a command works on, or undefined. Several logs are refused: only `adrien serve` serves more than one. */
export function singleLog(log: string | undefined): string | undefined {
  const specs = logSpecs(log);
  if (specs.length === 0) return undefined;
  if (specs.length > 1) {
    throw new AdrienError(
      'INVALID_INPUT',
      'Several logs were given: only `adrien serve` serves more than one. Pass a single --log.',
    );
  }
  return specs[0]?.log;
}

export function contextOf(cli: Cli, opts: GlobalOptions): Promise<Context> {
  return resolveContext({ cwd: cli.cwd, log: singleLog(opts.log), env: cli.env });
}

export async function open(cli: Cli, opts: GlobalOptions): Promise<{ ctx: Context; view: LogView }> {
  const ctx = await contextOf(cli, opts);
  return { ctx, view: await loadLogView(ctx.logRoot, ctx.config) };
}

export async function withIndex<T>(ctx: Context, view: LogView, use: (index: AdrIndex) => T): Promise<T> {
  const index = await AdrIndex.open(ctx.logRoot);
  try {
    index.sync(view);
    return use(index);
  } finally {
    index.close();
  }
}

export function printJson(cli: Cli, data: unknown): void {
  cli.out(`${JSON.stringify(data, null, 2)}\n`);
}
