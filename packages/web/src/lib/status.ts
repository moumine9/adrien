import type { MetaResponse, Status } from '@adrien/api/contract';

/** Near-black text used on every status fill, in both themes. */
export const INK = '#14161c';

/** The order statuses are counted and listed in: what binds first, what never held last. */
export const STATUS_ORDER: readonly Status[] = ['accepted', 'proposed', 'superseded', 'deprecated', 'rejected'];

export interface StatusStyle {
  label: string;
  /** Flat fill used by badges, the tally bar and graph nodes. Text on it is always {@link INK}. */
  fill: string;
  /** One line that says what the status means for someone reading the code. */
  meaning: string;
}

/** One source for status colours, shared by the badges and the SVG graph so they never drift apart. */
export const STATUS_STYLES: Record<Status, StatusStyle> = {
  accepted: { label: 'Accepted', fill: '#3dd68c', meaning: 'In force once it is on the default branch.' },
  proposed: { label: 'Proposed', fill: '#ffd43a', meaning: 'Under discussion, not in force yet.' },
  superseded: { label: 'Superseded', fill: '#b9c1d0', meaning: 'Replaced by a later decision.' },
  deprecated: { label: 'Deprecated', fill: '#ff9d4a', meaning: 'No longer applies, with nothing replacing it.' },
  rejected: { label: 'Rejected', fill: '#ff6b6b', meaning: 'Considered and turned down.' },
};

const RETIRED: ReadonlySet<Status> = new Set(['superseded', 'deprecated', 'rejected']);

/** Superseded, deprecated and rejected decisions no longer (or never did) govern code. */
export function isRetired(status: Status): boolean {
  return RETIRED.has(status);
}

export type Verification = 'verified' | 'unverified';

/** Statuses are verified against a default branch only in git mode with both the base and the fork resolved. */
export function verificationOf(
  meta: Pick<MetaResponse, 'mode' | 'baseUnresolved' | 'forkUnresolved'> | undefined,
): Verification {
  if (!meta) return 'unverified';
  return meta.mode === 'git' && !meta.baseUnresolved && !meta.forkUnresolved ? 'verified' : 'unverified';
}

/**
 * - `binding`: accepted on the default branch.
 * - `unverified`: accepted as written, but no default branch backs it.
 * - `pending`: a change in this checkout, never binding until merged.
 * - `not-binding`: on the default branch but not accepted.
 */
export type Binding = 'binding' | 'unverified' | 'pending' | 'not-binding';

export function bindingOf(adr: { status: Status; layer: 'base' | 'pending' }, verification: Verification): Binding {
  if (adr.layer === 'pending') return 'pending';
  if (adr.status !== 'accepted') return 'not-binding';
  return verification === 'verified' ? 'binding' : 'unverified';
}

/** `YYYY-MM-DD` for the local calendar day (a `Date` parsed from that string would be UTC midnight). */
export function localToday(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Same rule as `adrien check`: due on or after `review_on`, unless the decision is retired. */
export function isReviewDue(adr: { review_on?: string; status: Status }, today: string = localToday()): boolean {
  return Boolean(adr.review_on) && (adr.review_on as string) <= today && !isRetired(adr.status);
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2 contrast ratio between two `#rrggbb` colours. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
