import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Diagnostic } from './check.ts';
import type { Context } from './context.ts';
import { parseIdFormat } from './ids.ts';
import type { Adr } from './model.ts';
import { type LogView, workingAdrs } from './view.ts';

/**
 * markdownlint settings tuned for ADRs, overridable under `lint.markdownlint` in the config. They follow MADR's: "the
 * linter should support the user and not annoy them".
 */
const MARKDOWNLINT_DEFAULTS: Record<string, unknown> = {
  default: true,
  // One sentence per line is common, and a sentence with links is long.
  MD013: false,
  // MADR repeats headings (the same option under "Considered Options" and "Pros and Cons").
  MD024: false,
  // A MADR file Adrien has rewritten has `title:` in the frontmatter and a `# Title` in the body.
  MD025: { front_matter_title: '' },
  // Adrien files keep the title in the frontmatter, so the body does not start with an H1.
  MD041: false,
};

const FENCE = /^(```|~~~)[\s\S]*?^\1[^\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const COMMENT = /<!--[\s\S]*?-->/g;
/** `{short title, representative of …}`: braces around words, without the quotes or colon of JSON or `{n:4}`. */
const PLACEHOLDER = /\{(?![^{}\n]*["':])[^{}\n]*\s[^{}\n]*\}/;
const NUMBERED_HEADING = /^#{1,6}\s+\d+[.)]\s/m;

const prose = (body: string): string => body.replace(FENCE, '').replace(COMMENT, '').replace(INLINE_CODE, '');

/** The text under the Decision (or MADR's Decision Outcome) heading; null when the ADR has no such heading. */
function decisionText(body: string): string | null {
  const m = /^##\s+(?:Decision Outcome|Decision)\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body);
  if (!m) return null;
  return (m[1] as string)
    .replace(COMMENT, '')
    .replace(/^#+\s.*$/gm, '')
    .trim();
}

/**
 * The file name is the id prefix from the config (or none), a number, then lowercase dash-separated words. The words
 * may be left out, and so may their dash: `adrien new` writes `<id>-<slug>.md`, which is `ADR-0001-.md` for a title
 * with no Latin letters.
 */
function fileNameRule(adr: Adr, prefix: string): Diagnostic[] {
  const name = basename(adr.path);
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (new RegExp(`^(?:${escaped})?\\d+(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?-?\\.md$`).test(name)) return [];
  return [
    {
      severity: 'warning',
      code: 'filename-convention',
      id: adr.meta.id,
      path: adr.path,
      message: `File name ${name} should be ${prefix}NNNN-lowercase-words.md (lowercase, dash-separated)`,
    },
  ];
}

function adrienRules(adr: Adr, prefix: string): Diagnostic[] {
  const at = { id: adr.meta.id, path: adr.path };
  const out: Diagnostic[] = [...fileNameRule(adr, prefix)];
  const text = prose(adr.body);
  const placeholder = PLACEHOLDER.exec(text)?.[0];
  if (placeholder) {
    out.push({
      severity: 'warning',
      code: 'unfilled-placeholder',
      ...at,
      message: `Template placeholder left in the body: ${placeholder}`,
    });
  }
  if (adr.meta.status === 'accepted' && decisionText(adr.body) === '') {
    out.push({
      severity: 'warning',
      code: 'empty-decision',
      ...at,
      message: 'An accepted ADR has an empty Decision section',
    });
  }
  if (NUMBERED_HEADING.test(text)) {
    out.push({
      severity: 'warning',
      code: 'numbered-heading',
      ...at,
      message:
        'Headings are not numbered ("## Context", not "## 1. Context"), so sections can move without renumbering',
    });
  }
  return out;
}

/**
 * Style warnings for the ADRs in the working tree: markdownlint over each file, plus Adrien's own rules. They are
 * advice about how an ADR reads, never errors: a decision with a long line is still a decision.
 */
export async function lintAdrs(ctx: Context, view: LogView): Promise<Diagnostic[]> {
  const adrs = workingAdrs(view);
  const { prefix } = parseIdFormat(ctx.config.id_format);
  const strings = Object.fromEntries(
    adrs.map((adr) => [adr.path, readFileSync(join(ctx.logRoot, ...adr.path.split('/')), 'utf8')]),
  );
  // Loaded on demand: markdownlint pulls in a Markdown parser that commands like `list` never need.
  const { lint } = await import('markdownlint/promise');
  const results = await lint({ strings, config: { ...MARKDOWNLINT_DEFAULTS, ...ctx.config.lint?.markdownlint } });

  const out: Diagnostic[] = [];
  for (const adr of adrs) {
    for (const e of results[adr.path] ?? []) {
      const detail = e.errorDetail ? ` [${e.errorDetail}]` : '';
      out.push({
        severity: 'warning',
        code: 'markdown',
        id: adr.meta.id,
        path: adr.path,
        message: `${e.ruleNames[0]} ${e.ruleNames[1]}: ${e.ruleDescription}${detail} (line ${e.lineNumber})`,
      });
    }
    out.push(...adrienRules(adr, prefix));
  }
  return out;
}
