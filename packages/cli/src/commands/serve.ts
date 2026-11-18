import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_PORT, isLoopback, startServer } from '@adrien/api';
import { AdrienError, syncCachedClone } from '@adrien/core';
import { type Command, InvalidArgumentError } from 'commander';
import { type Cli, contextOf, type GlobalOptions } from '../cli.ts';

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
        const token = cli.env.ADRIEN_TOKEN?.trim() || undefined;
        assertSafeToExpose(opts.host, token !== undefined, !opts.auth);
        const allowedHosts = [
          ...opts.allowedHost,
          ...(cli.env.ADRIEN_ALLOWED_HOSTS ?? '')
            .split(',')
            .map((h) => h.trim())
            .filter(Boolean),
        ];
        // No log is a usage error now, not a 500 on every request later.
        const ctx = await contextOf(cli, { log });
        const server = await startServer({
          cwd: cli.cwd,
          log,
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
        if (ctx.readOnly && opts.syncEvery > 0)
          scheduleSync(ctx.logRoot, opts.syncEvery, syncCachedClone, (m) => cli.err(m));
        // The action ends once the server listens, so the bin prints this line now; the open server keeps the process
        // running until it is interrupted.
        cli.out(`Adrien serving ${ctx.config.product} at ${server.url}\n`);
      },
    );
}
