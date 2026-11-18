import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { handleApiRequest, MOCK_VARIANTS, type MockVariant } from './handler.ts';

export interface MockApiOptions {
  variant?: string;
  /** Delay before each answer, so loading states are visible. */
  latencyMs?: number;
}

/**
 * Serves `/api/*` from the fixtures on the Vite dev and preview servers (`vite --mode mock`). Dev-only: nothing here
 * is imported by the app, so it never reaches the production bundle.
 */
export function mockApi(options: MockApiOptions = {}): Plugin {
  const variant: MockVariant = MOCK_VARIANTS.includes(options.variant as MockVariant)
    ? (options.variant as MockVariant)
    : 'default';
  const latency = options.latencyMs ?? 250;

  const middleware: Connect.NextHandleFunction = (req: IncomingMessage, res: ServerResponse, next) => {
    if (!req.url?.startsWith('/api/') && req.url !== '/api') return next();
    const r = handleApiRequest(req.url, variant);
    setTimeout(() => {
      res.statusCode = r.status;
      res.setHeader('content-type', r.contentType);
      res.setHeader('cache-control', 'no-store');
      res.end(r.body);
    }, latency);
  };

  return {
    name: 'adrien-mock-api',
    configureServer(server) {
      server.config.logger.info(`  Mock API: /api/* answered from fixtures (variant "${variant}")`);
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
