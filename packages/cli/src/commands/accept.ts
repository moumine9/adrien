import { acceptAdr } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, open, printJson, today } from '../cli.ts';

export async function accept(cli: Cli, globals: GlobalOptions, id: string, expectedRevision?: string): Promise<void> {
  const { ctx, view } = await open(cli, globals);
  const adr = acceptAdr(ctx, view, id, { today: today(), expectedRevision });
  if (globals.json) return printJson(cli, adr);
  cli.out(`${id} accepted. Commit and open/merge the MR: merging is the approval.\n`);
}

export function registerAccept(program: Command, cli: Cli): void {
  program
    .command('accept')
    .description('Mark an ADR accepted (the merge of its MR is the approval)')
    .argument('<id>', 'ADR id')
    .option('--expect <revision>', 'refuse if the ADR changed since this revision (from `show --json`)')
    .action((id: string, opts: { expect?: string }, cmd: Command) =>
      accept(cli, cmd.optsWithGlobals<GlobalOptions>(), id, opts.expect),
    );
}
