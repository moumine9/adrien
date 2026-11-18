import { join } from 'node:path';
import { anchorMatches, parseAnchor } from './anchors.ts';
import { type Context, componentRoot, workspacePaths } from './context.ts';
import { gitToplevel, listFiles } from './git.ts';
import type { Adr, Status } from './model.ts';
import { type LogView, mergedAdrs } from './view.ts';

export type Severity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'parse-error'
  | 'unknown-tag'
  | 'unknown-component'
  | 'invalid-anchor'
  | 'duplicate-id'
  | 'broken-link'
  | 'supersede-asymmetry'
  | 'missing-review-rule'
  | 'stale-anchor'
  | 'anchors-not-verified'
  | 'pending-proposed'
  | 'base-unresolved';

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
}

function checkLinks(adrs: Adr[], out: Diagnostic[]): void {
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
    const links = [
      ...adr.meta.supersedes,
      ...adr.meta.related,
      ...(adr.meta.superseded_by ? [adr.meta.superseded_by] : []),
    ];
    for (const target of links) {
      if (!byId.has(target)) {
        out.push({ severity: 'error', code: 'broken-link', ...at(adr), message: `Links to unknown ADR ${target}` });
      }
    }
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
    for (const c of ctx.codeRepo?.components ?? []) add(c, ctx.codeRepo?.root ?? '');
    return roots;
  }
  const logTop = (await gitToplevel(ctx.logRoot)) ?? ctx.logRoot;
  for (const [c, def] of Object.entries(ctx.config.components)) if (def.repo === '.') add(c, logTop);
  for (const [c, path] of Object.entries(workspacePaths(ctx.env))) if (c in ctx.config.components) add(c, path);
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
  if (unverified.length && !here) {
    out.push({
      severity: 'info',
      code: 'anchors-not-verified',
      message: `Anchors not verified for ${unverified.join(', ')}: no local checkout (set ADRIEN_REPOS, or run \`adrien check --here\` in each code repo's CI)`,
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
  if (opts.mr && view.baseUnresolved) {
    out.push({
      severity: 'error',
      code: 'base-unresolved',
      message:
        'No default branch found (looked for origin/HEAD, origin/main, origin/master, main, master), so pending ADRs cannot be told from merged ones. Fetch it first, e.g. `git fetch origin <default-branch>`.',
    });
  }
  const adrs = mergedAdrs(view);
  for (const adr of adrs) checkFields(ctx, adr, out);
  checkLinks(adrs, out);
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
  return out;
}

export function exitCodeFor(diags: Diagnostic[], strict = false): 0 | 1 {
  return diags.some((d) => d.severity === 'error' || (strict && d.severity === 'warning')) ? 1 : 0;
}
