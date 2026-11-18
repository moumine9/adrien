import { exitCodeFor, fetchOrigin, gitToplevel, loadLogView, runCheck } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, contextOf, type GlobalOptions, printJson } from '../cli.ts';
import { formatDiagnostic } from '../output.ts';

interface CheckOptions {
  here?: boolean;
  mr?: boolean;
  strict?: boolean;
  lint?: boolean;
}

export function registerCheck(program: Command, cli: Cli): void {
  program
    .command('check')
    .description('Validate the ADR log (CI-ready exit code)')
    .option('--here', 'verify anchors against the code repo this runs in (use in code-repo CI)')
    .option('--mr', 'merge-request mode: fetch the default branch, warn about ADRs left "proposed"')
    .option('--lint', 'also report style warnings (see `adrien lint`)')
    .option('--strict', 'fail on warnings too')
    .action(async (opts: CheckOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const ctx = await contextOf(cli, globals);
      if (opts.mr) {
        const top = await gitToplevel(ctx.logRoot);
        if (top) await fetchOrigin(top);
      }
      const view = await loadLogView(ctx.logRoot, ctx.config);
      const diags = await runCheck(ctx, view, { here: opts.here, mr: opts.mr, lint: opts.lint });
      const errors = diags.filter((d) => d.severity === 'error').length;
      const warnings = diags.filter((d) => d.severity === 'warning').length;
      cli.setCode(exitCodeFor(diags, opts.strict));
      if (globals.json) return printJson(cli, { errors, warnings, diagnostics: diags });
      for (const d of diags) cli.out(formatDiagnostic(d));
      cli.out(`${errors} errors, ${warnings} warnings\n`);
    });
}
