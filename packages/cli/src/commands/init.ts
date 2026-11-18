import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CONFIG_FILE, DEFAULT_TAGS, type LogConfig, loadLogConfig, writeLogConfig } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, csv } from '../cli.ts';

interface InitOptions {
  product?: string;
  adrDir: string;
  tags?: string;
  components?: string;
  idFormat: string;
}

function setupHint(config: LogConfig): string {
  return [
    `Created ${CONFIG_FILE} (product: ${config.product}).`,
    'Next:',
    `  1. Add to CODEOWNERS:   ${config.adr_dir}/ @your-architects-group`,
    '  2. GitLab Premium+: Settings > Repository > Protected branches > require Code Owner approval on the default branch.',
    '  3. In each code repo: adrien init --code-repo --log <path|url> && adrien init --agents',
    '',
  ].join('\n');
}

function initLog(cli: Cli, opts: InitOptions): void {
  const config: LogConfig = {
    product: opts.product ?? basename(cli.cwd),
    adr_dir: opts.adrDir,
    id_format: opts.idFormat,
    tags: opts.tags ? csv(opts.tags) : DEFAULT_TAGS,
    components: Object.fromEntries(csv(opts.components).map((c) => [c, {}])),
  };
  writeLogConfig(cli.cwd, config);
  try {
    loadLogConfig(cli.cwd);
  } catch (e) {
    rmSync(join(cli.cwd, CONFIG_FILE));
    throw e;
  }
  const adrDir = join(cli.cwd, ...config.adr_dir.split('/'));
  mkdirSync(adrDir, { recursive: true });
  if (!existsSync(join(adrDir, '.gitkeep'))) writeFileSync(join(adrDir, '.gitkeep'), '');
  cli.out(setupHint(config));
}

export function registerInit(program: Command, cli: Cli): void {
  program
    .command('init')
    .description('Create adrien.config.yaml for an ADR log (run it in the log repo)')
    .option('--product <name>', 'product name (default: the directory name)')
    .option('--adr-dir <dir>', 'where ADR files live', 'docs/adr')
    .option('--tags <list>', 'allowed tags, comma-separated (default: frontend,backend,database,infra,security)')
    .option('--components <list>', 'components, comma-separated (add their repo URLs to the config later)')
    .option('--id-format <format>', 'id format', 'ADR-{n:4}')
    .action((opts: InitOptions) => initLog(cli, opts));
}
