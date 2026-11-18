import { exitCodeFor, lintAdrs, loadLogView } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, contextOf, type GlobalOptions, printJson } from '../cli.ts';
import { formatDiagnostic } from '../output.ts';

export function registerLint(program: Command, cli: Cli): void {
  program
    .command('lint')
    .description('Style warnings for the ADRs: markdownlint plus Adrien rules (placeholders, empty decisions)')
    .option('--strict', 'exit 1 on warnings')
    .action(async (opts: { strict?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const ctx = await contextOf(cli, globals);
      const diags = await lintAdrs(ctx, await loadLogView(ctx.logRoot, ctx.config));
      cli.setCode(exitCodeFor(diags, opts.strict));
      if (globals.json) return printJson(cli, { errors: 0, warnings: diags.length, diagnostics: diags });
      for (const d of diags) cli.out(formatDiagnostic(d));
      cli.out(`0 errors, ${diags.length} warnings\n`);
    });
}
