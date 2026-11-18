import { fileURLToPath } from 'node:url';
import { DEFAULT_HOST, DEFAULT_PORT, startServer } from '@adrien/api';
import { AdrienError } from '@adrien/core';
import { type Command, InvalidArgumentError } from 'commander';
import { type Cli, contextOf, type GlobalOptions } from '../cli.ts';

const LISTEN_ERRORS = new Set(['EADDRINUSE', 'EADDRNOTAVAIL', 'EACCES', 'ENOTFOUND']);

function port(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) > 65535) {
    throw new InvalidArgumentError('Use a port from 0 to 65535 (0 picks a free one).');
  }
  return Number(value);
}

export function registerServe(program: Command, cli: Cli): void {
  program
    .command('serve')
    .description('Serve the read-only HTTP API and the web visualizer on this machine')
    .option('--port <n>', 'port to listen on (0 picks a free one)', port, DEFAULT_PORT)
    .option('--host <host>', 'address to bind; requests must name it or a loopback name', DEFAULT_HOST)
    .action(async (opts: { port: number; host: string }, cmd: Command) => {
      const { log } = cmd.optsWithGlobals<GlobalOptions>();
      // No log is a usage error now, not a 500 on every request later.
      const ctx = await contextOf(cli, { log });
      const server = await startServer({
        cwd: cli.cwd,
        log,
        env: cli.env,
        version: program.version(),
        host: opts.host,
        port: opts.port,
        // The built web app ships next to the bundle, in dist/web.
        webDir: fileURLToPath(new URL('./web', import.meta.url)),
      }).catch((e: NodeJS.ErrnoException) => {
        if (!LISTEN_ERRORS.has(e.code ?? '')) throw e;
        throw new AdrienError('INVALID_INPUT', `Cannot listen on ${opts.host}:${opts.port}: ${e.message}`);
      });
      // The action ends once the server listens, so the bin prints this line now; the open server keeps the process
      // running until it is interrupted.
      cli.out(`Adrien serving ${ctx.config.product} at ${server.url}\n`);
    });
}
