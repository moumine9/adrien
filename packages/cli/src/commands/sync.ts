import { AdrienError, fetchOrigin, gitToplevel, loadLogView, syncCachedClone } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, contextOf, type GlobalOptions, printJson } from '../cli.ts';

export function registerSync(program: Command, cli: Cli): void {
  program
    .command('sync')
    .description('Fetch the latest default branch of the ADR log')
    .action(async (_opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const ctx = await contextOf(cli, globals);
      if (ctx.readOnly) await syncCachedClone(ctx.logRoot);
      else {
        const top = await gitToplevel(ctx.logRoot);
        if (top && !(await fetchOrigin(top))) {
          throw new AdrienError('CONFIG_INVALID', 'Could not fetch the ADR log from its origin.');
        }
      }
      const { baseRef } = await loadLogView(ctx.logRoot, ctx.config);
      if (globals.json) return printJson(cli, { log: ctx.logSource, baseRef });
      cli.out(`Log ${ctx.logSource} at ${baseRef ?? 'the working tree'}\n`);
    });
}
