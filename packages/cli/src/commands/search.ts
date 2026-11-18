import type { Command } from 'commander';
import { type Cli, type GlobalOptions, open, printJson, withIndex } from '../cli.ts';
import { formatRow } from '../output.ts';

export function registerSearch(program: Command, cli: Cli): void {
  program
    .command('search')
    .description('Full-text search over titles, review rules and bodies')
    .argument('<query...>', 'words to look for')
    .action(async (query: string[], _opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { ctx, view } = await open(cli, globals);
      const rows = await withIndex(ctx, view, (index) => index.search(query.join(' ')));
      if (globals.json) return printJson(cli, rows);
      for (const row of rows) cli.out(formatRow(row));
    });
}
