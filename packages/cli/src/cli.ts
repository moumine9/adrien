import { AdrIndex, type Context, type LogView, loadLogView, resolveContext } from '@adrien/core';
import type { UpdateDeps } from './commands/update.ts';

/** What every command gets: where it runs, and where its output goes. */
export interface Cli {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out(text: string): void;
  err(text: string): void;
  setCode(code: number): void;
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

export function contextOf(cli: Cli, opts: GlobalOptions): Promise<Context> {
  return resolveContext({ cwd: cli.cwd, log: opts.log, env: cli.env });
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
