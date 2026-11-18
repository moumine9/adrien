import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  AdrienError,
  CODE_CONFIG_FILE,
  CONFIG_FILE,
  DEFAULT_TAGS,
  isGitUrl,
  type LogConfig,
  loadLogConfig,
  writeCodeRepoConfig,
  writeLogConfig,
} from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, csv } from '../cli.ts';

export const AGENTS_SNIPPET = `<!-- adrien:start -->
## Architecture decisions (Adrien)
Before changing code, call the \`adr_for_files\` MCP tool with the files you will touch, and follow the \`review_rule\` of every binding ADR. If your change contradicts an accepted ADR, stop and tell the user instead of working around it. Record a new durable decision with \`adr_propose\`. Never set an ADR's status to \`accepted\` yourself.
<!-- adrien:end -->`;

const AGENTS_BLOCK = /<!-- adrien:start -->[\s\S]*?<!-- adrien:end -->/;

interface InitOptions {
  codeRepo?: boolean;
  agents?: boolean;
  log?: string;
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

function initCodeRepo(cli: Cli, opts: InitOptions): void {
  if (!opts.log) throw new AdrienError('INVALID_INPUT', '--code-repo needs --log <path|url>.');
  // A path must already hold a log: fail now instead of leaving a .adrien.yaml that points nowhere.
  if (!isGitUrl(opts.log)) loadLogConfig(resolve(cli.cwd, opts.log));
  const components = csv(opts.components);
  writeCodeRepoConfig(cli.cwd, { log: opts.log, ...(components.length ? { components } : {}) });
  cli.out(`Created ${CODE_CONFIG_FILE} (log: ${opts.log}).\nNext: adrien init --agents\n`);
}

function initAgents(cli: Cli): void {
  const file = join(cli.cwd, 'AGENTS.md');
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  let next: string;
  if (current === null) next = `${AGENTS_SNIPPET}\n`;
  else if (AGENTS_BLOCK.test(current)) next = current.replace(AGENTS_BLOCK, () => AGENTS_SNIPPET);
  else
    next = `${current}${current === '' || current.endsWith('\n\n') ? '' : current.endsWith('\n') ? '\n' : '\n\n'}${AGENTS_SNIPPET}\n`;
  writeFileSync(file, next);
  cli.out(`${current === null ? 'Created' : 'Updated'} AGENTS.md with the Adrien block.\n`);
  const claude = join(cli.cwd, 'CLAUDE.md');
  if (existsSync(claude) && !readFileSync(claude, 'utf8').includes('AGENTS.md')) {
    cli.out('Tip: add "@AGENTS.md" to CLAUDE.md so Claude Code reads it.\n');
  }
}

export function registerInit(program: Command, cli: Cli): void {
  program
    .command('init')
    .description('Create adrien.config.yaml for an ADR log (run it in the log repo), or set up a code repo')
    .option('--code-repo', 'in a code repo: write .adrien.yaml pointing at the log (needs --log)')
    .option('--agents', 'add the Adrien block to AGENTS.md')
    .option('--product <name>', 'product name (default: the directory name)')
    .option('--adr-dir <dir>', 'where ADR files live', 'docs/adr')
    .option('--tags <list>', 'allowed tags, comma-separated (default: frontend,backend,database,infra,security)')
    .option(
      '--components <list>',
      'components, comma-separated (log: add their repo URLs to the config later; --code-repo: override detection)',
    )
    .option('--id-format <format>', 'id format', 'ADR-{n:4}')
    .action((opts: InitOptions, cmd: Command) => {
      const { log } = cmd.optsWithGlobals<{ log?: string }>();
      if (opts.codeRepo) initCodeRepo(cli, { ...opts, log });
      if (opts.agents) initAgents(cli);
      if (!opts.codeRepo && !opts.agents) initLog(cli, opts);
    });
}
