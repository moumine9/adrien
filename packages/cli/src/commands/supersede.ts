import { supersede } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, open, printJson } from '../cli.ts';

export function registerSupersede(program: Command, cli: Cli): void {
  program
    .command('supersede')
    .description('Mark an ADR superseded by another and link both')
    .argument('<old>', 'the ADR being replaced')
    .requiredOption('--by <id>', 'the ADR that replaces it')
    .action(async (oldId: string, opts: { by: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { ctx, view } = await open(cli, globals);
      const result = supersede(ctx, view, oldId, opts.by);
      if (globals.json) return printJson(cli, result);
      cli.out(`${oldId} superseded by ${opts.by}.\n`);
    });
}
