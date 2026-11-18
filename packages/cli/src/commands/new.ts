import { AdrienError, createAdr, TEMPLATE_NAMES, type TemplateName } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, collect, csv, type GlobalOptions, open, printJson, today } from '../cli.ts';

interface NewOptions {
  tags?: string;
  components?: string;
  code: string[];
  reviewRule?: string;
  subdir?: string;
  template?: string;
  force?: boolean;
}

export function registerNew(program: Command, cli: Cli): void {
  program
    .command('new')
    .description('Create a proposed ADR')
    .argument('<title>', 'decision title')
    .option('--tags <list>', 'tags, comma-separated')
    .option('--components <list>', 'components, comma-separated')
    .option('--code <component:glob>', 'code it governs (repeatable)', collect, [])
    .option('--review-rule <text>', 'one checkable sentence for reviewers and agents')
    .option('--subdir <path>', 'folder inside the ADR dir')
    .option('--template <name>', `body skeleton: ${TEMPLATE_NAMES.join(', ')} (default: the config's template)`)
    .option('--force', 'create even if a similar title exists')
    .action(async (title: string, opts: NewOptions, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      if (opts.template && !(TEMPLATE_NAMES as readonly string[]).includes(opts.template)) {
        throw new AdrienError(
          'INVALID_INPUT',
          `Unknown template "${opts.template}". Use one of: ${TEMPLATE_NAMES.join(', ')}`,
        );
      }
      const { ctx, view } = await open(cli, globals);
      const result = createAdr(
        ctx,
        view,
        {
          title,
          tags: csv(opts.tags),
          components: csv(opts.components),
          code: opts.code,
          review_rule: opts.reviewRule,
          subdir: opts.subdir,
          template: opts.template as TemplateName | undefined,
        },
        { today: today(), force: opts.force },
      );
      if (!result.written) cli.setCode(1);
      if (globals.json) return printJson(cli, result);
      if (result.written) {
        cli.out(`Created ${result.adr.meta.id} ${result.adr.path} (proposed)\n`);
        return;
      }
      cli.out('Possible duplicates:\n');
      for (const hit of result.duplicates) cli.out(`  ${hit.id}  ${hit.score}  ${hit.title}\n`);
      cli.out('Use --force to create anyway.\n');
    });
}
