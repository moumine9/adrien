import type { FileDecision, FileDecisions } from './for-files.ts';

/** The first line of every review, so a CI script can find the comment it posted before and update it. */
export const REVIEW_MARKER = '<!-- adrien-review -->';

export interface Review {
  markdown: string;
  /** Distinct binding decisions. */
  binding: number;
  /** Distinct non-binding entries: proposals, pending changes and retired decisions. */
  hints: number;
  /** The number of input files. */
  files: number;
}

const FOOTER = 'Adrien informs, it never blocks. Only accepted decisions on the default branch are binding.';
const NONE = 'No recorded decision governs the files in this change.';

const MAX_TEXT = 200;

/** The text with every control character (a newline, a tab, a bell, DEL) replaced by a space. */
const spaceControls = (text: string): string =>
  Array.from(text, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : ch;
  }).join('');

/**
 * Makes user text safe to put in a comment. It is ONE line (so an ADR author cannot start a line of the comment, such as
 * a `/merge` quick action), cut to `max` characters, with no HTML, no markdown syntax, and a zero-width space after each
 * `@` so nobody is mentioned. The text is cut before it is escaped, so an entity is never split.
 */
function escapeText(text: string, max = MAX_TEXT): string {
  const flat = spaceControls(text).replace(/\s+/g, ' ').trim();
  const cut = flat.length > max ? `${flat.slice(0, max - 1)}\u2026` : flat;
  return cut
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replace(/[\\`*_[\]]/g, '\\$&')
    .replaceAll('@', '@\u200B');
}

/** A code span for a file name: a fence one backtick longer than any run inside, padded when an edge is a backtick. */
function codeSpan(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const edge = /^`|`$/.test(text) ? ' ' : '';
  return `${fence}${edge}${text}${edge}${fence}`;
}

interface Group {
  id: string;
  title: string;
  status: FileDecision['status'];
  layer: FileDecision['layer'];
  binding: boolean;
  review_rule: string | null;
  files: string[];
}

/** One group per decision and layer: a base entry and a pending entry of the same ADR are two groups. */
function groupDecisions(files: FileDecisions[]): Group[] {
  const groups = new Map<string, Group>();
  for (const { file, decisions } of files) {
    for (const d of decisions) {
      const key = `${d.layer} ${d.id}`;
      const group = groups.get(key) ?? {
        id: d.id,
        title: d.title,
        status: d.status,
        layer: d.layer,
        binding: false,
        review_rule: d.review_rule,
        files: [],
      };
      group.binding ||= d.binding;
      if (!group.files.includes(file)) group.files.push(file);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

const byIdThenLayer = (a: Group, b: Group): number => a.id.localeCompare(b.id) || a.layer.localeCompare(b.layer);

/** The first `max` files as code spans, then how many more there are. */
function governs(files: string[], max: number): string {
  const shown = files
    .slice(0, max)
    // Inside a code span nothing is interpreted, so a file name needs no escaping, only no control characters.
    .map((file) => codeSpan(spaceControls(file)))
    .join(', ');
  const rest = files.length - max;
  return rest > 0 ? `${shown} and ${rest} more` : shown;
}

/** The lines of one decision: its heading (with `label` after the title), its rule when it has one, and its files. */
function describe(group: Group, label: string, maxFiles: number): string {
  return [
    `**${escapeText(group.id)}** ${escapeText(group.title)}${label}`,
    ...(group.review_rule === null ? [] : [`Rule: ${escapeText(group.review_rule)}`]),
    `Governs: ${governs(group.files, maxFiles)}`,
  ].join('\n');
}

/** Up to `max` decisions, then a line saying how many more there are. */
function listed(groups: Group[], label: (g: Group) => string, max: number, maxFiles: number): string[] {
  const shown = groups.slice(0, max).map((g) => describe(g, label(g), maxFiles));
  if (groups.length > max) shown.push(`and ${groups.length - max} more decisions`);
  return shown;
}

/**
 * The review comment for the decisions that govern some files. A decision is binding when any of its entries is
 * (an accepted ADR on the default branch); the rest are hints. Informs only: it never sets an exit code.
 */
export function buildReview(
  files: FileDecisions[],
  opts: { maxDecisions?: number; maxFilesPerDecision?: number; note?: string | null } = {},
): Review {
  const { maxDecisions = 20, maxFilesPerDecision = 5, note = null } = opts;
  const groups = groupDecisions(files);
  const binding = groups.filter((g) => g.binding).sort(byIdThenLayer);
  const hints = groups.filter((g) => !g.binding).sort(byIdThenLayer);

  const sections: string[] = [REVIEW_MARKER];
  // Said in the comment itself: the CLI's stderr is read by nobody in a CI job.
  if (note !== null) sections.push(`> Note: ${escapeText(note, 400)}`);
  if (groups.length === 0) {
    sections.push(NONE);
  } else {
    sections.push('### Decisions that govern this change');
    sections.push(...listed(binding, () => '', maxDecisions, maxFilesPerDecision));
    if (hints.length > 0) {
      const label = (g: Group) => ` (${g.status}${g.layer === 'pending' ? ', pending change' : ''})`;
      const inner = listed(hints, label, maxDecisions, maxFilesPerDecision).join('\n\n');
      sections.push(
        `<details><summary>Not binding (${hints.length}): proposals, pending changes and retired decisions</summary>\n\n${inner}\n\n</details>`,
      );
    }
  }
  sections.push(FOOTER);

  return {
    markdown: `${sections.join('\n\n')}\n`,
    binding: binding.length,
    hints: hints.length,
    files: files.length,
  };
}
