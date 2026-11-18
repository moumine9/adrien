import picomatch from 'picomatch';
import type { Adr } from './model.ts';

/** A `component:glob` anchor: the glob is relative to the component's root. */
export interface Anchor {
  component: string;
  glob: string;
}

export function parseAnchor(s: string): Anchor | null {
  const i = s.indexOf(':');
  if (i <= 0 || i === s.length - 1) return null;
  return { component: s.slice(0, i), glob: s.slice(i + 1) };
}

const matchers = new Map<string, (path: string) => boolean>();

export function anchorMatches(anchor: Anchor, component: string, relPath: string): boolean {
  if (anchor.component !== component) return false;
  let match = matchers.get(anchor.glob);
  if (!match) {
    match = picomatch(anchor.glob, { dot: true });
    matchers.set(anchor.glob, match);
  }
  return match(relPath);
}

function section(body: string, heading: string): string | null {
  const m = new RegExp(`^##\\s+${heading}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, 'im').exec(body);
  const text = m?.[1]?.trim();
  return text || null;
}

function firstParagraph(body: string): string {
  return (
    body
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith('#')) ?? ''
  );
}

/** Why an ADR exists, in a few lines: its Rationale, else its Decision (or MADR's Decision Outcome), else its first paragraph. */
export function excerpt(adr: Pick<Adr, 'body'>, max = 600): string {
  const text =
    section(adr.body, 'Rationale') ??
    section(adr.body, 'Decision Outcome') ??
    section(adr.body, 'Decision') ??
    firstParagraph(adr.body);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
