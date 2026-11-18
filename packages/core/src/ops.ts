import { unlinkSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parseAnchor } from './anchors.ts';
import type { Context } from './context.ts';
import { type DuplicateHit, findDuplicates } from './duplicates.ts';
import { AdrienError } from './errors.ts';
import { bodyTemplate } from './frontmatter.ts';
import { formatId, nextIdNumber } from './ids.ts';
import { adrFilePath, readWorkingLog, reserveId, writeAdr } from './log.ts';
import type { Adr, AdrMeta, Origin, TemplateName } from './model.ts';
import { slugify } from './slug.ts';
import { type LogView, workingAdrs } from './view.ts';

export interface NewAdrInput {
  title: string;
  tags?: string[];
  components?: string[];
  code?: string[];
  review_rule?: string;
  review_on?: string;
  sources?: string[];
  related?: string[];
  body?: string;
  /** The skeleton to start from when no `body` is given. Default: the config's `template`. */
  template?: TemplateName;
  origin?: Origin;
  subdir?: string;
}

export type CreateResult = { written: true; adr: Adr } | { written: false; duplicates: DuplicateHit[] };

export type AdrPatch = Partial<
  Pick<AdrMeta, 'title' | 'tags' | 'components' | 'code' | 'review_rule' | 'sources' | 'related'>
> & { body?: string };

export interface OpOptions {
  today?: string;
}

const todayOf = (opts?: OpOptions) => opts?.today ?? new Date().toISOString().slice(0, 10);

export function assertWritable(ctx: Context): void {
  if (ctx.readOnly) {
    throw new AdrienError(
      'READ_ONLY_LOG',
      `The ADR log is a read-only cached clone (${ctx.logSource}). Check out the log repo and point \`log:\` in .adrien.yaml to its local path to propose changes.`,
    );
  }
}

export function validateInput(
  ctx: Context,
  input: { tags?: string[]; components?: string[]; code?: string[]; review_on?: string },
): void {
  if (input.review_on !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.review_on)) {
    throw new AdrienError('INVALID_INPUT', `review_on "${input.review_on}" must be a date like 2027-03-04`);
  }
  const known = Object.keys(ctx.config.components);
  const badTags = (input.tags ?? []).filter((t) => !ctx.config.tags.includes(t));
  if (badTags.length) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Unknown tag(s): ${badTags.join(', ')}. Allowed: ${ctx.config.tags.join(', ')}`,
    );
  }
  const badComponents = (input.components ?? []).filter((c) => !known.includes(c));
  if (badComponents.length) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Unknown component(s): ${badComponents.join(', ')}. Allowed: ${known.join(', ')}`,
    );
  }
  const badAnchors = (input.code ?? []).filter((raw) => {
    const anchor = parseAnchor(raw);
    return !anchor || !known.includes(anchor.component);
  });
  if (badAnchors.length) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Invalid anchor(s): ${badAnchors.join(', ')}. Use <component>:<glob> with a component from: ${known.join(', ')}`,
    );
  }
}

const allIds = (view: LogView) => [...view.base, ...workingAdrs(view)].map((a) => a.meta.id);

/**
 * The ADR as it is on disk now. A view was loaded asynchronously and may predate another edit, and rewriting an ADR from
 * a stale copy would silently undo that edit.
 */
function findAdr(ctx: Context, id: string): Adr {
  const matches = readWorkingLog(ctx.logRoot, ctx.config).adrs.filter((a) => a.meta.id === id);
  if (matches.length === 0) throw new AdrienError('ADR_NOT_FOUND', `No ADR ${id} in the log`);
  if (matches.length > 1) {
    throw new AdrienError(
      'INVALID_INPUT',
      `${id} is used by ${matches.map((a) => a.path).join(', ')}. Run \`adrien renumber ${id}\` first`,
    );
  }
  return matches[0] as Adr;
}

export function createAdr(
  ctx: Context,
  view: LogView,
  input: NewAdrInput,
  opts?: OpOptions & { force?: boolean },
): CreateResult {
  assertWritable(ctx);
  validateInput(ctx, input);
  // The view was loaded asynchronously and may predate another proposal: allocate from the files on disk right now.
  const live: LogView = { ...view, working: readWorkingLog(ctx.logRoot, ctx.config).adrs };
  const duplicates = findDuplicates(input.title, [...workingAdrs(live), ...live.base]);
  if (duplicates.length && !opts?.force) return { written: false, duplicates };

  let next = nextIdNumber(allIds(live), ctx.config.id_format);
  for (;;) {
    const reservation = reserveId(ctx.logRoot, next);
    try {
      // Another writer may have published and released this number since our first scan.
      const working = readWorkingLog(ctx.logRoot, ctx.config).adrs;
      const id = formatId(reservation.number, ctx.config.id_format);
      if (working.some((adr) => adr.meta.id === id)) {
        next = nextIdNumber(
          working.map((adr) => adr.meta.id),
          ctx.config.id_format,
        );
        continue;
      }
      const adr: Adr = {
        path: adrFilePath(ctx.config, id, input.title, input.subdir),
        body: input.body ?? bodyTemplate(input.template ?? ctx.config.template),
        meta: {
          id,
          title: input.title,
          status: 'proposed',
          date: todayOf(opts),
          tags: input.tags ?? [],
          components: input.components ?? [],
          code: input.code ?? [],
          review_rule: input.review_rule,
          review_on: input.review_on,
          sources: input.sources ?? [],
          supersedes: [],
          related: input.related ?? [],
          deciders: [],
          origin: input.origin ?? 'manual',
          contested: false,
          extra: {},
        },
      };
      if (adr.meta.review_rule === undefined) delete adr.meta.review_rule;
      if (adr.meta.review_on === undefined) delete adr.meta.review_on;
      writeAdr(ctx.logRoot, adr, { exclusive: true });
      return { written: true, adr };
    } finally {
      reservation.release();
    }
  }
}

