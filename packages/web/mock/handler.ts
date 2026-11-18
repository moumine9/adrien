/**
 * An in-memory implementation of the local HTTP API (docs/api.md) over the fixtures. The Vite mock server and the
 * tests both use it, so the UI is developed against the same semantics the real server documents: tags must all
 * match, components and statuses match any, `pending=1` keeps pending rows, `q` ranks by relevance.
 */
import type {
  AdrFile,
  AdrResponse,
  AdrRow,
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
 * - `fork`: a shallow fork that shares no history with the default branch (`forkUnresolved`).
 * - `files`: not a git repository (`mode: 'files'`).
 * - `empty`: a log with no decisions yet.
 */
export type MockVariant = 'default' | 'unresolved' | 'fork' | 'files' | 'empty';

export const MOCK_VARIANTS: readonly MockVariant[] = ['default', 'unresolved', 'fork', 'files', 'empty'];

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

function metaOf(variant: MockVariant, view: View): MetaResponse {
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<Status, number>;
  const counted = [...view.base, ...view.pending.filter((p) => p.kind === 'added').map((p) => p.current as AdrFile)];
  for (const a of counted) byStatus[a.meta.status]++;
  const gitless = variant === 'files';
  return {
    version: '0.1.0',
    product: 'Adrien',
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

function rowOf(a: AdrFile, layer: 'base' | 'pending', kind: PendingKind | null): AdrRow {
  return {
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

function rowsOf(view: View): Array<{ row: AdrRow; body: string }> {
  const rows = view.base.map((a) => ({ row: rowOf(a, 'base', null), body: a.body }));
  for (const p of view.pending) {
    const file = p.kind === 'deleted' ? p.base : p.current;
    if (file) rows.push({ row: rowOf(file, 'pending', p.kind), body: file.body });
  }
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

function listAdrs(view: View, params: URLSearchParams): AdrRow[] {
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
  const score = ({ row, body }: { row: AdrRow; body: string }) => {
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
  return { id, base, pending };
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
      layer,
      pending_kind: kind,
      match: m?.match ?? 'component',
      anchor: m?.anchor ?? null,
      review_rule: a.meta.review_rule ?? null,
      excerpt: a.body.split(/\n\s*\n/).find((p) => p.trim() && !p.startsWith('#')) ?? '',
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
    decisions.sort(
      (a, b) =>
        Number(b.binding) - Number(a.binding) ||
        Number(b.match === 'anchor') - Number(a.match === 'anchor') ||
        a.id.localeCompare(b.id) ||
        a.layer.localeCompare(b.layer),
    );
    return { file, component, decisions };
  });
  return variant === 'unresolved'
    ? {
        files,
        notes: [
          'No default branch was found (looked for origin/HEAD, origin/main, origin/master, main, master), so ADR statuses are read as written and nothing is verified as merged. Fetch the default branch to be sure which decisions are binding.',
        ],
      }
    : { files };
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

/** Answers one API request. `url` may be relative (`/api/meta?x=1`). */
export function handleApiRequest(url: string, variant: MockVariant = 'default'): MockResponse {
  const u = new URL(url, 'http://mock.local');
  const view = viewOf(variant);
  const path = u.pathname.replace(/\/+$/, '');

  if (path === '/api/meta') return json(200, metaOf(variant, view));
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
    return json(200, forFiles(view, paths, variant));
  }
  if (path === '/api/check') {
    if (variant === 'empty') return json(200, { errors: 0, warnings: 0, diagnostics: [] });
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
