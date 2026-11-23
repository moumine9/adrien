/**
 * An in-memory implementation of the local HTTP API (docs/api.md) over the fixtures. The Vite mock server and the
 * tests both use it, so the UI is developed against the same semantics the real server documents: tags must all
 * match, components and statuses match any, `pending=1` keeps pending rows, `q` ranks by relevance.
 */
import type {
  AdrFile,
  AdrListRow,
  AdrResponse,
  ApiError,
  FileDecisions,
  ForResponse,
  GraphEdge,
  GraphResponse,
  MetaResponse,
  Status,
} from '@adrien/api/contract';
import { BASE, COMPONENTS, checkReport, PENDING, TAGS } from './fixtures.ts';

/**
 * - `default`: git mode, default branch found, three pending changes.
 * - `unresolved`: no default branch, statuses read as written (`baseUnresolved`).
 * - `common`: a decision from a common log (`workspace` set) and its note in `common_notes`.
 * - `fork`: a shallow fork that shares no history with the default branch (`forkUnresolved`).
 * - `files`: not a git repository (`mode: 'files'`).
 * - `empty`: a log with no decisions yet.
 * - `workspaces`: two workspaces, `adrien` (the default, as `default`) and `common` (the first three decisions only).
 *   The flat routes answer 404 WORKSPACE_REQUIRED, as the real API does.
 */
export type MockVariant = 'default' | 'unresolved' | 'fork' | 'files' | 'empty' | 'workspaces' | 'common';

export const MOCK_VARIANTS: readonly MockVariant[] = [
  'default',
  'unresolved',
  'fork',
  'files',
  'empty',
  'workspaces',
  'common',
];

interface WorkspaceInfo {
  name: string;
  product: string;
  default: boolean;
}

/** The workspaces a variant serves. Only `workspaces` has more than one. */
function workspacesOf(variant: MockVariant): WorkspaceInfo[] {
  const adrien: WorkspaceInfo = { name: 'adrien', product: 'Adrien', default: true };
  return variant === 'workspaces'
    ? [adrien, { name: 'common', product: 'Common standards', default: false }]
    : [adrien];
}

/** The decisions `common` serves: the first three fixture decisions, with no pending changes. */
const COMMON_ADRS = BASE.slice(0, 3);

function commonView(): View {
  return { base: COMMON_ADRS, pending: [] };
}

export interface MockResponse {
  status: number;
  contentType: string;
  body: string;
}

type PendingKind = 'added' | 'modified' | 'deleted';
type Decision = FileDecisions['decisions'][number];

interface View {
  base: AdrFile[];
  pending: Array<{ kind: PendingKind; current: AdrFile | null; base: AdrFile | null }>;
}

const STATUSES: readonly Status[] = ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'];

/** The working tree: the base with the pending changes applied, as it reads with no default branch to compare to. */
function workingTree(): AdrFile[] {
  const byId = new Map(BASE.map((a) => [a.meta.id, a]));
  for (const p of PENDING) {
    if (p.kind === 'deleted') byId.delete(p.id);
    else if (p.file) byId.set(p.id, p.file);
  }
  return [...byId.values()].sort((a, b) => a.meta.id.localeCompare(b.meta.id));
}

function viewOf(variant: MockVariant): View {
  if (variant === 'empty') return { base: [], pending: [] };
  if (variant === 'unresolved' || variant === 'files') return { base: workingTree(), pending: [] };
  return {
    base: BASE,
    pending: PENDING.map((p) => ({
      kind: p.kind,
      current: p.file,
      base: BASE.find((a) => a.meta.id === p.id) ?? null,
    })),
  };
}

function metaOf(variant: MockVariant, view: View, ws: WorkspaceInfo): MetaResponse {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  const counted = [...view.base, ...view.pending.filter((p) => p.kind === 'added').map((p) => p.current as AdrFile)];
  for (const a of counted) byStatus[a.meta.status]++;
  const gitless = variant === 'files';
  return {
    version: '0.1.0',
    workspace: ws.name,
    product: ws.product,
    adrDir: 'docs/decisions',
    mode: gitless ? 'files' : 'git',
    baseRef: variant === 'default' || variant === 'fork' || variant === 'empty' ? 'origin/main' : null,
    baseUnresolved: variant === 'unresolved',
    forkUnresolved: variant === 'fork',
    tags: TAGS,
    components: COMPONENTS,
    counts: { total: counted.length, pending: view.pending.length, byStatus },
  };
}

