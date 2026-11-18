import { anchorMatches, excerpt, parseAnchor } from './anchors.ts';
import { type Context, componentForPath } from './context.ts';
import { toPosix } from './log.ts';
import type { Adr, Status } from './model.ts';
import type { LogView, PendingChange } from './view.ts';

export interface FileDecision {
  id: string;
  title: string;
  status: Status;
  /** Only an accepted ADR on the default branch binds; everything else is a hint. */
  binding: boolean;
  layer: 'base' | 'pending';
  pending_kind: PendingChange['kind'] | null;
  match: 'anchor' | 'component';
  anchor: string | null;
  review_rule: string | null;
  excerpt: string;
}

export interface FileDecisions {
  file: string;
  component: string | null;
  decisions: FileDecision[];
}

const RETIRED: ReadonlySet<Status> = new Set(['rejected', 'superseded', 'deprecated']);

function matchOf(adr: Adr, component: string, relPath: string): Pick<FileDecision, 'match' | 'anchor'> | null {
  const anchors = adr.meta.code
    .map((raw) => ({ raw, anchor: parseAnchor(raw) }))
    .filter((a) => a.anchor?.component === component);
  const hit = anchors.find((a) => a.anchor && anchorMatches(a.anchor, component, relPath));
  if (hit) return { match: 'anchor', anchor: hit.raw };
  if (anchors.length === 0 && adr.meta.components.includes(component)) return { match: 'component', anchor: null };
  return null;
}

function decision(
  adr: Adr,
  layer: FileDecision['layer'],
  pendingKind: FileDecision['pending_kind'],
  match: Pick<FileDecision, 'match' | 'anchor'>,
): FileDecision {
  return {
    id: adr.meta.id,
    title: adr.meta.title,
    status: adr.meta.status,
    binding: layer === 'base' && adr.meta.status === 'accepted',
    layer,
    pending_kind: pendingKind,
    ...match,
    review_rule: adr.meta.review_rule ?? null,
    excerpt: excerpt(adr),
  };
}

const order = (a: FileDecision, b: FileDecision): number =>
  Number(b.binding) - Number(a.binding) ||
  Number(b.match === 'anchor') - Number(a.match === 'anchor') ||
  a.id.localeCompare(b.id) ||
  a.layer.localeCompare(b.layer);

/** The decisions that govern each file: binding ones first, pending agent or developer edits labelled as such. */
export function adrsForFiles(ctx: Context, view: LogView, paths: string[]): FileDecisions[] {
  const changeOfBase = new Map<Adr, PendingChange['kind']>();
  for (const change of view.pending) if (change.base) changeOfBase.set(change.base, change.kind);
  const pendingCurrent = view.pending.filter((c) => c.current).map((c) => ({ adr: c.current as Adr, kind: c.kind }));

  return paths.map((path) => {
    const file = toPosix(path);
    const location = componentForPath(ctx, path);
    if (!location) return { file, component: null, decisions: [] };
    const { component, relPath } = location;
    const decisions: FileDecision[] = [];
    for (const adr of view.base) {
      if (RETIRED.has(adr.meta.status)) continue;
      const match = matchOf(adr, component, relPath);
      if (match) decisions.push(decision(adr, 'base', changeOfBase.get(adr) ?? null, match));
    }
    for (const { adr, kind } of pendingCurrent) {
      const match = matchOf(adr, component, relPath);
      if (match) decisions.push(decision(adr, 'pending', kind, match));
    }
    return { file, component, decisions: decisions.sort(order) };
  });
}

/**
 * A warning for callers that show decisions as binding: with no default branch to compare against, ADR statuses are
 * read as written, so an ADR that says `accepted` may not have been merged.
 */
export function unverifiedBaseNote(view: LogView): string | null {
  if (!view.baseUnresolved) return null;
  return 'No default branch was found (looked for origin/HEAD, origin/main, origin/master, main, master), so ADR statuses are read as written and nothing is verified as merged. Fetch the default branch to be sure which decisions are binding.';
}
