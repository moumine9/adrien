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

  const entry = (a: Adr) =>
    `- [${a.meta.id}: ${a.meta.title}](${link(a)})${a.meta.review_rule ? `: ${a.meta.review_rule}` : ''}`;
  const group = (title: string, status: Adr['meta']['status']) => {
    const list = adrs.filter((a) => a.meta.status === status);
    return list.length ? ['', `## ${title}`, '', ...list.map(entry)] : [];
  };
  return [
    `# ${product}`,
    '',
    `> Architecture decisions for ${product}. Before changing code, follow the rule of every accepted decision that governs it.`,
    ...group('Accepted', 'accepted'),
    ...group('Proposed (not yet binding)', 'proposed'),
    '',
  ].join('\n');
}
