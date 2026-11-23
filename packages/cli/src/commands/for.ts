import { forFilesWithCommon } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, open, printJson } from '../cli.ts';
import { formatFileDecisions } from '../output.ts';

export function registerFor(program: Command, cli: Cli): void {
  program
    .command('for')
    .description('Show the decisions that govern these files, and why')
    .argument('<paths...>', 'files, relative to the current directory')
    .action(async (paths: string[], _opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { ctx, view } = await open(cli, globals);
      const { files, notes } = await forFilesWithCommon(ctx, view, paths);
      for (const note of notes) cli.err(`note: ${note}\n`);
      if (globals.json) return printJson(cli, files);
      cli.out(formatFileDecisions(files));
    });
}
