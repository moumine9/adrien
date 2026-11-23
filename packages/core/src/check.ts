import { join } from 'node:path';
import { anchorMatches, parseAnchor } from './anchors.ts';
import { readCommon } from './common.ts';
import { workspaceNameOf } from './config.ts';
import { type Context, checkoutPaths, componentRoot } from './context.ts';
import { gitToplevel, listFiles } from './git.ts';
import { lintAdrs } from './lint.ts';
import type { Adr, Status } from './model.ts';
import { parseRef } from './ref.ts';
import { type LogView, mergedAdrs } from './view.ts';

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'parse-error'
  | 'unknown-tag'
  | 'unknown-component'
  | 'invalid-anchor'
  | 'duplicate-id'
  | 'broken-link'
  | 'invalid-ref'
  | 'unresolved-ref'
  | 'common-unreadable'
  | 'common-invalid'
  | 'supersede-asymmetry'
  | 'superseded-without-successor'
  | 'missing-review-rule'
  | 'stale-anchor'
  | 'anchors-not-verified'
  | 'pending-proposed'
  | 'base-unresolved'
  | 'fork-unresolved'
  | 'markdown'
  | 'unfilled-placeholder'
  | 'empty-decision'
  | 'numbered-heading'
  | 'review-due'
  | 'exception-without-review'
  | 'filename-convention';

export interface Diagnostic {
  severity: Severity;
  code: DiagnosticCode;
  message: string;
  id?: string;
  path?: string;
}

export interface CheckOptions {
  /** Verify anchors only against the code repo the command runs in (code-repo CI). */
  here?: boolean;
  /** Merge-request mode: warn about pending ADRs that would merge as mere hints. */
  mr?: boolean;
  strict?: boolean;
  /** Also report style warnings (markdownlint and Adrien's own rules), as `adrien lint` does. */
  lint?: boolean;
  /** `YYYY-MM-DD`, for `review_on`. Default: today. */
  today?: string;
}

const RETIRED: ReadonlySet<Status> = new Set(['rejected', 'superseded', 'deprecated']);

const at = (adr: Adr) => ({ id: adr.meta.id, path: adr.path });

function checkFields(ctx: Context, adr: Adr, out: Diagnostic[]): void {
  const unknownTags = adr.meta.tags.filter((t) => !ctx.config.tags.includes(t));
  if (unknownTags.length) {
    out.push({
      severity: 'error',
      code: 'unknown-tag',
      ...at(adr),
      message: `Unknown tag(s): ${unknownTags.join(', ')}. Allowed: ${ctx.config.tags.join(', ')}`,
    });
  }
  const known = Object.keys(ctx.config.components);
  const unknownComponents = adr.meta.components.filter((c) => !known.includes(c));
  if (unknownComponents.length) {
    out.push({
      severity: 'error',
      code: 'unknown-component',
      ...at(adr),
      message: `Unknown component(s): ${unknownComponents.join(', ')}. Allowed: ${known.join(', ')}`,
    });
  }
  for (const raw of adr.meta.code) {
    const anchor = parseAnchor(raw);
    if (!anchor || !known.includes(anchor.component)) {
      out.push({
        severity: 'error',
        code: 'invalid-anchor',
        ...at(adr),
        message: `Anchor "${raw}" must be <component>:<glob> with a component from the config`,
      });
    }
  }
  if (adr.meta.status === 'accepted' && !adr.meta.review_rule?.trim()) {
    out.push({
      severity: 'error',
      code: 'missing-review-rule',
      ...at(adr),
      message: 'An accepted ADR needs a review_rule: the one checkable sentence agents and reviewers apply',
    });
  }
  if (adr.meta.exception_to.length > 0 && !adr.meta.review_on) {
    out.push({
      severity: 'warning',
      code: 'exception-without-review',
      ...at(adr),
      message: `${adr.meta.id} is an exception to a common decision, so it needs a review date: set review_on, when the exception is due to be looked at again`,
    });
  }
}

