import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AdrienError } from '@adrien/core';
import type { Command } from 'commander';
import { type Cli, type GlobalOptions, printJson } from '../cli.ts';
import { VERSION } from '../version.ts';

const REGISTRY_URL = 'https://registry.npmjs.org/adrien/latest';
const TIMEOUT_MS = 5000;
const INSTALL_ARGS = ['install', '-g', 'adrien@latest'];

/** What the command depends on from outside: the running version, the registry, the installer and where this copy lives. */
export interface UpdateDeps {
  current: string;
  fetch: typeof fetch;
  install: (command: string, args: string[]) => Promise<number>;
  installPath: string;
}

export type InstallKind = 'npx' | 'global' | 'project' | 'unknown';

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

/** Says how this copy of adrien was installed, from the path of the running bundle. */
export function detectInstall(path: string): InstallKind {
  const p = path.replace(/\\/g, '/');
  if (p.includes('/_npx/')) return 'npx';
  if (/\/(lib|npm|pnpm\/global\/\d+)\/node_modules\/adrien\//.test(p)) return 'global';
  if (p.includes('/node_modules/adrien/')) return 'project';
  return 'unknown';
}

/** Runs the installer and resolves with its exit code; only the global install path calls this. */
export function spawnInstaller(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

const defaults = (): UpdateDeps => ({
  current: VERSION,
  fetch: (input, init) => fetch(input, init),
  install: spawnInstaller,
  installPath: fileURLToPath(import.meta.url),
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

      switch (detectInstall(deps.installPath)) {
        case 'npx':
          return cli.out(`adrien is running through npx. Run \`npx adrien@latest\` to use ${latest}.\n`);
        case 'project':
          return cli.out(
            `adrien is a project dependency. Run \`npm install adrien@latest\` in the project to get ${latest}.\n`,
          );
        case 'unknown':
          return cli.out(
            `Could not tell how adrien was installed. To get ${latest}, run \`npm ${INSTALL_ARGS.join(' ')}\`.\n`,
          );
        case 'global':
          break;
      }
      cli.out(`Installing adrien ${latest} globally with npm...\n`);
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
    });
}
