export type Gap = 'deciders' | 'confirmation';

/**
 * What an accepted decision leaves out: nobody is named as having decided it, or its `### Confirmation` heading has no
 * text under it. Only a hint for the reader (never a check): a template without that heading is not at fault.
 */
export function recordGaps(
  meta: { status: string; deciders: readonly string[]; extra?: Record<string, unknown> },
  body: string,
): Gap[] {
  if (meta.status !== 'accepted') return [];
  const gaps: Gap[] = [];
  if (meta.deciders.length === 0 && !namesMadrDecisionMakers(meta.extra)) gaps.push('deciders');
  if (confirmationIsEmpty(body)) gaps.push('confirmation');
  return gaps;
}

/** MADR 4 calls them `decision-makers`; the core keeps that field as it was written, a list or a line of names. */
function namesMadrDecisionMakers(extra: Record<string, unknown> = {}): boolean {
  const value = extra['decision-makers'];
  return Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '';
}

/** A `Confirmation` heading whose section holds nothing: the next heading of the same or a higher level, or the end, comes first. */
function confirmationIsEmpty(body: string): boolean {
  const lines = body.split('\n');
  const at = lines.findIndex((line) => /^#{1,6}[ \t]+Confirmation[ \t]*$/i.test(line));
  if (at < 0) return false;
  const level = (lines[at] ?? '').search(/[ \t]/);
  for (const line of lines.slice(at + 1)) {
    if (line.trim() === '') continue;
    const heading = /^(#{1,6})[ \t]/.exec(line);
    return heading !== null && (heading[1]?.length ?? 0) <= level;
  }
  return true;
}
