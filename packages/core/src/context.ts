import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import YAML from 'yaml';
import { CODE_CONFIG_FILE, CONFIG_FILE, findUp, type LogConfig, loadCodeRepoConfig, loadLogConfig } from './config.ts';
import { AdrienError } from './errors.ts';
import { git, gitToplevel, remoteUrl, resolveBaseRef } from './git.ts';
import { toPosix } from './log.ts';
import { canonicalPath, isInside } from './paths.ts';
import { isGitUrl, normalizeRepoUrl } from './repo-url.ts';

export interface CodeRepoContext {
  root: string;
  components: string[];
}

export interface Context {
  cwd: string;
  logRoot: string;
  config: LogConfig;
  /** True for a cached clone of a remote log: proposals must go through a real checkout. */
  readOnly: boolean;
  /** The path or URL the log was resolved from, for messages. */
  logSource: string;
  codeRepo: CodeRepoContext | null;
  env: NodeJS.ProcessEnv;
}

export interface ResolveOptions {
  cwd: string;
  log?: string;
  env?: NodeJS.ProcessEnv;
}

const NOT_FOUND =
  'No Adrien log found. Run `adrien init` in your ADR log repo, or `adrien init --code-repo --log <path|url>` in a code repo.';

export function adrienHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.ADRIEN_HOME || join(homedir(), '.adrien');
}

export async function ensureCachedClone(url: string, home: string): Promise<string> {
  const identity = normalizeRepoUrl(url);
  const prefix = identity.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(-40);
  const hash = createHash('sha256').update(identity).digest('hex').slice(0, 24);
  const dir = join(home, 'cache', `${prefix}-${hash}`);
  if (existsSync(join(dir, '.git'))) {
    const origin = await remoteUrl(dir);
    try {
      if (origin && normalizeRepoUrl(origin) === identity) return dir;
    } catch {
      // A malformed origin cannot identify the requested log either.
    }
    throw new AdrienError('CONFIG_INVALID', `Expected cached ADR log origin ${url}, found ${origin ?? 'no origin'}`);
  }
  mkdirSync(dirname(dir), { recursive: true });
  if ((await git(home, ['clone', '--quiet', url, dir])) === null) {
    throw new AdrienError('CONFIG_INVALID', `Could not clone the ADR log from ${url}`);
  }
  return dir;
}

/** Brings a cached clone up to date. Throws when it cannot, so a caller never reports success on a stale copy. */
export async function syncCachedClone(dir: string): Promise<void> {
  if ((await git(dir, ['fetch', '--quiet', 'origin'])) === null) {
    throw new AdrienError(
      'CONFIG_INVALID',
      'Could not fetch the ADR log from its origin: showing the last copy it had.',
    );
  }
  const ref = (await resolveBaseRef(dir)) ?? 'origin/HEAD';
  if ((await git(dir, ['checkout', '--quiet', '--detach', ref])) === null) {
    throw new AdrienError('CONFIG_INVALID', `Could not check out ${ref} in the cached ADR log.`);
  }
}

async function locate(log: string, baseDir: string, env: NodeJS.ProcessEnv) {
  if (isGitUrl(log)) return { logRoot: await ensureCachedClone(log, adrienHome(env)), readOnly: true, logSource: log };
  const logRoot = resolve(baseDir, log);
  return { logRoot, readOnly: false, logSource: logRoot };
}

async function detectCodeRepo(cwd: string, logRoot: string, config: LogConfig): Promise<CodeRepoContext | null> {
  const codeConfigDir = findUp(cwd, CODE_CONFIG_FILE);
  const root = codeConfigDir ?? (await gitToplevel(cwd)) ?? (isInside(cwd, logRoot) ? logRoot : null);
  if (!root) return null;

  const override = codeConfigDir ? loadCodeRepoConfig(codeConfigDir)?.components : undefined;
  if (override) return { root, components: override };

  const remote = await remoteUrl(root);
  const identity = remote ? normalizeRepoUrl(remote) : null;
  const logTop = (await gitToplevel(logRoot)) ?? logRoot;
  const components = Object.entries(config.components)
    .filter(([, def]) =>
      def.repo === '.' ? root === logTop : def.repo !== undefined && normalizeRepoUrl(def.repo) === identity,
    )
    .map(([id]) => id);
  return components.length ? { root, components } : null;
}

export async function resolveContext(opts: ResolveOptions): Promise<Context> {
  const env = opts.env ?? process.env;
  const cwd = canonicalPath(resolve(opts.cwd));
  let located: { logRoot: string; readOnly: boolean; logSource: string };
  if (opts.log) {
    located = await locate(opts.log, cwd, env);
  } else {
    const logDir = findUp(cwd, CONFIG_FILE);
    const codeConfigDir = logDir ? null : findUp(cwd, CODE_CONFIG_FILE);
    const codeConfig = codeConfigDir ? loadCodeRepoConfig(codeConfigDir) : null;
    if (logDir) located = { logRoot: logDir, readOnly: false, logSource: logDir };
    else if (codeConfig && codeConfigDir) located = await locate(codeConfig.log, codeConfigDir, env);
    else throw new AdrienError('CONFIG_NOT_FOUND', NOT_FOUND);
  }
  located = { ...located, logRoot: canonicalPath(located.logRoot) };
  const config = loadLogConfig(located.logRoot);
  return { cwd, ...located, config, codeRepo: await detectCodeRepo(cwd, located.logRoot, config), env };
}

export const componentRoot = (config: LogConfig, id: string): string =>
  toPosix(config.components[id]?.root ?? '')
    .replace(/^(\.\/)+/, '')
    .replace(/^\.$/, '')
    .replace(/\/+$/, '');

/** Maps a file (relative to `ctx.cwd`, `\` or `/`) to the component whose root is its longest prefix. */
export function componentForPath(ctx: Context, path: string): { component: string; relPath: string } | null {
  if (!ctx.codeRepo) return null;
  const abs = resolve(ctx.cwd, path.replace(/\\/g, '/'));
  if (!isInside(abs, ctx.codeRepo.root)) return null;
  const rel = toPosix(relative(ctx.codeRepo.root, abs));
  let best: { component: string; root: string } | null = null;
  for (const component of ctx.codeRepo.components) {
    const root = componentRoot(ctx.config, component);
    const matches = root === '' || rel === root || rel.startsWith(`${root}/`);
    if (matches && (!best || root.length > best.root.length)) best = { component, root };
  }
  if (!best) return null;
  return { component: best.component, relPath: best.root ? rel.slice(best.root.length + 1) : rel };
}

/** Local checkouts of components: `<ADRIEN_HOME>/workspace.yaml`, overridden by `ADRIEN_REPOS="a=/x;b=C:\\y"`. */
export function workspacePaths(env: NodeJS.ProcessEnv): Record<string, string> {
  const paths: Record<string, string> = {};
  const file = join(adrienHome(env), 'workspace.yaml');
  if (existsSync(file)) {
    const data = YAML.parse(readFileSync(file, 'utf8')) as { components?: Record<string, string> } | null;
    Object.assign(paths, data?.components ?? {});
  }
  for (const entry of (env.ADRIEN_REPOS ?? '').split(';')) {
    const eq = entry.indexOf('=');
    if (eq > 0) paths[entry.slice(0, eq).trim()] = entry.slice(eq + 1).trim();
  }
  return paths;
}
