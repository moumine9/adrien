import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join, posix, resolve, win32 } from 'node:path';
import {
  AdrienError,
  adrDirProblem,
  CODE_CONFIG_FILE,
  CONFIG_FILE,
  DEFAULT_TAGS,
  isGitUrl,
  isWorkspaceName,
  type LogConfig,
  loadLogConfig,
  readWorkingLog,
  workspaceNameOf,
  writeCodeRepoConfig,
  writeLogConfig,
} from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, csv, singleLog } from '../cli.ts';

/** The parent folder of the ADR folder when the person gives none. */
const DEFAULT_ADR_PARENT = 'adrien-docs';
/** The ADR folder of logs created before the parent was asked for; kept when it already holds ADRs. */
const LEGACY_ADR_DIR = 'docs/adr';

export const AGENTS_SNIPPET = `<!-- adrien:start -->
## Architecture decisions (Adrien)
Before changing code, call the \`adr_for_files\` MCP tool with the files you will touch, and follow the \`review_rule\` of every binding ADR, in the code you write or change (do not rewrite other code only to make it comply). If your change contradicts an accepted ADR, stop and tell the user instead of working around it. Record a new durable decision with \`adr_propose\`. Never set an ADR's status to \`accepted\` yourself.
<!-- adrien:end -->`;

const AGENTS_BLOCK = /<!-- adrien:start -->[\s\S]*?<!-- adrien:end -->/;

interface InitOptions {
  codeRepo?: boolean;
  agents?: boolean;
  log?: string;
  product?: string;
  workspace?: string;
  adrDir?: string;
  adrParent?: string;
  tags?: string;
  components?: string;
  idFormat: string;
}

function setupHint(config: LogConfig): string {
  return [
    `Created ${CONFIG_FILE} (product: ${config.product}, workspace: ${config.workspace}).`,
    'Next:',
    `  1. Add to CODEOWNERS:   ${config.adr_dir}/ @your-architects-group`,
    '  2. GitLab Premium+: Settings > Repository > Protected branches > require Code Owner approval on the default branch.',
    '  3. In each code repo: adrien init --code-repo --log <path|url> && adrien init --agents',
    '',
  ].join('\n');
}

/**
 * The `<parent>/<workspace>` folder for a parent the person gave: relative, inside the log, no trailing slash. Only
 * this folder is checked: an explicit `--adr-dir` is written as it is.
 */
function adrDirUnder(parent: string, base: Omit<LogConfig, 'adr_dir'> & { workspace: string }): string {
  const trimmed = parent.trim().replace(/\/+$/, '');
  if (trimmed === '' || posix.isAbsolute(trimmed) || win32.isAbsolute(trimmed)) {
    throw new AdrienError(
      'INVALID_INPUT',
      `The parent folder of the ADRs must be a relative folder inside the log, not "${parent}".`,
    );
  }
  const adrDir = posix.join(trimmed, base.workspace);
  const problem = adrDirProblem({ ...base, adr_dir: adrDir });
  if (problem) throw new AdrienError('INVALID_INPUT', problem);
  return adrDir;
}

/** The log's own ADR folder: `--adr-dir` as given, else docs/adr when it holds ADRs, else <parent>/<workspace>. */
async function chooseAdrDir(
  cli: Cli,
  opts: InitOptions,
  base: Omit<LogConfig, 'adr_dir'> & { workspace: string },
): Promise<{ adrDir: string; keptLegacy: boolean }> {
  if (opts.adrDir !== undefined) return { adrDir: opts.adrDir, keptLegacy: false };
  const legacy = readWorkingLog(cli.cwd, { ...base, adr_dir: LEGACY_ADR_DIR });
  if (legacy.adrs.length > 0) return { adrDir: LEGACY_ADR_DIR, keptLegacy: true };
  if (opts.adrParent !== undefined) return { adrDir: adrDirUnder(opts.adrParent, base), keptLegacy: false };
  if (cli.ask) {
    const answer = (await cli.ask(`Parent folder for the ADRs (${DEFAULT_ADR_PARENT}): `)).trim();
    return { adrDir: adrDirUnder(answer === '' ? DEFAULT_ADR_PARENT : answer, base), keptLegacy: false };
  }
  return { adrDir: adrDirUnder(DEFAULT_ADR_PARENT, base), keptLegacy: false };
}

