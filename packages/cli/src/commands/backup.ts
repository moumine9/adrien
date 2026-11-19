import {
  assertWritable,
  type BackupVerification,
  createBackup,
  listBackups,
  restoreBackup,
  verifyBackup,
} from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, contextOf, type GlobalOptions, printJson } from '../cli.ts';
import { VERSION } from '../version.ts';

export const differs = (v: BackupVerification): boolean => v.changed.length + v.missing.length + v.added.length > 0;

/** Names the entries that were not copied because they are links or other non-files. */
export function skippedLine(skipped: string[]): string {
  const n = skipped.length;
  return `Skipped ${n} ${n === 1 ? 'entry' : 'entries'} that ${n === 1 ? 'is' : 'are'} not a regular file: ${skipped.join(', ')}\n`;
}

/** One line per kind of difference that has any files: `changed: a, b`. */
export function changeLines(v: BackupVerification): string {
  return (['changed', 'missing', 'added'] as const)
    .filter((kind) => v[kind].length > 0)
    .map((kind) => `  ${kind}: ${v[kind].join(', ')}\n`)
    .join('');
}

export function registerBackup(program: Command, cli: Cli): void {
  const backup = program
    .command('backup')
    .description('Back up the decision files, check them against a backup, or restore one');

  backup
    .command('create')
    .description('Copy the decision files now into .adrien/backups')
    .option('--reason <text>', 'why the backup is made (kept in its folder name)', 'manual')
    .action(async (opts: { reason: string }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const ctx = await contextOf(cli, globals);
      assertWritable(ctx);
      const made = createBackup(ctx.logRoot, ctx.config, opts.reason, VERSION, ctx.env);
      if (globals.json) return printJson(cli, made);
      cli.out(`Backed up ${made.fileCount} files to ${made.path}\n`);
      if (made.skipped.length > 0) cli.out(skippedLine(made.skipped));
    });

  backup
    .command('list')
    .description('List the backups, newest first')
    .action(async (_opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const ctx = await contextOf(cli, globals);
      const backups = listBackups(ctx.logRoot);
      if (globals.json) return printJson(cli, backups);
      if (backups.length === 0) return cli.out('No backups yet.\n');
      for (const b of backups) {
        cli.out(
          b.status === 'ok' ? `${b.id}  ${b.createdAt}  ${b.fileCount} files  ${b.reason}\n` : `${b.id}  damaged\n`,
        );
      }
    });

  backup
    .command('verify')
    .description('Compare the decision files with a backup (exit 1 when they differ)')
    .argument('<id>', 'the backup to compare with')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const ctx = await contextOf(cli, globals);
      const result = verifyBackup(ctx.logRoot, id);
      if (globals.json) printJson(cli, result);
      else
        cli.out(
          differs(result)
            ? `Decision files differ from backup ${id}:\n${changeLines(result)}`
            : 'Decision files unchanged.\n',
        );
      if (differs(result)) cli.setCode(1);
    });

  backup
    .command('restore')
    .description('Put the decision files back from a backup (the current files are backed up first)')
    .argument('<id>', 'the backup to restore')
    .action(async (id: string, _opts: unknown, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const ctx = await contextOf(cli, globals);
      assertWritable(ctx);
      const result = restoreBackup(ctx.logRoot, ctx.config, id, VERSION, ctx.env);
      if (globals.json) return printJson(cli, result);
      cli.out(
        `Restored ${result.restored.length} files from ${id}. The files before the restore are in ${result.preRestore}.\n`,
      );
      if (result.leftover.length > 0) {
        cli.out(`Not in the backup, left in place: ${result.leftover.join(', ')}\n`);
      }
    });
}