/** A stable stand-in for a revision: 12 hex digits derived from the ADR's id and path. */
function stampOf(a: AdrFile): { revision: string; modifiedAt: string } {
  let h = 0;
  for (const ch of `${a.meta.id}:${a.path}`) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  const revision = `${h.toString(16).padStart(8, '0')}${((h ^ 0x9e3779b9) >>> 0).toString(16).padStart(8, '0')}`.slice(
    0,
    12,
  );
  // Between one and nine days ago, so the demo shows relative times.
  return { revision, modifiedAt: new Date(Date.now() - ((h % 9) + 1) * 24 * 3600 * 1000).toISOString() };
}

function rowOf(a: AdrFile, layer: 'base' | 'pending', kind: PendingKind | null): AdrListRow {
  return {
    ...stampOf(a),
    id: a.meta.id,
    title: a.meta.title,
    status: a.meta.status,
    tags: a.meta.tags,
    components: a.meta.components,
    review_rule: a.meta.review_rule ?? null,
    layer,
    pending_kind: kind,
    path: a.path,
  };
}

function rowsOf(view: View): Array<{ row: AdrListRow; body: string }> {
  const rows = view.base.map((a) => ({ row: rowOf(a, 'base', null), body: a.body }));
  for (const p of view.pending) {
    const file = p.kind === 'deleted' ? p.base : p.current;
    if (file) rows.push({ row: rowOf(file, 'pending', p.kind), body: file.body });
  }
  // Deleted here: no revision, on the base row and on the pending row alike.
  const deleted = new Set(view.pending.filter((p) => p.kind === 'deleted').map((p) => (p.base ?? p.current)?.meta.id));
  for (const { row } of rows) if (deleted.has(row.id)) row.revision = null;
  return rows.sort(
    (x, y) =>
      x.row.id.localeCompare(y.row.id) ||
      x.row.layer.localeCompare(y.row.layer) ||
      x.row.path.localeCompare(y.row.path),
  );
}

const fold = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

function listAdrs(view: View, params: URLSearchParams): AdrListRow[] {
  const tags = params.getAll('tag');
  const components = params.getAll('component');
  const statuses = params.getAll('status');
  const pendingOnly = params.get('pending') === '1' || params.get('pending') === 'true';
  const q = (params.get('q') ?? '').trim();

  let rows = rowsOf(view).filter(
    ({ row }) =>
      tags.every((t) => row.tags.includes(t)) &&
      (components.length === 0 || components.some((c) => row.components.includes(c))) &&
      (statuses.length === 0 || statuses.includes(row.status)) &&
      (!pendingOnly || row.layer === 'pending'),
  );
  if (!q) return rows.map((r) => r.row);

  const terms = fold(q).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (terms.length === 0) return [];
  const score = ({ row, body }: { row: AdrListRow; body: string }) => {
    const title = fold(row.title);
    const rule = fold(row.review_rule ?? '');
    const text = fold(body);
    let total = 0;
    for (const t of terms) {
      const s = (title.includes(t) ? 5 : 0) + (rule.includes(t) ? 3 : 0) + (text.includes(t) ? 1 : 0);
      if (s === 0) return 0;
      total += s;
    }
    return total;
  };
  rows = rows.filter((r) => score(r) > 0).sort((a, b) => score(b) - score(a) || a.row.id.localeCompare(b.row.id));
  return rows.slice(0, 20).map((r) => r.row);
}

function getAdr(view: View, id: string): AdrResponse | null {
  const base = view.base.find((a) => a.meta.id === id) ?? null;
  const change = view.pending.find((p) => (p.current ?? p.base)?.meta.id === id);
  if (!base && !change) return null;
  const pending = change
    ? change.kind === 'deleted'
      ? { kind: change.kind }
      : { kind: change.kind, ...(change.current as AdrFile) }
    : null;
  // A decision deleted in this checkout has no revision to base a change on, as in the real API; its binding version
  // still has a time.
  const deleted = change?.kind === 'deleted';
  const working = (change && !deleted ? change.current : base) ?? null;
  const stamp = working ? stampOf(working) : { revision: null, modifiedAt: null };
  return { id, ...stamp, revision: deleted ? null : stamp.revision, base, pending };
}