async function initLog(cli: Cli, opts: InitOptions): Promise<void> {
  if (opts.adrParent !== undefined && opts.adrDir !== undefined) {
    throw new AdrienError(
      'INVALID_INPUT',
      '--adr-parent and --adr-dir cannot be given together: --adr-dir names the ADR folder itself.',
    );
  }
  const product = opts.product ?? basename(cli.cwd);
  const fields = {
    id_format: opts.idFormat,
    tags: opts.tags ? csv(opts.tags) : DEFAULT_TAGS,
    components: Object.fromEntries(csv(opts.components).map((c) => [c, {}])),
  };
  if (opts.workspace !== undefined && !isWorkspaceName(opts.workspace)) {
    throw new AdrienError(
      'INVALID_INPUT',
      `--workspace "${opts.workspace}" is not a valid workspace name: use lowercase letters, digits, ".", "_" or "-".`,
    );
  }
  // Only product and workspace decide the name here; the placeholder ADR folder is not used.
  const workspace = opts.workspace ?? workspaceNameOf({ product, adr_dir: LEGACY_ADR_DIR, ...fields });
  if (workspace === null) {
    throw new AdrienError(
      'INVALID_INPUT',
      'Could not derive a workspace name from the product name; pass --workspace <name>.',
    );
  }
  // Refuse a second init before asking anything: the answer could not be used.
  const configFile = join(cli.cwd, CONFIG_FILE);
  if (existsSync(configFile)) throw new AdrienError('CONFIG_EXISTS', `${configFile} already exists`);
  const base = { product, workspace, ...fields };
  const { adrDir, keptLegacy } = await chooseAdrDir(cli, opts, base);
  const config: LogConfig = { ...base, adr_dir: adrDir };
  writeLogConfig(cli.cwd, config);
  try {
    loadLogConfig(cli.cwd);
  } catch (e) {
    rmSync(join(cli.cwd, CONFIG_FILE));
    throw e;
  }
  const adrDirPath = join(cli.cwd, ...config.adr_dir.split('/'));
  mkdirSync(adrDirPath, { recursive: true });
  if (!existsSync(join(adrDirPath, '.gitkeep'))) writeFileSync(join(adrDirPath, '.gitkeep'), '');
  if (keptLegacy) {
    const unused =
      opts.adrParent === undefined ? '.' : ', so --adr-parent was not used; pass --adr-dir to choose another folder.';
    cli.out(`Kept the existing ADRs in ${LEGACY_ADR_DIR} (adr_dir: ${LEGACY_ADR_DIR})${unused}\n`);
  }
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
    .option('--workspace <name>', 'workspace name (default: the product name, slugged)')
    .option('--adr-dir <dir>', 'where ADR files live, as given (not with --adr-parent)')
    .option(
      '--adr-parent <dir>',
      'parent folder of the ADR folder, which is named after the workspace (default: adrien-docs)',
    )
    .option('--tags <list>', 'allowed tags, comma-separated (default: frontend,backend,database,infra,security)')
    .option(
      '--components <list>',
      'components, comma-separated (log: add their repo URLs to the config later; --code-repo: override detection)',
    )
    .option('--id-format <format>', 'id format', 'ADR-{n:4}')
    .action(async (opts: InitOptions, cmd: Command) => {
      const { log } = cmd.optsWithGlobals<{ log?: string }>();
      if (opts.codeRepo) initCodeRepo(cli, { ...opts, log: singleLog(log) });
      if (opts.agents) initAgents(cli);
      if (!opts.codeRepo && !opts.agents) await initLog(cli, opts);
    });
}
