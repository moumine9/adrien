import picomatch from 'picomatch';
import { type Anchor, anchorMatches, excerpt, parseAnchor } from './anchors.ts';
import type { CommonLog } from './common.ts';
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
  /** The name of the common log the decision comes from; null for the product's own log. */
  workspace: string | null;
  layer: 'base' | 'pending';
  pending_kind: PendingChange['kind'] | null;
  /** `exception`: a product exception that exempts this file from a common decision but names none of its components. */
  match: 'anchor' | 'component' | 'exception';
  anchor: string | null;
  review_rule: string | null;
  excerpt: string;
  /**
   * For a common decision that an accepted exception of this product exempts for this file: the exception's id. The
   * decision stays listed, with `binding` false. Null otherwise, and always null for the product's own decisions.
   */
  exemption: { by: string } | null;
}

/** An accepted decision anchored elsewhere in the file's component (ADR-0036). It does not govern the file. */
export interface NearbyDecision {
  id: string;
  title: string;
  /** The name of the common log the decision comes from; null for the product's own log. */
  workspace: string | null;
  /** The decision's anchors in the file's component; none of them matches the file. */
  anchors: string[];
}

export interface FileDecisions {
  file: string;
  component: string | null;
  decisions: FileDecision[];
  /** Closest folders first, at most `NEARBY_MAX`; empty for a file outside every component. */
  nearby: NearbyDecision[];
  /** How many nearby decisions were left out past `NEARBY_MAX`. */
  nearby_omitted: number;
}

export const NEARBY_MAX = 10;

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

/** The anchors of `adr` in `component` when it has some and none matches the file; empty otherwise. */
function anchorsElsewhere(adr: Adr, component: string, relPath: string): string[] {
  const own = adr.meta.code.filter((raw) => parseAnchor(raw)?.component === component);
  return own.some((raw) => anchorMatches(parseAnchor(raw) as Anchor, component, relPath)) ? [] : own;
}

/** How many leading folders of the file the fixed part of the closest anchor shares. */
function closeness(anchors: string[], relPath: string): number {
  const folders = relPath.split('/').slice(0, -1);
  return Math.max(
    ...anchors.map((raw) => {
      const base = picomatch.scan((parseAnchor(raw) as Anchor).glob).base.split('/');
      let shared = 0;
      while (shared < folders.length && folders[shared] === base[shared]) shared++;
      return shared;
    }),
  );
}

/**
 * The accepted own exceptions that name `target` and cover this file, in the order they are written. An exception with
 * no code anchors covers every file of the product; one with anchors covers only the files they match.
 */
function exceptionsFor(exceptions: Adr[], target: string, component: string, relPath: string): Adr[] {
  return exceptions.filter(
    (exception) =>
      exception.meta.exception_to.includes(target) &&
      (exception.meta.code.length === 0 || matchOf(exception, component, relPath)?.match === 'anchor'),
  );
}

function decision(
  adr: Adr,
  layer: FileDecision['layer'],
  pendingKind: FileDecision['pending_kind'],
  match: Pick<FileDecision, 'match' | 'anchor'>,
  workspace: string | null,
  exemption: FileDecision['exemption'] = null,
): FileDecision {
  return {
    id: adr.meta.id,
    title: adr.meta.title,
    status: adr.meta.status,
    binding: layer === 'base' && adr.meta.status === 'accepted' && exemption === null,
    workspace,
    layer,
    pending_kind: pendingKind,
    ...match,
    review_rule: adr.meta.review_rule ?? null,
    excerpt: excerpt(adr),
    exemption,
  };
}

const order = (a: FileDecision, b: FileDecision): number =>
  Number(b.binding) - Number(a.binding) ||
  Number(b.match === 'anchor') - Number(a.match === 'anchor') ||
  a.id.localeCompare(b.id) ||
  a.layer.localeCompare(b.layer) ||
  // Last, so that only a tie under the rules above puts the product's own decisions before a common log's.
  Number(a.workspace !== null) - Number(b.workspace !== null);