function graphOf(view: View): GraphResponse {
  const nodes = view.base.map((a) => ({
    id: a.meta.id,
    title: a.meta.title,
    status: a.meta.status,
    tags: a.meta.tags,
    pending: false,
  }));
  for (const p of view.pending) {
    if (p.kind === 'added' && p.current) {
      const m = p.current.meta;
      nodes.push({ id: m.id, title: m.title, status: m.status, tags: m.tags, pending: true });
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const metas = [
    ...view.base.map((a) => a.meta),
    ...view.pending.filter((p) => p.kind === 'added').map((p) => (p.current as AdrFile).meta),
  ];
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const m of metas) {
    for (const to of m.supersedes) {
      if (ids.has(to)) edges.push({ from: m.id, to, type: 'supersedes' });
    }
    for (const to of m.related) {
      const key = [m.id, to].sort().join('|');
      if (ids.has(to) && !seen.has(key)) {
        seen.add(key);
        edges.push({ from: m.id, to, type: 'related' });
      }
    }
  }
  return { nodes, edges };
}

const globToRegExp = (glob: string) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/?/g, '::globstar::')
      .replace(/\*/g, '[^/]*')
      .replace(/::globstar::/g, '.*')}$`,
  );

const RETIRED: ReadonlySet<Status> = new Set(['rejected', 'superseded', 'deprecated']);

function forFiles(view: View, paths: string[], variant: MockVariant): ForResponse {
  const files: FileDecisions[] = paths.map((path) => {
    const file = path.replace(/\\/g, '/').replace(/^\.\//, '');
    const entry = Object.entries(COMPONENTS).find(([, c]) => c.root && file.startsWith(`${c.root}/`));
    if (!entry) return { file, component: null, decisions: [] };
    const [component, { root }] = entry;
    const relPath = file.slice((root as string).length + 1);

    const match = (a: AdrFile): Pick<Decision, 'match' | 'anchor'> | null => {
      const anchors = a.meta.code.filter((c) => c.startsWith(`${component}:`));
      const hit = anchors.find((c) => globToRegExp(c.slice(component.length + 1)).test(relPath));
      if (hit) return { match: 'anchor', anchor: hit };
      if (anchors.length === 0 && a.meta.components.includes(component)) return { match: 'component', anchor: null };
      return null;
    };
    const decision = (
      a: AdrFile,
      layer: 'base' | 'pending',
      kind: PendingKind | null,
      m: ReturnType<typeof match>,
    ) => ({
      id: a.meta.id,
      title: a.meta.title,
      status: a.meta.status,
      binding: layer === 'base' && a.meta.status === 'accepted',
      workspace: null,
      layer,
      pending_kind: kind,
      match: m?.match ?? 'component',
      anchor: m?.anchor ?? null,
      review_rule: a.meta.review_rule ?? null,
      excerpt: a.body.split(/\n\s*\n/).find((p) => p.trim() && !p.startsWith('#')) ?? '',
      exemption: null,
    });

    const decisions: Decision[] = [];
    for (const a of view.base) {
      if (RETIRED.has(a.meta.status)) continue;
      const m = match(a);
      const kind = view.pending.find((p) => p.base === a)?.kind ?? null;
      if (m) decisions.push(decision(a, 'base', kind, m));
    }
    for (const p of view.pending) {
      if (!p.current) continue;
      const m = match(p.current);
      if (m) decisions.push(decision(p.current, 'pending', p.kind, m));
    }
    if (variant === 'common') {
      decisions.push({
        id: 'ADR-0009',
        title: 'Shared rule',
        status: 'accepted',
        binding: true,
        workspace: 'shared-co',
        exemption: null,
        layer: 'base',
        pending_kind: null,
        match: 'component',
        anchor: null,
        review_rule: 'Shared rule applies.',
        excerpt: 'Accepted in the common log that this product names.',
      });
    }
    decisions.sort(
      (a, b) =>
        Number(b.binding) - Number(a.binding) ||
        Number(b.match === 'anchor') - Number(a.match === 'anchor') ||
        a.id.localeCompare(b.id) ||
        a.layer.localeCompare(b.layer) ||
        (a.workspace ?? '').localeCompare(b.workspace ?? ''),
    );
    return { file, component, decisions };
  });
  if (variant === 'unresolved') {
    return {
      files,
      notes: [
        'No default branch was found (looked for origin/HEAD, origin/main, origin/master, main, master), so ADR statuses are read as written and nothing is verified as merged. Fetch the default branch to be sure which decisions are binding.',
      ],
    };
  }
  if (variant === 'common') {
    return {
      files,
      common_notes: [
        'In the common log "shared-co": No default branch was found in it, so its statuses are read as written.',
      ],
    };
  }
  return { files };
}

function exportText(view: View, format: string): string {
  const accepted = view.base.filter((a) => a.meta.status === 'accepted');
  if (format === 'llms') {
    return [
      '# Architecture decisions',
      '',
      ...accepted.map((a) => `- ${a.meta.id}: ${a.meta.title}. ${a.meta.review_rule ?? ''}`.trim()),
    ].join('\n');
  }
  return [
    '# Decision log',
    '',
    '| ID | Title | Status |',
    '| --- | --- | --- |',
    ...view.base.map((a) => `| ${a.meta.id} | ${a.meta.title} | ${a.meta.status} |`),
  ].join('\n');
}

const json = (status: number, body: unknown): MockResponse => ({
  status,
  contentType: 'application/json; charset=utf-8',
  body: JSON.stringify(body),
});

const error = (status: number, code: string, message: string): MockResponse =>
  json(status, { error: { code, message } } satisfies ApiError);

/** The routes a named workspace serves; the flat ones need the workspace to be the only one. */
const FLAT_ROUTE = /^\/api\/(meta|adrs(\/.*)?|graph|for|check|export)$/;

/** Answers one API request. `url` may be relative (`/api/meta?x=1`, `/api/w/common/adrs`). */
export function handleApiRequest(url: string, variant: MockVariant = 'default'): MockResponse {
  const u = new URL(url, 'http://mock.local');
  const trimmed = u.pathname.replace(/\/+$/, '');

  if (trimmed === '/api/workspaces') return json(200, { workspaces: workspacesOf(variant) });

  // `/api/w/<name>/<route>` answers the route for that workspace; the flat route answers the only one.
  let name = 'adrien';
  let path = trimmed;
  if (trimmed.startsWith('/api/w/')) {
    const rest = trimmed.slice('/api/w/'.length);
    const slash = rest.indexOf('/');
    const asked = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
    path = slash < 0 ? '/api' : `/api${rest.slice(slash)}`;
    if (!workspacesOf(variant).some((w) => w.name === asked)) {
      return error(404, 'WORKSPACE_NOT_FOUND', `No workspace named ${asked}.`);
    }
    name = asked;
  } else if (FLAT_ROUTE.test(trimmed) && variant === 'workspaces') {
    return error(404, 'WORKSPACE_REQUIRED', 'Several workspaces are served: ask for /api/w/<name>/... instead.');
  }

  const ws = workspacesOf(variant).find((w) => w.name === name) ?? (workspacesOf(variant)[0] as WorkspaceInfo);
  // The second workspace of the `workspaces` variant serves its own decisions; the first reads like `default`.
  const effective: MockVariant = variant === 'workspaces' ? 'default' : variant;
  const view = name === 'common' ? commonView() : viewOf(effective);

  if (path === '/api/meta') return json(200, metaOf(effective, view, ws));
  if (path === '/api/adrs') return json(200, { results: listAdrs(view, u.searchParams) });
  if (path.startsWith('/api/adrs/')) {
    const id = decodeURIComponent(path.slice('/api/adrs/'.length));
    const found = getAdr(view, id);
    return found ? json(200, found) : error(404, 'ADR_NOT_FOUND', `No decision with id ${id}.`);
  }
  if (path === '/api/graph') return json(200, graphOf(view));
  if (path === '/api/for') {
    const paths = u.searchParams.getAll('path').filter((p) => p.trim());
    if (paths.length === 0) return error(400, 'INVALID_INPUT', 'Pass at least one path, as ?path=src/file.ts.');
    return json(200, forFiles(view, paths, effective));
  }
  if (path === '/api/check') {
    if (effective === 'empty') return json(200, { errors: 0, warnings: 0, diagnostics: [] });
    return json(200, checkReport(u.searchParams.get('lint') === '1'));
  }
  if (path === '/api/export') {
    const format = u.searchParams.get('format') ?? 'markdown';
    if (format !== 'markdown' && format !== 'llms') {
      return error(400, 'INVALID_INPUT', 'format must be markdown or llms.');
    }
    return { status: 200, contentType: 'text/plain; charset=utf-8', body: exportText(view, format) };
  }
  return error(404, 'NOT_FOUND', `No API endpoint at ${u.pathname}.`);
}

/** A `fetch` that answers `/api/*` from the fixtures, for tests. */
export function createMockFetch(variant: MockVariant = 'default'): typeof fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const r = handleApiRequest(url, variant);
    return new Response(r.body, { status: r.status, headers: { 'content-type': r.contentType } });
  };
}
