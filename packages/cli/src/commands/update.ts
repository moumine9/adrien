import { execFileSync, spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  AdrienError,
  adrDirProblem,
  type BackupVerification,
  CODE_CONFIG_FILE,
  CONFIG_FILE,
  type Context,
  createBackup,
  findUp,
  isGitUrl,
  loadCodeRepoConfig,
  resolveContext,
  verifyBackup,
} from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, printJson } from '../cli.ts';
import { VERSION } from '../version.ts';
import { changeLines, differs, skippedLine } from './backup.ts';

const REGISTRY_URL = 'https://registry.npmjs.org/adrien/latest';
const TIMEOUT_MS = 5000;
const INSTALL_ARGS = ['install', '-g', 'adrien@latest'];

/** The decision-log side of a global update: finding the log, copying it before the install and checking it after. */
export interface BackupDeps {
  /** The log the working directory resolves to; 'remote' for a remote clone (never cloned here); null when there is none. */
  logAt: (cwd: string, log: string | undefined, env: NodeJS.ProcessEnv) => Promise<Context | 'remote' | null>;
  create: typeof createBackup;
  verify: typeof verifyBackup;
}

/** What the command depends on from outside: the running version, the registry, the installer, where this copy lives and the decision log. */
export interface UpdateDeps {
  current: string;
  fetch: typeof fetch;
  install: (command: string, args: string[]) => Promise<number>;
  installPath: string;
  /** Where `npm install -g` puts packages, or null when npm cannot say. */
  globalRoot: () => string | null;
  backup: BackupDeps;
}

/**
 * The real decision-log side. A remote log is recognised from its URL before resolving, because resolving would clone
 * it. A missing log is not an error here; a log that cannot be read is.
 */
export const backupDefaults: BackupDeps = {
  logAt: async (cwd, log, env) => {
    if (log !== undefined && isGitUrl(log)) return 'remote';
    if (log === undefined && !findUp(cwd, CONFIG_FILE)) {
      const dir = findUp(cwd, CODE_CONFIG_FILE);
      const codeConfig = dir ? loadCodeRepoConfig(dir) : null;
      if (codeConfig && isGitUrl(codeConfig.log)) return 'remote';
    }
    try {
      const ctx = await resolveContext({ cwd, log, env });
      return ctx.readOnly ? 'remote' : ctx;
    } catch (e) {
      if (e instanceof AdrienError && e.code === 'CONFIG_NOT_FOUND') return null;
      throw e;
    }
  },
  create: createBackup,
  verify: verifyBackup,
};

export type InstallKind = 'npx' | 'global' | 'pnpm' | 'yarn' | 'bun' | 'project' | 'unknown';

interface ParsedVersion {
  core: number[];
  pre: string[] | null;
}

function parse(version: string): ParsedVersion | null {
  const m = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(version);
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : null };
}

/** Semver order for plain x.y.z and prerelease tags (a release is newer than its prereleases). Build metadata is ignored. */
export function compareVersions(a: string, b: string): number {
  const x = parse(a);
  const y = parse(b);
  if (!x || !y) throw new AdrienError('INVALID_INPUT', `Not a version: ${x ? b : a}`);
  for (let i = 0; i < 3; i++) {
    const diff = (x.core[i] ?? 0) - (y.core[i] ?? 0);
    if (diff !== 0) return diff;
  }
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; ; i++) {
    const p = x.pre[i];
    const q = y.pre[i];
    if (p === undefined && q === undefined) return 0;
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    if (p === q) continue;
    const pNumeric = /^\d+$/.test(p);
    const qNumeric = /^\d+$/.test(q);
    if (pNumeric && qNumeric) return Number(p) - Number(q);
    if (pNumeric !== qNumeric) return pNumeric ? -1 : 1;
    return p < q ? -1 : 1;
  }
}

/**
 * Says how this copy of adrien was installed, from the real path of the running bundle. Only a copy under npm's own
 * global root is `global`, the one kind this command may install over; any other `node_modules` copy is a project's.
 */