/**
 * The decisions that govern each file: binding ones first, pending agent or developer edits labelled as such. With a
 * common log, its accepted decisions bind the files too, matched against the product's own components.
 */
export function adrsForFiles(
  ctx: Context,
  view: LogView,
  paths: string[],
  common: CommonLog | null = null,
): FileDecisions[] {
  const changeOfBase = new Map<Adr, PendingChange['kind']>();
  for (const change of view.pending) if (change.base) changeOfBase.set(change.base, change.kind);
  const pendingCurrent = view.pending.filter((c) => c.current).map((c) => ({ adr: c.current as Adr, kind: c.kind }));
  const commonAccepted = common ? common.view.base.filter((adr) => adr.meta.status === 'accepted') : [];
  // Only accepted decisions on the default branch exempt anything: a proposed, pending or retired exception does not.
  const exceptions = view.base.filter((adr) => adr.meta.status === 'accepted' && adr.meta.exception_to.length > 0);

  return paths.map((path) => {
    const file = toPosix(path);
    const location = componentForPath(ctx, path);
    if (!location) return { file, component: null, decisions: [], nearby: [], nearby_omitted: 0 };
    const { component, relPath } = location;
    const decisions: FileDecision[] = [];
    for (const adr of view.base) {
      if (RETIRED.has(adr.meta.status)) continue;
      const match = matchOf(adr, component, relPath);
      if (match) decisions.push(decision(adr, 'base', changeOfBase.get(adr) ?? null, match, null));
    }
    for (const { adr, kind } of pendingCurrent) {
      const match = matchOf(adr, component, relPath);
      if (match) decisions.push(decision(adr, 'pending', kind, match, null));
    }
    for (const adr of commonAccepted) {
      const match = matchOf(adr, component, relPath);
      if (!match || !common) continue;
      const covering = exceptionsFor(exceptions, `${common.name}/${adr.meta.id}`, component, relPath);
      const [first] = covering;
      decisions.push(decision(adr, 'base', null, match, common.name, first ? { by: first.meta.id } : null));
      // Each exception holds a rule that replaces the common one, so it is listed even when it names no component of
      // this file: it was found because it covers the whole workspace. The exemption names the first one.
      for (const exception of covering) {
        if (decisions.some((d) => d.workspace === null && d.layer === 'base' && d.id === exception.meta.id)) continue;
        decisions.push(
          decision(exception, 'base', changeOfBase.get(exception) ?? null, { match: 'exception', anchor: null }, null),
        );
      }
    }
    const listed = (id: string, workspace: string | null) =>
      decisions.some((d) => d.id === id && d.workspace === workspace);
    const near: (NearbyDecision & { closeness: number })[] = [];
    const consider = (adr: Adr, workspace: string | null) => {
      const anchors = anchorsElsewhere(adr, component, relPath);
      if (anchors.length === 0 || listed(adr.meta.id, workspace)) return;
      near.push({ id: adr.meta.id, title: adr.meta.title, workspace, anchors, closeness: closeness(anchors, relPath) });
    };
    for (const adr of view.base) if (adr.meta.status === 'accepted') consider(adr, null);
    for (const adr of commonAccepted) {
      // A common decision exempted for this file does not apply to it, wherever it is anchored (ADR-0035).
      const name = (common as CommonLog).name;
      if (exceptionsFor(exceptions, `${name}/${adr.meta.id}`, component, relPath).length === 0) consider(adr, name);
    }
    near.sort(
      (a, b) =>
        b.closeness - a.closeness ||
        a.id.localeCompare(b.id) ||
        Number(a.workspace !== null) - Number(b.workspace !== null),
    );
    const nearby = near.slice(0, NEARBY_MAX).map(({ closeness: _, ...entry }) => entry);
    return {
      file,
      component,
      decisions: decisions.sort(order),
      nearby,
      nearby_omitted: near.length - nearby.length,
    };
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