/** What a `related` reference can resolve against: this log's name, and the decisions of the common log, if it is readable. */
interface RefScope {
  own: string | null;
  common: { name: string; ids: Set<string> } | null;
}

/** Resolves a `workspace/ADR-n` entry against the common log: a broken link when it is reachable and lacks the id, else information. */
function workspaceLink(
  adr: Adr,
  target: string,
  workspace: string,
  id: string,
  scope: RefScope,
  out: Diagnostic[],
): void {
  if (scope.common?.name === workspace) {
    if (!scope.common.ids.has(id)) {
      out.push({ severity: 'error', code: 'broken-link', ...at(adr), message: `Links to unknown ADR ${target}` });
    }
    return;
  }
  out.push({
    severity: 'info',
    code: 'unresolved-ref',
    ...at(adr),
    message: `${target} names the log "${workspace}", which is not reachable from this one, so the reference was not checked`,
  });
}

/** Checks one `related` entry: a plain id or this log's own `workspace/ADR-n` against this log, the common log's `workspace/ADR-n` against the common log. */
function relatedLink(adr: Adr, target: string, byId: Map<string, Adr[]>, scope: RefScope, out: Diagnostic[]): void {
  // An id of this log wins, even when its own format puts a slash in it.
  if (byId.has(target)) return;
  const ref = parseRef(target);
  if (ref.workspace === null) {
    if (target.includes('/')) {
      out.push({
        severity: 'error',
        code: 'invalid-ref',
        ...at(adr),
        message: `${target} is not a reference: write a decision of this log as ADR-n, or of another log as workspace/ADR-n`,
      });
    } else {
      out.push({ severity: 'error', code: 'broken-link', ...at(adr), message: `Links to unknown ADR ${target}` });
    }
    return;
  }
  if (ref.workspace === scope.own) {
    if (!byId.has(ref.id))
      out.push({ severity: 'error', code: 'broken-link', ...at(adr), message: `Links to unknown ADR ${target}` });
    return;
  }
  workspaceLink(adr, target, ref.workspace, ref.id, scope, out);
}

/** Checks one `exception_to` entry: an exception departs from a decision of a common log, so only `workspace/ADR-n` of another log is valid. */
function exceptionLink(adr: Adr, target: string, scope: RefScope, out: Diagnostic[]): void {
  const ref = parseRef(target);
  if (ref.workspace === null || ref.workspace === scope.own) {
    out.push({
      severity: 'error',
      code: 'invalid-ref',
      ...at(adr),
      message: `${target} is not a common reference: exception_to names decisions of a common log, written workspace/ADR-n`,
    });
    return;
  }
  workspaceLink(adr, target, ref.workspace, ref.id, scope, out);
}

