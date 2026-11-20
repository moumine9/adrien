import { useEffect, useRef, useState } from 'react';
import { EMPTY_FILTERS } from './filters.ts';
import { useAdrs } from './queries.ts';

/** Each decision's revision as last seen; `null` is a decision that is not in this checkout (deleted here). */
export type Stamps = ReadonlyMap<string, string | null>;

export const stampsOf = (rows: readonly { id: string; revision: string | null }[]): Stamps =>
  new Map(rows.map((row) => [row.id, row.revision]));

/** The ids whose revision differs between two readings, including those that appeared or went away, in id order. */
export function changedIds(before: Stamps, after: Stamps): string[] {
  const changed: string[] = [];
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    if (!before.has(id) || !after.has(id) || before.get(id) !== after.get(id)) changed.push(id);
  }
  return changed.sort();
}

/**
 * Watches the list this page already refreshes and collects the decisions that changed since the reader last
 * dismissed the notice. The first reading is the baseline, so opening the app never reports a change.
 */
export function useChangeWatch(): { changed: string[]; dismiss: () => void } {
  const { data } = useAdrs(EMPTY_FILTERS);
  const seen = useRef<Stamps | null>(null);
  const [changed, setChanged] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!data) return;
    const next = stampsOf(data.results);
    const before = seen.current;
    seen.current = next;
    if (!before) return;
    const ids = changedIds(before, next);
    if (ids.length > 0) setChanged((current) => new Set([...current, ...ids]));
  }, [data]);
  return { changed: [...changed].sort(), dismiss: () => setChanged(new Set()) };
}
