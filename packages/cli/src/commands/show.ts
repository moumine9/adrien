import { type Adr, AdrienError, serializeAdr, workingRevision } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, open, printJson } from '../cli.ts';

// The top-level `revision` is the one to pass as --expect; a nested one would be the revision of another version.
const bare = ({ revision: _revision, ...adr }: Adr) => adr;

export function registerShow(program: Command, cli: Cli): void {
  program
    .command('show')
    .description('Print an ADR, with its pending change if any')
    .argument('<id>', 'ADR id')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { view } = await open(cli, globals);
      const base = view.base.find((a) => a.meta.id === id) ?? null;
      const change = view.pending.find((c) => c.id === id) ?? null;
      if (!base && !change) throw new AdrienError('ADR_NOT_FOUND', `No ADR ${id} in the log`);
      if (globals.json) {
        // `revision` is what a later change passes as --expect, so it is refused if the ADR changed in between.
        return printJson(cli, {
          id,
          revision: workingRevision(view, id),
          base: base && bare(base),
          pending: change && { kind: change.kind, current: change.current ? bare(change.current) : null },
        });
      }
      if (base) cli.out(serializeAdr(base));
      if (change) {
        cli.out(`\n--- PENDING (${change.kind}) — not binding until merged ---\n`);
        cli.out(change.current ? serializeAdr(change.current) : '(deleted)\n');
      }
    });
}
