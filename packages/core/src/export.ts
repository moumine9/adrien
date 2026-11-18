import { join, relative } from 'node:path';
import type { Context } from './context.ts';
import { toPosix } from './log.ts';
import type { Adr } from './model.ts';
import { type LogView, workingAdrs } from './view.ts';

export const EXPORT_FORMATS = ['markdown', 'llms'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const byId = (a: Adr, b: Adr): number => a.meta.id.localeCompare(b.meta.id, 'en', { numeric: true });
const cell = (text: string): string => text.replace(/\|/g, '\\|');

/**
 * A generated overview of the ADRs in this checkout. `markdown` is a table of all of them; `llms` follows the
 * llms.txt convention, so a model can read the accepted decisions and their rules from one file.
 * `from` is the directory of the file that will hold the export, so its links resolve from there; by default they are
 * relative to the log root.
 */
export function exportLog(ctx: Context, view: LogView, format: ExportFormat, opts: { from?: string } = {}): string {
  const adrs = [...workingAdrs(view)].sort(byId);
  const { from } = opts;
  const link = (adr: Adr) =>
    from === undefined ? adr.path : toPosix(relative(from, join(ctx.logRoot, ...adr.path.split('/'))));
  const { product } = ctx.config;

  if (format === 'markdown') {
    const rows = adrs.map(
      (a) => `| [${a.meta.id}](${link(a)}) | ${cell(a.meta.title)} | ${a.meta.status} | ${a.meta.tags.join(', ')} |`,
    );
    return [
      `# ${product}: architecture decisions`,
      '',
      '| ID | Title | Status | Tags |',
      '| --- | --- | --- | --- |',
      ...rows,
      '',
    ].join('\n');
  }

  // llms.txt tells a model what to follow, so "accepted" means binding: the default branch's version. An edit made in
  // this checkout is listed apart, as pending, until it is merged.
  const base = [...view.base].sort(byId);
  const pending = view.pending
    .filter((c): c is typeof c & { current: Adr } => c.current !== undefined)
    .sort((a, b) => byId(a.current, b.current));
  const entry = (a: Adr, kind = '') =>
    `- [${a.meta.id}: ${a.meta.title}](${link(a)})${a.meta.review_rule ? `: ${a.meta.review_rule}` : ''}${kind}`;
  const group = (title: string, lines: string[]) => (lines.length ? ['', `## ${title}`, '', ...lines] : []);
  return [
    `# ${product}`,
    '',
    `> Architecture decisions for ${product}. Before changing code, follow the rule of every accepted decision that governs it.`,
    ...group(
      'Accepted',
      base.filter((a) => a.meta.status === 'accepted').map((a) => entry(a)),
    ),
    ...group(
      'Proposed (not yet binding)',
      base.filter((a) => a.meta.status === 'proposed').map((a) => entry(a)),
    ),
    ...group(
      'Pending in this checkout (not yet binding)',
      pending.map((c) => entry(c.current, ` (${c.kind})`)),
    ),
    '',
  ].join('\n');
}
