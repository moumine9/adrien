import {
  AdrIndex,
  AdrienError,
  type Context,
  EXPORT_FORMATS,
  type ExportFormat,
  exportLog,
  type Filters,
  forFilesWithCommon,
  type LogView,
  loadLogView,
  modifiedAtById,
  resolveWorkspaces,
  runCheck,
  STATUSES,
  type Status,
  type Workspace,
  type WorkspaceSpec,
  type Workspaces,
  workingRevision,
} from '@adrien/core';
import { Hono, type Context as HonoContext } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { isAuthorized } from './auth.ts';
import type { AdrsResponse, ApiError, CheckResponse, ForResponse, WorkspacesResponse } from './contract.ts';
import { isAllowedHost } from './host.ts';
import { adrOf, graphOf, metaOf } from './views.ts';
import { serveWeb } from './web.ts';

export interface ApiOptions {
  /** Where each request resolves the log from, as the CLI does from its working directory. */
  cwd: string;
  /** The log to serve (a path or a git URL), as `--log`. */
  log?: string;
  /** Several logs to serve, each a workspace under `/api/w/<name>/`. Takes the place of `log` when given. */
  logs?: readonly WorkspaceSpec[];
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

/** A refusal of the API itself (a workspace that does not exist, or one that must be named), with its own status. */
class RouteError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

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

/**
 * The workspace a request names: `/api/w/<name>/...` names one, the flat routes take the only one. A name is only ever
 * looked up among the workspaces (never turned into a path).
 */
function pickWorkspace(workspaces: Workspaces, name: string | undefined): Workspace {
  if (name === undefined) {
    if (workspaces.all.length === 1) return workspaces.only();
    throw new RouteError(
      404,
      'WORKSPACE_REQUIRED',
      `This server has several workspaces: use /api/w/<name>/... with one of ${workspaces.names().join(', ')}.`,
    );
  }
  if (!workspaces.names().includes(name)) {
    throw new RouteError(
      404,
      'WORKSPACE_NOT_FOUND',
      `No workspace "${name}". Known: ${workspaces.names().join(', ')}.`,
    );
  }
  return workspaces.get(name);
}

/** The read-only HTTP API of docs/api.md, and the web visualizer's files. Every request re-reads the log. */
export function createApp(opts: ApiOptions): Hono {
  const app = new Hono();
  const specs: readonly WorkspaceSpec[] = opts.logs ?? (opts.log !== undefined ? [{ log: opts.log }] : []);
  const env = opts.env ?? process.env;
  /** Every route, flat and under its workspace; the handler gets the workspace and its freshly read view. */
  const route = (
    path: string,
    handler: (c: HonoContext, workspace: Workspace, view: LogView) => Response | Promise<Response>,
  ) => {
    const run = async (c: HonoContext) => {
      const workspaces = await resolveWorkspaces({ cwd: opts.cwd, specs, env });
      const workspace = pickWorkspace(workspaces, c.req.param('workspace'));
      return handler(c, workspace, await loadLogView(workspace.ctx.logRoot, workspace.ctx.config));
    };
    app.get(`/api/${path}`, run);
    app.get(`/api/w/:workspace/${path}`, run);
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

  app.get('/api/workspaces', async (c) => {
    const { all } = await resolveWorkspaces({ cwd: opts.cwd, specs, env });
    return c.json<WorkspacesResponse>({
      workspaces: all.map((w) => ({ name: w.name, product: w.ctx.config.product, default: all.length === 1 })),
    });
  });

  route('meta', (c, workspace, view) => c.json(metaOf(workspace, view, opts.version ?? '0.0.0')));

  route('adrs', async (c, { ctx }, view) => {
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
    // Every match, ranked: the index holds at most one row per base ADR and one per pending change.
    const limit = view.base.length + view.pending.length;
    const results = await withIndex(ctx, view, (index) => (q ? index.search(q, filters, limit) : index.list(filters)));
    const modified = await modifiedAtById(ctx.logRoot, view);
    return c.json<AdrsResponse>({
      results: results.map((row) => ({
        ...row,
        revision: workingRevision(view, row.id),
        modifiedAt: modified.get(row.id) ?? null,
      })),
    });
  });

  route('adrs/:id', async (c, { ctx }, view) => {
    // The route always matches an id: the helper's path is a plain string, so Hono cannot type the parameter.
    const id = c.req.param('id') as string;
    return c.json(adrOf(view, id, (await modifiedAtById(ctx.logRoot, view)).get(id) ?? null));
  });

  route('graph', (c, _workspace, view) => c.json(graphOf(view)));

  route('for', async (c, { ctx }, view) => {
    const paths = all(c, 'path');
    if (!paths.length) throw new AdrienError('INVALID_INPUT', 'Give at least one file: /api/for?path=src/a.ts');
    const { files, notes, commonNotes } = await forFilesWithCommon(ctx, view, paths);
    return c.json<ForResponse>({
      files,
      ...(notes.length > 0 ? { notes } : {}),
      ...(commonNotes.length > 0 ? { common_notes: commonNotes } : {}),
    });
  });

  route('check', async (c, { ctx }, view) => {
    const diagnostics = await runCheck(ctx, view, { lint: flag(c.req.query('lint')) });
    return c.json<CheckResponse>({
      errors: diagnostics.filter((d) => d.severity === 'error').length,
      warnings: diagnostics.filter((d) => d.severity === 'warning').length,
      diagnostics,
    });
  });

  route('export', (c, { ctx }, view) => {
    const format = c.req.query('format') ?? 'markdown';
    if (!(EXPORT_FORMATS as readonly string[]).includes(format)) {
      throw new AdrienError('INVALID_INPUT', `Unknown format "${format}". Use one of: ${EXPORT_FORMATS.join(', ')}`);
    }
    return c.text(exportLog(ctx, view, format as ExportFormat));
  });

  const web = serveWeb(opts.webDir);
  app.get('*', (c) => (isApi(c.req.path) ? c.notFound() : web(c)));

  app.notFound((c) => fail(c, 404, 'NOT_FOUND', `No endpoint at ${c.req.path} (see docs/api.md).`));
  app.onError((e, c) => {
    if (e instanceof RouteError) return fail(c, e.status, e.code, e.message);
    if (e instanceof AdrienError) return fail(c, HTTP_STATUS[e.code] ?? 500, e.code, e.message);
    return fail(c, 500, 'INTERNAL_ERROR', e.message);
  });
  return app;
}
