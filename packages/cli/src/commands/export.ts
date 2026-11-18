import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { AdrienError, EXPORT_FORMATS, type ExportFormat, exportLog } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, open } from '../cli.ts';

export function registerExport(program: Command, cli: Cli): void {
  program
    .command('export')
    .description('Print or write an overview of the ADRs: a markdown table, or an llms.txt')
    .option('--format <format>', `${EXPORT_FORMATS.join(' | ')}`, 'markdown')
    .option('--out <file>', 'write to this file instead of printing (links are relative to it)')
    .action(async (opts: { format: string; out?: string }, cmd: Command) => {
      const format = opts.format as ExportFormat;
      if (!EXPORT_FORMATS.includes(format)) {
        throw new AdrienError(
          'INVALID_INPUT',
          `Unknown format "${opts.format}". Use one of: ${EXPORT_FORMATS.join(', ')}`,
        );
      }
      const { ctx, view } = await open(cli, cmd.optsWithGlobals<GlobalOptions>());
      if (!opts.out) return cli.out(exportLog(ctx, view, format));
      const file = resolve(cli.cwd, opts.out);
      const text = exportLog(ctx, view, format, { from: dirname(file) });
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text);
      cli.out(`Wrote ${opts.out}\n`);
    });
}
