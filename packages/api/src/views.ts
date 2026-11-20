import {
  type Adr,
  AdrienError,
  type Context,
  type LogView,
  mergedAdrs,
  STATUSES,
  type Status,
  workingRevision,
} from '@adrien/core';
import type { AdrFile, AdrResponse, GraphEdge, GraphNode, GraphResponse, MetaResponse } from './contract.ts';

/**
 * What the default branch would hold once this checkout is merged, one ADR per id: when ids collide (which `check`
 * reports), the first by path stands for the id, so the graph never has two nodes with one id.
 */
function mergedById(view: LogView): Adr[] {
  const seen = new Set<string>();
  const adrs: Adr[] = [];
  for (const adr of mergedAdrs(view)) {
    if (seen.has(adr.meta.id)) continue;
    seen.add(adr.meta.id);
    adrs.push(adr);
  }
  return adrs;
}

export function metaOf(ctx: Context, view: LogView, version: string): MetaResponse {
  const adrs = mergedById(view);
  const byStatus = Object.fromEntries(STATUSES.map((status) => [status, 0])) as Record<Status, number>;
  for (const adr of adrs) byStatus[adr.meta.status]++;
  return {
    version,
    product: ctx.config.product,
    adrDir: ctx.config.adr_dir,
    mode: view.mode,
    baseRef: view.baseRef,
    baseUnresolved: view.baseUnresolved === true,
    forkUnresolved: view.forkUnresolved === true,
    tags: ctx.config.tags,
    components: ctx.config.components,
    counts: { total: adrs.length, pending: view.pending.length, byStatus },
  };
}

const fileOf = (adr: Adr): AdrFile => ({ meta: adr.meta, body: adr.body, path: adr.path });

export function adrOf(view: LogView, id: string, modifiedAt: string | null = null): AdrResponse {
  const base = view.base.find((a) => a.meta.id === id);
  const change = view.pending.find((c) => c.id === id);
  if (!base && !change) throw new AdrienError('ADR_NOT_FOUND', `No ADR ${id} in the log`);
  return {
    id,
    revision: workingRevision(view, id),
    modifiedAt,
    base: base ? fileOf(base) : null,
    pending: change ? { kind: change.kind, ...(change.current ? fileOf(change.current) : {}) } : null,
  };
}

export function graphOf(view: LogView): GraphResponse {
  const adrs = mergedById(view);
  const pending = new Set(view.pending.filter((c) => c.kind !== 'deleted').map((c) => c.id));
  const nodes: GraphNode[] = adrs.map(({ meta }) => ({
    id: meta.id,
    title: meta.title,
    status: meta.status,
    tags: meta.tags,
    pending: pending.has(meta.id),
  }));

  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const edges: GraphEdge[] = [];
  const add = (from: string, to: string, type: GraphEdge['type']) => {
    // A related link has no direction: A to B and B to A are one link.
    const key = [type, ...(type === 'related' ? [from, to].sort() : [from, to])].join('\0');
    if (from === to || !ids.has(from) || !ids.has(to) || seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, type });
  };
  for (const { meta } of adrs) {
    // `supersedes` and `superseded_by` are the two sides of one supersession: always drawn from the newer ADR.
    for (const older of meta.supersedes) add(meta.id, older, 'supersedes');
    if (meta.superseded_by) add(meta.superseded_by, meta.id, 'supersedes');
    for (const other of meta.related) add(meta.id, other, 'related');
  }
  return { nodes, edges };
}