const PATCH_KEYS = new Set(['title', 'tags', 'components', 'code', 'review_rule', 'sources', 'related', 'body']);

/** Edits an ADR in the working copy; the merge request that carries it is the approval gate. */
export function updateAdr(
  ctx: Context,
  _view: LogView,
  id: string,
  patch: AdrPatch,
  opts?: OpOptions & { note?: string; origin?: Origin },
): Adr {
  assertWritable(ctx);
  const forbidden = Object.keys(patch).filter((k) => !PATCH_KEYS.has(k));
  if (forbidden.length) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Cannot change ${forbidden.join(', ')} this way (status changes need an architect)`,
    );
  }
  validateInput(ctx, patch);
  const adr = findAdr(ctx, id);
  const { body, ...metaPatch } = patch;
  let nextBody = body ?? adr.body;
  if (opts?.note) {
    nextBody = `${nextBody.replace(/\n*$/, '\n')}\n> Proposed change (${opts.origin ?? 'agent'}, ${todayOf(opts)}): ${opts.note}\n`;
  }
  const updated: Adr = { ...adr, body: nextBody, meta: { ...adr.meta, ...metaPatch } };
  writeAdr(ctx.logRoot, updated);
  return updated;
}

function write(ctx: Context, adr: Adr, meta: Partial<AdrMeta>): Adr {
  const updated = { ...adr, meta: { ...adr.meta, ...meta } };
  writeAdr(ctx.logRoot, updated);
  return updated;
}

export function acceptAdr(ctx: Context, _view: LogView, id: string, opts?: OpOptions): Adr {
  assertWritable(ctx);
  const adr = findAdr(ctx, id);
  if (!adr.meta.review_rule?.trim()) {
    throw new AdrienError('INVALID_INPUT', `${id} needs a review_rule before it can be accepted`);
  }
  return write(ctx, adr, { status: 'accepted', date: adr.meta.date ?? todayOf(opts) });
}

export function setStatus(
  ctx: Context,
  _view: LogView,
  id: string,
  status: 'proposed' | 'rejected' | 'deprecated',
): Adr {
  assertWritable(ctx);
  if (!['proposed', 'rejected', 'deprecated'].includes(status)) {
    throw new AdrienError('INVALID_INPUT', `Use \`adrien accept\` or \`adrien supersede\` to set "${status}"`);
  }
  return write(ctx, findAdr(ctx, id), { status });
}

export function supersede(ctx: Context, _view: LogView, oldId: string, newId: string): { old: Adr; replacement: Adr } {
  assertWritable(ctx);
  if (oldId === newId) throw new AdrienError('INVALID_INPUT', `${oldId} cannot supersede itself`);
  const oldAdr = findAdr(ctx, oldId);
  const newAdr = findAdr(ctx, newId);
  return {
    old: write(ctx, oldAdr, { status: 'superseded', superseded_by: newId }),
    replacement: write(ctx, newAdr, { supersedes: [...new Set([...newAdr.meta.supersedes, oldId])] }),
  };
}

/** Gives a colliding ADR the next free id; references in other pending ADRs follow it, base ADRs are never touched. */
export function renumber(
  ctx: Context,
  view: LogView,
  id: string,
  opts?: { path?: string },
): { from: string; to: string; path: string } {
  assertWritable(ctx);
  const candidates = readWorkingLog(ctx.logRoot, ctx.config).adrs.filter((a) => a.meta.id === id);
  if (candidates.length === 0) throw new AdrienError('ADR_NOT_FOUND', `No ADR ${id} in the log`);
  const basePaths = new Set(view.base.filter((a) => a.meta.id === id).map((a) => a.path));
  const notInBase = candidates.filter((a) => !basePaths.has(a.path));
  const target = opts?.path
    ? candidates.find((a) => a.path === opts.path)
    : notInBase.length === 1
      ? notInBase[0]
      : undefined;
  if (!target) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Say which file to renumber with --file: ${candidates.map((a) => a.path).join(', ')}`,
    );
  }

  const to = formatId(nextIdNumber(allIds(view), ctx.config.id_format), ctx.config.id_format);
  const path = posix.join(posix.dirname(target.path), `${to}-${slugify(target.meta.title)}.md`);
  // The file may already be named for the new id (then it is rewritten in place); anywhere else it must be free, so a
  // file the view could not parse is never replaced.
  const inPlace = path === target.path;
  writeAdr(ctx.logRoot, { ...target, path, meta: { ...target.meta, id: to } }, { exclusive: !inPlace });
  if (!inPlace) unlinkSync(join(ctx.logRoot, ...target.path.split('/')));

  const swap = (ids: string[]) => ids.map((x) => (x === id ? to : x));
  for (const change of view.pending) {
    const adr = change.current;
    if (!adr || adr === target) continue;
    const { supersedes, related, superseded_by } = adr.meta;
    if (![...supersedes, ...related, superseded_by].includes(id)) continue;
    write(ctx, adr, {
      supersedes: swap(supersedes),
      related: swap(related),
      superseded_by: superseded_by === id ? to : superseded_by,
    });
  }
  return { from: id, to, path };
}
