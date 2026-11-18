import type { Status } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, collect, type GlobalOptions, open, printJson, withIndex } from '../cli.ts';
import { formatRow } from '../output.ts';

interface ListOptions {
  tag: string[];
  component: string[];
  status: Status[];
  pending?: boolean;
}

export function registerList(program: Command, cli: Cli): void {
  program
    .command('list')
    .description('List ADRs (base and pending)')
    .option('--tag <tag>', 'only ADRs with this tag (repeatable: all must match)', collect, [])
    .option('--component <id>', 'only ADRs for this component (repeatable: any matches)', collect, [])
    .option('--status <status>', 'only this status (repeatable)', collect, [])
    .option('--pending', 'only pending (unmerged) changes')
    .action(async (opts: ListOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { ctx, view } = await open(cli, globals);
      const rows = await withIndex(ctx, view, (index) =>
        index.list({
          tags: opts.tag,
          components: opts.component,
          status: opts.status,
          layer: opts.pending ? 'pending' : 'all',
        }),
      );
      if (globals.json) return printJson(cli, rows);
      for (const row of rows) cli.out(formatRow(row));
    });
}