export function detectInstall(path: string, globalRoot: string | null): InstallKind {
  const p = path.replace(/\\/g, '/');
  if (p.includes('/_npx/')) return 'npx';
  if (/\/pnpm\/(global|dlx)\//.test(p)) return 'pnpm';
  if (/\/(\.yarn|yarn)\/(global|berry)?/.test(p) && p.includes('/node_modules/adrien/')) return 'yarn';
  if (p.includes('/.bun/')) return 'bun';
  if (!p.includes('/node_modules/adrien/')) return 'unknown';
  const root = globalRoot?.replace(/\\/g, '/').replace(/\/$/, '');
  return root && p.startsWith(`${root}/`) ? 'global' : 'project';
}

/** The folder `npm install -g` writes to, resolved through symlinks; null when npm is missing or fails. */
export function npmGlobalRoot(): string | null {
  try {
    const options = { encoding: 'utf8', timeout: TIMEOUT_MS } as const;
    // On Windows npm is npm.cmd, which only a shell can start. Node 24 warns when a shell is given an argument list, so
    // the command goes in as one constant string there.
    const out =
      process.platform === 'win32'
        ? execFileSync('npm root -g', { ...options, shell: true })
        : execFileSync('npm', ['root', '-g'], options);
    return realpathSync(out.trim());
  } catch {
    return null;
  }
}

/** Runs the installer and resolves with its exit code; only the global install path calls this. */
export function spawnInstaller(command: string, args: string[]): Promise<number> {
  process.stderr.write(`Running ${command} ${args.join(' ')}\n`);
  return new Promise((resolve, reject) => {
    // Same Windows rule as above: one constant command string with a shell, an argument list without one.
    const child =
      process.platform === 'win32'
        ? spawn(`${command} ${args.join(' ')}`, { stdio: 'inherit', shell: true })
        : spawn(command, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const defaults = (): UpdateDeps => ({
  current: VERSION,
  fetch: (input, init) => fetch(input, init),
  install: spawnInstaller,
  installPath: realpathSync(fileURLToPath(import.meta.url)),
  globalRoot: npmGlobalRoot,
  backup: backupDefaults,
});

async function fetchLatest(fetchFn: typeof fetch): Promise<string> {
  const unreachable = () =>
    new AdrienError('NETWORK', 'Could not reach the npm registry to check for updates. Try again later.');
  let version: unknown;
  try {
    const res = await fetchFn(REGISTRY_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw unreachable();
    version = ((await res.json()) as { version?: unknown }).version;
  } catch {
    throw unreachable();
  }
  if (typeof version !== 'string' || parse(version) === null) throw unreachable();
  return version;
}

export function registerUpdate(program: Command, cli: Cli): void {
  program
    .command('update')
    .description('Check the npm registry for a newer adrien and install it (global installs only)')
    .option('--check', 'only report the current and latest versions')
    .action(async (opts: { check?: boolean }, cmd: Command) => {
      const globals = cmd.optsWithGlobals<GlobalOptions>();
      const deps = { ...defaults(), ...cli.update };
      const latest = await fetchLatest(deps.fetch);
      const updateAvailable = parse(latest)?.pre == null && compareVersions(latest, deps.current) > 0;

      if (globals.json) return printJson(cli, { current: deps.current, latest, updateAvailable });
      if (opts.check) {
        cli.out(`Current: ${deps.current}\nLatest:  ${latest}\n`);
        cli.out(
          updateAvailable
            ? 'Update available. Run `adrien update` to install it.\n'
            : `adrien ${deps.current} is up to date.\n`,
        );
        return;
      }
      if (!updateAvailable) return cli.out(`adrien ${deps.current} is the latest version.\n`);

      switch (detectInstall(deps.installPath, deps.globalRoot())) {
        case 'npx':
          return cli.out(`adrien is running through npx. Run \`npx adrien@latest\` to use ${latest}.\n`);
        case 'project':
          return cli.out(
            `adrien is a project dependency. Run \`npm install adrien@latest\` in the project to get ${latest}.\n`,
          );
        case 'pnpm':
          return cli.out(`adrien is installed with pnpm. Run \`pnpm add -g adrien@latest\` to get ${latest}.\n`);
        case 'yarn':
          return cli.out(`adrien is installed with yarn. Run \`yarn global add adrien@latest\` to get ${latest}.\n`);
        case 'bun':
          return cli.out(`adrien is installed with bun. Run \`bun add -g adrien@latest\` to get ${latest}.\n`);
        case 'unknown':
          return cli.out(
            `Could not tell how adrien was installed. To get ${latest}, run \`npm ${INSTALL_ARGS.join(' ')}\`.\n`,
          );
        case 'global':
          break;
      }

      // Before anything is installed, the decision files are copied: a failed copy stops the update.
      let backup: { id: string; root: string } | null = null;
      try {
        const found = await deps.backup.logAt(cli.cwd, globals.log, cli.env);
        if (found === null) cli.out('No decision log here, nothing to back up.\n');
        else if (found === 'remote') {
          cli.out('Skipped: the log is a remote clone, so there are no local decision files to back up.\n');
        } else {
          const problem = adrDirProblem(found.config);
          if (problem) cli.out(`Skipped: ${problem}\n`);
          else {
            const made = deps.backup.create(
              found.logRoot,
              found.config,
              `before-update-${deps.current}`,
              deps.current,
              cli.env,
            );
            cli.out(`Backed up the decision files to ${made.path}\n`);
            if (made.skipped.length > 0) cli.out(skippedLine(made.skipped));
            backup = { id: made.id, root: found.logRoot };
          }
        }
      } catch (e) {
        cli.err(`adrien: could not back up the decision files, so nothing was installed: ${(e as Error).message}\n`);
        return cli.setCode(1);
      }

      let code: number;
      try {
        code = await deps.install('npm', INSTALL_ARGS);
      } catch (e) {
        cli.err(`adrien: could not start npm: ${(e as Error).message}\n`);
        return cli.setCode(1);
      }
      if (code !== 0) {
        cli.err(`adrien: npm install -g adrien@latest failed (exit ${code}).\n`);
        return cli.setCode(1);
      }
      cli.out(`Updated adrien ${deps.current} -> ${latest}.\n`);
      if (!backup) return;
      let changes: BackupVerification;
      try {
        changes = deps.backup.verify(backup.root, backup.id);
      } catch (e) {
        cli.err(`adrien: could not check the decision files against backup ${backup.id}: ${(e as Error).message}\n`);
        return cli.setCode(1);
      }
      if (!differs(changes)) return cli.out('Decision files unchanged.\n');
      cli.out(`Decision files differ from backup ${backup.id}:\n${changeLines(changes)}`);
      cli.out(`Restore them with \`adrien backup restore ${backup.id}\`.\n`);
      cli.setCode(1);
    });
}