function checkLinks(adrs: Adr[], out: Diagnostic[], scope: RefScope): void {
  const byId = new Map<string, Adr[]>();
  for (const adr of adrs) byId.set(adr.meta.id, [...(byId.get(adr.meta.id) ?? []), adr]);

  for (const [id, same] of byId) {
    if (same.length > 1) {
      out.push({
        severity: 'error',
        code: 'duplicate-id',
        id,
        message: `${id} is used by ${same.map((a) => a.path).join(', ')}. Run \`adrien renumber ${id}\``,
      });
    }
  }
  for (const adr of adrs) {
    // Supersession stays inside one log: a `/` there is never resolved, so it is not a link to check either.
    const within: Array<[string, string]> = [
      ...adr.meta.supersedes.map((t): [string, string] => ['supersedes', t]),
      ...(adr.meta.superseded_by ? [['superseded_by', adr.meta.superseded_by] as [string, string]] : []),
    ];
    for (const [field, target] of within) {
      if (target.includes('/')) {
        out.push({
          severity: 'error',
          code: 'invalid-ref',
          ...at(adr),
          message: `${field} names ${target}, but supersession stays within one log: write the id of a decision in this log`,
        });
      } else if (!byId.has(target)) {
        out.push({ severity: 'error', code: 'broken-link', ...at(adr), message: `Links to unknown ADR ${target}` });
      }
    }
    for (const target of adr.meta.related) relatedLink(adr, target, byId, scope, out);
    for (const target of adr.meta.exception_to) exceptionLink(adr, target, scope, out);
    for (const oldId of adr.meta.supersedes) {
      const old = byId.get(oldId)?.[0];
      if (old && (old.meta.status !== 'superseded' || old.meta.superseded_by !== adr.meta.id)) {
        out.push({
          severity: 'error',
          code: 'supersede-asymmetry',
          ...at(adr),
          message: `${adr.meta.id} supersedes ${oldId}, but ${oldId} is not "superseded" with superseded_by: ${adr.meta.id}`,
        });
      }
    }
    // When another ADR lists this one in `supersedes`, `supersede-asymmetry` already reports the missing field.
    const listed = adrs.some((other) => other.meta.supersedes.includes(adr.meta.id));
    if (adr.meta.status === 'superseded' && !adr.meta.superseded_by && !listed) {
      out.push({
        severity: 'warning',
        code: 'superseded-without-successor',
        ...at(adr),
        message: `${adr.meta.id} is superseded but names no superseded_by: set the ADR that replaces it`,
      });
    }
    const newId = adr.meta.superseded_by;
    const replacement = newId ? byId.get(newId)?.[0] : undefined;
    if (replacement && !replacement.meta.supersedes.includes(adr.meta.id)) {
      out.push({
        severity: 'error',
        code: 'supersede-asymmetry',
        ...at(adr),
        message: `${adr.meta.id} is superseded_by ${newId}, but ${newId} does not list it in supersedes`,
      });
    }
  }
}

/** Component → absolute checkout of its root, for every component whose code is available locally. */
async function checkouts(ctx: Context, here: boolean): Promise<Map<string, string>> {
  const roots = new Map<string, string>();
  const add = (component: string, repoRoot: string) =>
    roots.set(component, join(repoRoot, componentRoot(ctx.config, component)));
  if (here) {
    if (ctx.codeRepo) for (const c of ctx.codeRepo.components) add(c, ctx.codeRepo.root);
    return roots;
  }
  const logTop = (await gitToplevel(ctx.logRoot)) ?? ctx.logRoot;
  for (const [c, def] of Object.entries(ctx.config.components)) if (def.repo === '.') add(c, logTop);
  for (const [c, path] of Object.entries(checkoutPaths(ctx.env))) if (c in ctx.config.components) add(c, path);
  return roots;
}

async function checkAnchors(ctx: Context, adrs: Adr[], here: boolean, out: Diagnostic[]): Promise<void> {
  const anchored = new Map<string, Array<{ adr: Adr; raw: string; glob: string }>>();
  for (const adr of adrs) {
    if (RETIRED.has(adr.meta.status)) continue;
    for (const raw of adr.meta.code) {
      const anchor = parseAnchor(raw);
      if (!anchor || !(anchor.component in ctx.config.components)) continue;
      anchored.set(anchor.component, [...(anchored.get(anchor.component) ?? []), { adr, raw, glob: anchor.glob }]);
    }
  }
  const roots = await checkouts(ctx, here);
  const unverified: string[] = [];
  for (const [component, uses] of anchored) {
    const root = roots.get(component);
    if (!root) {
      unverified.push(component);
      continue;
    }
    const files = await listFiles(root);
    for (const { adr, raw, glob } of uses) {
      if (!files.some((f) => anchorMatches({ component, glob }, component, f))) {
        out.push({
          severity: 'warning',
          code: 'stale-anchor',
          ...at(adr),
          message: `Anchor "${raw}" matches no file in ${root}`,
        });
      }
    }
  }
  if (unverified.length && (!here || !roots.size)) {
    out.push({
      severity: 'info',
      code: 'anchors-not-verified',
      message: here
        ? `Anchors not verified for ${unverified.join(', ')}: this checkout matches no configured component.`
        : `Anchors not verified for ${unverified.join(', ')}: no local checkout (set ADRIEN_REPOS, or run \`adrien check --here\` in each code repo's CI)`,
    });
  }
}

