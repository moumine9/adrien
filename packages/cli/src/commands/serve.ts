import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_PORT, isLoopback, startServer } from '@adrien/api';
import { AdrienError, resolveWorkspaces, syncCachedClone, type Workspace } from '@adrien/core';
import { type Command, InvalidArgumentError } from 'commander';
import { type Cli, type GlobalOptions, logSpecs } from '../cli.ts';

const LISTEN_ERRORS = new Set(['EADDRINUSE', 'EADDRNOTAVAIL', 'EACCES', 'ENOTFOUND']);

function port(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) > 65535) {
    throw new InvalidArgumentError('Use a port from 0 to 65535 (0 picks a free one).');
  }
  return Number(value);
}

function seconds(value: string): number {
  if (!/^\d+$/.test(value)) throw new InvalidArgumentError('Use a whole number of seconds (0 turns it off).');
  return Number(value);
}

const collect = (value: string, previous: string[]): string[] => [...previous, value];

/** Refuses to put a server on the network with nobody asking who is reading it, unless that is said outright. */
export function assertSafeToExpose(host: string, hasToken: boolean, noAuth: boolean): void {
  if (hasToken && noAuth) throw new AdrienError('INVALID_INPUT', 'Use either ADRIEN_TOKEN or --no-auth, not both.');
  if (!isLoopback(host) && !hasToken && !noAuth) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Refusing to serve beyond this machine without authentication. Set ADRIEN_TOKEN, or pass --no-auth if a reverse proxy in front already authenticates.`,
    );
  }
}

/** Fetches a log read from a git URL on a timer, so a long-running server follows its upstream. Returns a stopper. */
export function scheduleSync(
  dir: string,
  everySeconds: number,
  sync: (dir: string) => Promise<void>,
  warn: (message: string) => void,
): () => void {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await sync(dir);
    } catch (e) {
      warn(`Could not refresh the log: ${(e as Error).message}\n`);
    } finally {
      running = false;
    }
  }, everySeconds * 1000);
  timer.unref();
  return () => clearInterval(timer);
}

/** Starts a sync timer for each workspace whose log is read from a git URL, once per log: several names may share one. */
export function scheduleWorkspaceSyncs(
  workspaces: readonly Workspace[],
  everySeconds: number,
  sync: (dir: string) => Promise<void>,
  warn: (message: string) => void,
): () => void {
  const roots = new Set<string>();
  const stops: (() => void)[] = [];
  for (const { ctx } of workspaces) {
    if (!ctx.readOnly || roots.has(ctx.logRoot)) continue;
    roots.add(ctx.logRoot);
    stops.push(scheduleSync(ctx.logRoot, everySeconds, sync, warn));
  }
  return () => {
    for (const stop of stops) stop();
  };
}

export function registerServe(program: Command, cli: Cli): void {
  program
    .command('serve')
    .option('--port <n>', 'port to listen on (0 picks a free one)', port, DEFAULT_PORT)
    .option('--host <host>', 'address to bind; requests must name it or a loopback name', DEFAULT_HOST)
    .option(
      '--allowed-host <name>',
      'a host name requests may carry, such as the public name behind a proxy (repeatable)',
      collect,
      [],
    )
    .option('--no-auth', 'serve beyond this machine without a token, when a reverse proxy authenticates')
    .option(
      '--sync-every <seconds>',
      'for a log read from a git URL: fetch it this often (0 turns it off)',
      seconds,
      300,
    )
    .description(
      'Serve the read-only HTTP API and the web visualizer. On this machine by default; set ADRIEN_TOKEN to require a token, and ADRIEN_ALLOWED_HOSTS (comma-separated) as an alternative to --allowed-host',
    )
    .action(
      async (
        opts: { port: number; host: string; allowedHost: string[]; auth: boolean; syncEvery: number },
        cmd: Command,
      ) => {
        const { log } = cmd.optsWithGlobals<GlobalOptions>();
        const specs = logSpecs(log);
        const token = cli.env.ADRIEN_TOKEN?.trim() || undefined;
        assertSafeToExpose(opts.host, token !== undefined, !opts.auth);
        const allowedHosts = [
          ...opts.allowedHost,
          ...(cli.env.ADRIEN_ALLOWED_HOSTS ?? '')
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean),
        ];
        // A misconfigured set (no log, an unnamed log, a repeated name or log) is a usage error now, not a 400 on every
        // request later.
        const workspaces = await resolveWorkspaces({ cwd: cli.cwd, specs, env: cli.env });
        const server = await startServer({
          cwd: cli.cwd,
          logs: specs,
          env: cli.env,
          version: program.version(),
          host: opts.host,
          port: opts.port,
          allowedHosts,
          token,
          // The built web app ships next to the bundle, in dist/web.
          webDir: fileURLToPath(new URL('./web', import.meta.url)),
        }).catch((e: NodeJS.ErrnoException) => {
          if (!LISTEN_ERRORS.has(e.code ?? '')) throw e;
          throw new AdrienError('INVALID_INPUT', `Cannot listen on ${opts.host}:${opts.port}: ${e.message}`);
        });
        if (opts.syncEvery > 0)
          scheduleWorkspaceSyncs(workspaces.all, opts.syncEvery, syncCachedClone, (m) => process.stderr.write(m));
        // The action ends once the server listens, so the bin prints this line now; the open server keeps the process
        // running until it is interrupted.
        const [only] = workspaces.all;
        if (workspaces.all.length === 1 && only)
          cli.out(`Adrien serving ${only.ctx.config.product} at ${server.url}\n`);
        else
          cli.out(
            `Adrien serving ${workspaces.all.length} workspaces (${workspaces.names().join(', ')}) at ${server.url}\n`,
          );
      },
    );
}
