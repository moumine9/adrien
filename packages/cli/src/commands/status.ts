import { AdrienError, STATUSES, setStatus } from '@adrien/core';
import type { Command } from 'commander';
import type { Cli, GlobalOptions } from '../cli.ts';
import { open, printJson } from '../cli.ts';
import { accept } from './accept.ts';

const SETTABLE = ['proposed', 'rejected', 'deprecated'] as const;
type Settable = (typeof SETTABLE)[number];

export function registerStatus(program: Command, cli: Cli): void {
  program
    .command('status')
    .description('Set an ADR status (accepted and superseded have their own commands)')
    .argument('<id>', 'ADR id')
    .argument('<status>', STATUSES.join(' | '))
    .option('--expect <revision>', 'refuse if the ADR changed since this revision (from `show --json`)')
    .action(async (id: string, status: string, opts: { expect?: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      if (status === 'accepted') return accept(cli, globals, id, opts.expect);
      if (status === 'superseded') throw new AdrienError('INVALID_INPUT', 'Use `adrien supersede <old> --by <new>`.');
      if (!SETTABLE.includes(status as Settable)) {
        throw new AdrienError('INVALID_INPUT', `Unknown status "${status}". Use one of: ${STATUSES.join(', ')}`);
      }
      const { ctx, view } = await open(cli, globals);
      const adr = setStatus(ctx, view, id, status as Settable, { expectedRevision: opts.expect });
      if (globals.json) return printJson(cli, adr);
      cli.out(`${id} ${status}\n`);
    });
}
