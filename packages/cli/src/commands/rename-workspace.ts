import { join, resolve } from 'node:path';
import {
  applyWorkspaceRename,
  CONFIG_FILE,
  type Context,
  planReferenceCatchUp,
  planWorkspaceRename,
  resolveContext,
  resolveWorkspaces,
  type WorkspaceRenamePlan,
  type WorkspaceSpec,
} from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, contextOf, type GlobalOptions, logSpecs, printJson } from '../cli.ts';

interface RenameOptions {
  dryRun?: boolean;
  also: string[];
  from?: string;
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

export function registerRenameWorkspace(program: Command, cli: Cli): void {
  program
    .command('rename-workspace')
    .description(
      'Rename this log: its workspace field, its ADR folder when that folder is named after the old name, and the related and exception_to references that name the old name in the logs whose common field points to it. With --from, catch up this log only: rewrite its references to the old name',
    )
    .argument('<new-name>', 'the new workspace name')
    .option('--dry-run', 'show what would change, and write nothing')
    .option('--also <log-dir>', 'another log to check for references to the old name (repeatable)', collect, [])
    .option(
      '--from <old-name>',
      'catch up a log renamed elsewhere: rewrite its references to <old-name>, rename nothing',
    )
    .addHelpText(
      'after',
      '\nRun it from the log you rename, and try --dry-run first. When the ADR folder moves, stage both folders (git add -A) before you commit. Merge a common log and its products together. A log in another repository keeps the old name until it is caught up with --from.',
    )
    .action(async (to: string, opts: RenameOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      // Several logs in ADRIEN_LOG are read here, to find the logs that name this one as their common log. The target is
      // the only entry when there is one, else the log the current directory belongs to.
      const specs = logSpecs(globals.log);
      const target =
        specs.length === 1 ? await contextOf(cli, globals) : await resolveContext({ cwd: cli.cwd, env: cli.env });
      const also = await Promise.all(
        opts.also.map((dir) => resolveContext({ cwd: resolve(cli.cwd, dir), env: cli.env })),
      );
      const applied = !opts.dryRun;

      if (opts.from !== undefined) {
        const plan = await planReferenceCatchUp({ logs: [target, ...distinct(also, target)], from: opts.from, to });
        if (applied) applyWorkspaceRename(plan, cli.env);
        const references = referencesOf(plan);
        if (globals.json) {
          return printJson(cli, {
            from: plan.from,
            to,
            applied,
            file: null,
            references,
            notes: plan.notes,
            move: null,
          });
        }
        cli.out(
          references.length === 0
            ? `No references to ${plan.from} found.\n`
            : `${applied ? 'Updated' : 'Would update'} references to ${plan.from}: ${plan.from} -> ${to}\n`,
        );
        for (const ref of references) cli.out(`  ${ref.path}: ${ref.field} ${ref.from} -> ${ref.to}\n`);
        for (const note of plan.notes) cli.out(`Note: ${note}\n`);
        return;
      }

      const listed =
        specs.length > 1
          ? (await resolveWorkspaces({ cwd: cli.cwd, specs, env: cli.env })).all.map((workspace) => workspace.ctx)
          : [];
      const others = distinct([...listed, ...also], target);
      const plan = await planWorkspaceRename({ target, others, to });
      if (applied) applyWorkspaceRename(plan, cli.env);

      const notes = [
        ...plan.notes,
        `Logs not listed in ADRIEN_LOG or --also were not checked: references to ${plan.from} there keep the old name and show as unresolved-ref.`,
        `A log in another repository that names ${plan.from} keeps it until you run \`adrien rename-workspace ${to} --from ${plan.from}\` in it, once its common log is named ${to}.`,
        ...overridesOf(specs, plan.from, plan.to),
      ];
      const references = referencesOf(plan);
      const file = join(target.logRoot, CONFIG_FILE);
      const move = plan.move && { from: plan.move.from, to: plan.move.to };
      if (globals.json) return printJson(cli, { from: plan.from, to, applied, file, references, notes, move });

      cli.out(`${applied ? 'Renamed' : 'Would rename'} workspace ${plan.from} -> ${to}\n`);
      cli.out(`  ${file}: workspace is now ${to}\n`);
      if (move) {
        cli.out(`${applied ? 'Moved' : 'Would move'} the ADR folder: ${move.from} -> ${move.to}\n`);
        cli.out(`Update any CODEOWNERS entry for ${move.from}/ to ${move.to}/.\n`);
        cli.out(
          `Stage both folders before you commit, since \`git commit -a\` leaves the new one out: git add -A ${move.from} ${move.to}\n`,
        );
      }
      for (const ref of references) cli.out(`  ${ref.path}: ${ref.field} ${ref.from} -> ${ref.to}\n`);
      for (const note of notes) cli.out(`Note: ${note}\n`);
    });
}

/** The logs, each once by log root, without the log being renamed. */
function distinct(logs: readonly Context[], target: Context): Context[] {
  return logs.filter(
    (ctx, i) => ctx.logRoot !== target.logRoot && logs.findIndex((other) => other.logRoot === ctx.logRoot) === i,
  );
}

function referencesOf(plan: WorkspaceRenamePlan) {
  return plan.edits.flatMap((edit) =>
    edit.refs.map((ref) => ({ log: edit.logRoot, path: edit.path, id: edit.id, ...ref })),
  );
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
