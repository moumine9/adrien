import { join } from 'node:path';
import {
  applyWorkspaceRename,
  planWorkspaceRename,
  resolveContext,
  resolveWorkspaces,
  type WorkspaceSpec,
} from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, contextOf, type GlobalOptions, logSpecs, printJson } from '../cli.ts';

interface RenameOptions {
  dryRun?: boolean;
}

export function registerRenameWorkspace(program: Command, cli: Cli): void {
  program
    .command('rename-workspace')
    .description(
      'Rename this log: its workspace field, and the related and exception_to references that name the old name in the logs whose common field points to it',
    )
    .argument('<new-name>', 'the new workspace name')
    .option('--dry-run', 'show what would change, and write nothing')
    .addHelpText(
      'after',
      '\nRun it from the log you rename, and try --dry-run first. Merge a common log and its products together.',
    )
    .action(async (to: string, opts: RenameOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      // Several logs in ADRIEN_LOG are read here, to find the logs that name this one as their common log. The target is
      // the only entry when there is one, else the log the current directory belongs to.
      const specs = logSpecs(globals.log);
      const target =
        specs.length === 1 ? await contextOf(cli, globals) : await resolveContext({ cwd: cli.cwd, env: cli.env });
      const others =
        specs.length > 1
          ? (await resolveWorkspaces({ cwd: cli.cwd, specs, env: cli.env })).all
              .map((workspace) => workspace.ctx)
              .filter((ctx) => ctx.logRoot !== target.logRoot)
          : [];
      const plan = await planWorkspaceRename({ target, others, to });
      const applied = !opts.dryRun;
      if (applied) applyWorkspaceRename(plan, cli.env);

      const notes = [
        ...plan.notes,
        `Logs not listed in ADRIEN_LOG were not checked: references to ${plan.from} there keep the old name and show as unresolved-ref.`,
        ...overridesOf(specs, plan.from, plan.to),
      ];
      const references = plan.edits.flatMap((edit) =>
        edit.refs.map((ref) => ({ log: edit.logRoot, path: edit.path, id: edit.id, ...ref })),
      );
      const file = join(plan.config.logRoot, plan.config.path);
      if (globals.json) return printJson(cli, { from: plan.from, to, applied, file, references, notes });

      cli.out(`${applied ? 'Renamed' : 'Would rename'} workspace ${plan.from} -> ${to}\n`);
      cli.out(`  ${file}: workspace is now ${to}\n`);
      for (const ref of references) cli.out(`  ${ref.path}: ${ref.field} ${ref.from} -> ${ref.to}\n`);
      for (const note of notes) cli.out(`Note: ${note}\n`);
    });
}

/** The entries of ADRIEN_LOG that still use the old name: their address keeps it until they are changed. */
function overridesOf(specs: readonly WorkspaceSpec[], from: string, to: string): string[] {
  return specs
    .filter((spec) => spec.name === from)
    .map(
      (spec) =>
        `ADRIEN_LOG still names ${spec.log} "${from}": this instance's address keeps the old name until that entry is "${to}=".`,
    );
}
