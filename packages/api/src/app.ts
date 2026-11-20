import {
  AdrIndex,
  AdrienError,
  adrsForFiles,
  type Context,
  EXPORT_FORMATS,
  type ExportFormat,
  exportLog,
  type Filters,
  type LogView,
  loadLogView,
  modifiedAtById,
  resolveContext,
  runCheck,
  STATUSES,
  type Status,
  unverifiedBaseNote,
  workingRevision,
} from '@adrien/core';
import { Hono, type Context as HonoContext } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { isAuthorized } from './auth.ts';
import type { AdrsResponse, ApiError, CheckResponse, ForResponse } from './contract.ts';
import { isAllowedHost } from './host.ts';
import { adrOf, graphOf, metaOf } from './views.ts';
import { serveWeb } from './web.ts';

export interface ApiOptions {
  /** Where each request resolves the log from, as the CLI does from its working directory. */
  cwd: string;
  /** The log to serve (a path or a git URL), as `--log`. */
  log?: string;
  env?: NodeJS.ProcessEnv;
  /** Reported by `/api/meta`. */
  version?: string;
  /** The host the server is bound to: a request may name it in `Host`, besides the loopback names. */
  host?: string;
  port?: number;
  /** Further host names a request may carry, for a server reached by name (behind a reverse proxy). */
  allowedHosts?: string[];
  /** When set, every request must carry it (`Authorization: Bearer` or Basic), except `/healthz`. */
  token?: string;
  /** The built web visualizer. Without one, `/` says where the API is. */
  webDir?: string;
}

const HTTP_STATUS: Partial<Record<string, ContentfulStatusCode>> = { ADR_NOT_FOUND: 404, INVALID_INPUT: 400 };

const fail = (c: HonoContext, status: ContentfulStatusCode, code: string, message: string) =>
  c.json<ApiError>({ error: { code, message } }, status);

const isApi = (path: string): boolean => path === '/api' || path.startsWith('/api/');

const flag = (value: string | undefined): boolean => value === '1' || value === 'true';

/** A repeatable query parameter, without empty values. */
const all = (c: HonoContext, name: string): string[] => (c.req.queries(name) ?? []).filter(Boolean);

async function withIndex<T>(ctx: Context, view: LogView, use: (index: AdrIndex) => T): Promise<T> {
  const index = await AdrIndex.open(ctx.logRoot);
  try {
    index.sync(view);
    return use(index);
  } finally {
    index.close();
  }
}

/** The read-only HTTP API of docs/api.md, and the web visualizer's files. Every request re-reads the log. */
export function createApp(opts: ApiOptions): Hono {
  const app = new Hono();
  const load = async (): Promise<{ ctx: Context; view: LogView }> => {
    const ctx = await resolveContext({ cwd: opts.cwd, log: opts.log, env: opts.env ?? process.env });
    return { ctx, view: await loadLogView(ctx.logRoot, ctx.config) };
  };

  // Outermost, so refusals and errors are never cached either.
  app.use(async (c, next) => {
    await next();
    if (isApi(c.req.path)) c.header('Cache-Control', 'no-store');
  });

  app.use(async (c, next) => {
    const host = c.req.header('host') ?? new URL(c.req.url).host;
    if (!isAllowedHost(host, opts.host, opts.allowedHosts)) {
      return fail(
        c,
        403,
        'FORBIDDEN_HOST',
        `Requests for host "${host}" are refused: open the URL adrien serve printed, or allow this name with --allowed-host.`,
      );
    }
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      c.header('Allow', 'GET, HEAD');
      return fail(c, 405, 'METHOD_NOT_ALLOWED', 'This API is read-only: only GET and HEAD are served.');
    }
    // Liveness for a container or load balancer: no data, so no credentials.
    if (c.req.path === '/healthz') return c.text('ok\n');
    if (opts.token !== undefined && !isAuthorized(c.req.header('authorization'), opts.token)) {
      c.header('WWW-Authenticate', 'Basic realm="Adrien", charset="UTF-8"');
      c.header('Cache-Control', 'no-store');
      return fail(
        c,
        401,
        'UNAUTHORIZED',
        'This server asks for its access token: send it as a Bearer token or as the password.',
      );
    }
    await next();
  });

  app.get('/api/meta', async (c) => {
    const { ctx, view } = await load();
    return c.json(metaOf(ctx, view, opts.version ?? '0.0.0'));
  });

  app.get('/api/adrs', async (c) => {
    const status = all(c, 'status');
    const unknown = status.filter((s) => !(STATUSES as readonly string[]).includes(s));
    if (unknown.length) {
      throw new AdrienError('INVALID_INPUT', `Unknown status ${unknown.join(', ')}. Use: ${STATUSES.join(', ')}`);
    }
    const filters: Filters = {
      tags: all(c, 'tag'),
      components: all(c, 'component'),
      status: status as Status[],
      layer: flag(c.req.query('pending')) ? 'pending' : 'all',
    };
    const q = c.req.query('q')?.trim();
    const { ctx, view } = await load();
    // Every match, ranked: the index holds at most one row per base ADR and one per pending change.
    const limit = view.base.length + view.pending.length;
    const results = await withIndex(ctx, view, (index) => (q ? index.search(q, filters, limit) : index.list(filters)));
    const modified = await modifiedAtById(ctx.logRoot, ctx.config, view);
    return c.json<AdrsResponse>({
      results: results.map((row) => ({
        ...row,
        revision: workingRevision(view, row.id),
        modifiedAt: modified.get(row.id) ?? null,
      })),
    });
  });

  app.get('/api/adrs/:id', async (c) => {
    const { ctx, view } = await load();
    const id = c.req.param('id');
    return c.json(adrOf(view, id, (await modifiedAtById(ctx.logRoot, ctx.config, view)).get(id) ?? null));
  });

  app.get('/api/graph', async (c) => {
    const { view } = await load();
    return c.json(graphOf(view));
  });

  app.get('/api/for', async (c) => {
    const paths = all(c, 'path');
    if (!paths.length) throw new AdrienError('INVALID_INPUT', 'Give at least one file: /api/for?path=src/a.ts');
    const { ctx, view } = await load();
    const note = unverifiedBaseNote(view);
    return c.json<ForResponse>({ files: adrsForFiles(ctx, view, paths), ...(note ? { notes: [note] } : {}) });
  });

  app.get('/api/check', async (c) => {
    const { ctx, view } = await load();
    const diagnostics = await runCheck(ctx, view, { lint: flag(c.req.query('lint')) });
    return c.json<CheckResponse>({
      errors: diagnostics.filter((d) => d.severity === 'error').length,
      warnings: diagnostics.filter((d) => d.severity === 'warning').length,
      diagnostics,
    });
  });

  app.get('/api/export', async (c) => {
    const format = c.req.query('format') ?? 'markdown';
    if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
      throw new AdrienError('INVALID_INPUT', `Unknown format "${format}". Use one of: ${EXPORT_FORMATS.join(', ')}`);
    }
    const { ctx, view } = await load();
    return c.text(exportLog(ctx, view, format as ExportFormat));
  });

  const web = serveWeb(opts.webDir);
  app.get('*', (c) => (isApi(c.req.path) ? c.notFound() : web(c)));

  app.notFound((c) => fail(c, 404, 'NOT_FOUND', `No endpoint at ${c.req.path} (see docs/api.md).`));
  app.onError((e, c) => {
    if (e instanceof AdrienError) return fail(c, HTTP_STATUS[e.code] ?? 500, e.code, e.message);
    return fail(c, 500, 'INTERNAL_ERROR', e.message);
  });
  return app;
}
