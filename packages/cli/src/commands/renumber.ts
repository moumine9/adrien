import { renumber } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, open, printJson } from '../cli.ts';

export function registerRenumber(program: Command, cli: Cli): void {
  program
    .command('renumber')
    .description('Give an ADR with a colliding id the next free one')
    .argument('<id>', 'the colliding id')
    .option('--file <path>', 'which file to renumber when several share the id')
    .action(async (id: string, opts: { file?: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { ctx, view } = await open(cli, globals);
      const result = renumber(ctx, view, id, { path: opts.file });
      if (globals.json) return printJson(cli, result);
      cli.out(`Renumbered ${result.from} -> ${result.to} (${result.path})\n`);
    });
}
