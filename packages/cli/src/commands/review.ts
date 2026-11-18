import { relative, resolve } from 'node:path';
import {
  AdrienError,
  adrsForFiles,
  buildReview,
  changedFiles,
  gitToplevel,
  resolveBaseRef,
  toPosix,
  unverifiedBaseNote,
} from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, open, printJson } from '../cli.ts';

interface ReviewOptions {
  base?: string;
  head: string;
  files?: string[];
}

/** The files a range changes, as paths relative to `cwd` (as `adrien for` takes them). */
async function changedPaths(cwd: string, opts: ReviewOptions): Promise<string[]> {
  const top = await gitToplevel(cwd);
  if (!top) throw new AdrienError('INVALID_INPUT', 'Not inside a git repository: pass --files <paths...> instead.');
  const base = opts.base ?? (await resolveBaseRef(top));
  if (!base) throw new AdrienError('INVALID_INPUT', 'No default branch found to compare with: pass --base <ref>.');
  const changed = await changedFiles(top, base, opts.head);
  if (!changed) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Could not list the changed files between ${base} and ${opts.head}: check that both refs exist.`,
    );
  }
  return changed.map((path) => toPosix(relative(cwd, resolve(top, path))));
}

export function registerReview(program: Command, cli: Cli): void {
  program
    .command('review')
    .description('Markdown for a merge request: the decisions that govern its changed files (informs, never blocks)')
    .option('--base <ref>', 'compare from this ref (default: the default branch)')
    .option('--head <ref>', 'compare to this ref', 'HEAD')
    .option('--files <paths...>', 'review these files instead of a git diff, relative to the current directory')
    .action(async (opts: ReviewOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const { ctx, view } = await open(cli, globals);
      const paths = opts.files ?? (await changedPaths(ctx.cwd, opts));
      const decisions = adrsForFiles(ctx, view, paths);
      const note = unverifiedBaseNote(view);
      const review = buildReview(decisions, { note });
      if (note) cli.err(`note: ${note}\n`);
      if (globals.json) {
        return printJson(cli, {
          binding: review.binding,
          hints: review.hints,
          files: review.files,
          markdown: review.markdown,
          decisions,
        });
      }
      cli.out(review.markdown);
    });
}