export async function runCheck(ctx: Context, view: LogView, opts: CheckOptions = {}): Promise<Diagnostic[]> {
  const out: Diagnostic[] = view.problems.map((p) => ({
    severity: 'error',
    code: 'parse-error',
    path: p.path,
    message: p.message,
  }));
  if (opts.mr && !view.baseRef) {
    out.push({
      severity: opts.strict ? 'error' : 'warning',
      code: 'base-unresolved',
      message: view.baseFetchFailed
        ? 'Could not fetch the default branch from origin. Pending ADRs could not be verified.'
        : 'No default branch found (looked for origin/HEAD, origin/main, origin/master, main, master), so pending ADRs cannot be told from merged ones. Fetch it first, e.g. `git fetch origin <default-branch>`.',
    });
  }
  if (opts.mr && view.forkUnresolved) {
    out.push({
      severity: 'error',
      code: 'fork-unresolved',
      message: `This checkout shares no history with ${view.baseRef} (a shallow clone?), so what the merge request changed cannot be told from what landed upstream. Fetch more history first, e.g. \`git fetch --unshallow\`.`,
    });
  }
  const adrs = mergedAdrs(view);
  // The common log is read once per run; its decisions resolve `workspace/ADR-n` references in `related`.
  const common = await readCommon(ctx);
  if (common && 'unreadable' in common) {
    // Unreachable (a path outside this repo that a CI checkout lacks) is information; a log that was read but cannot
    // serve as the common one would silently drop every common decision, so it is an error.
    const invalid = common.unreadable.kind === 'invalid';
    out.push({
      severity: invalid ? 'error' : 'info',
      code: invalid ? 'common-invalid' : 'common-unreadable',
      message: invalid
        ? `The common log named by the \`common\` field (${common.unreadable.location}) cannot serve as one: ${common.unreadable.message}`
        : `The common log named by the \`common\` field (${common.unreadable.location}) cannot be read, so references to it were not checked: ${common.unreadable.message}`,
    });
  }
  const readable = common && 'common' in common ? common.common : null;
  const scope: RefScope = {
    own: workspaceNameOf(ctx.config),
    common: readable ? { name: readable.name, ids: new Set(mergedAdrs(readable.view).map((a) => a.meta.id)) } : null,
  };
  for (const adr of adrs) checkFields(ctx, adr, out);
  checkLinks(adrs, out, scope);
  await checkAnchors(ctx, adrs, opts.here ?? false, out);
  if (opts.mr) {
    for (const change of view.pending) {
      if (change.current && change.current.meta.status === 'proposed') {
        out.push({
          severity: 'warning',
          code: 'pending-proposed',
          ...at(change.current),
          message: `${change.id} is still "proposed": merging it adds only a hint. Run \`adrien accept ${change.id}\` to approve it`,
        });
      }
    }
  }
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  for (const adr of adrs) {
    const due = adr.meta.review_on;
    if (due && due <= today && !RETIRED.has(adr.meta.status)) {
      out.push({
        severity: 'warning',
        code: 'review-due',
        ...at(adr),
        message: `${adr.meta.id} was due for review on ${due}: confirm it still holds, or supersede it`,
      });
    }
  }
  if (opts.lint) out.push(...(await lintAdrs(ctx, view)));
  return out;
}

export function exitCodeFor(diags: Diagnostic[], strict = false): 0 | 1 {
  return diags.some((d) => d.severity === 'error' || (strict && d.severity === 'warning')) ? 1 : 0;
}
