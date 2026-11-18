import type { Server } from 'node:http';
import { serve } from '@hono/node-server';
import { type ApiOptions, createApp } from './app.ts';
import { hostnameOf } from './host.ts';

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4310;

export interface ServerHandle {
  /** `http://host:port`, with the port actually bound (so port 0 shows the one picked). */
  url: string;
  /** The address the socket is bound to. */
  address: string;
  port: number;
  /** Stops listening and drops open connections. */
  close(): Promise<void>;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    // Idle keep-alive connections would otherwise hold close() open for seconds.
    server.closeAllConnections();
  });
}

/** Listens on `host:port` (default 127.0.0.1:4310) and resolves once the socket is bound. */
export function startServer(opts: ApiOptions): Promise<ServerHandle> {
  const host = hostnameOf(opts.host ?? DEFAULT_HOST);
  const app = createApp({ ...opts, host });
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: host, port: opts.port ?? DEFAULT_PORT }, (info) => {
      server.off('error', reject);
      resolve({
        url: `http://${host.includes(':') ? `[${host}]` : host}:${info.port}`,
        address: info.address,
        port: info.port,
        close: () => closeServer(server as Server),
      });
    });
    server.once('error', reject);
  });
}
