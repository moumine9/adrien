import { useEffect, useRef, useState } from 'react';
import { EMPTY_FILTERS } from './filters.ts';
import { useAdrs } from './queries.ts';
import { useSettings } from './settings.ts';

/**
 * Each decision's revision as last seen. `null` is a decision that is not in this checkout (deleted here) or whose id
 * several files share: a change to either is never reported.
 */
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
 * dismissed the notice. The first reading is the baseline, so opening the app never reports a change. While change
 * notifications are off nothing is collected, so turning them on later does not bring back old news. `version` goes up
 * with every change, even to a decision already collected, so the notice can start its timer again.
 */
export function useChangeWatch(): { changed: string[]; version: number; dismiss: () => void } {
  const { data } = useAdrs(EMPTY_FILTERS);
  const [settings] = useSettings();
  const seen = useRef<Stamps | null>(null);
  const [state, setState] = useState<{ changed: ReadonlySet<string>; version: number }>({
    changed: new Set(),
    version: 0,
  });
  const collecting = settings.changeNotifications;
  useEffect(() => {
    // Turning notifications off takes away a notice that is already showing.
    if (!collecting) setState((s) => (s.changed.size === 0 ? s : { changed: new Set(), version: s.version }));
  }, [collecting]);
  useEffect(() => {
    if (!data) return;
    const next = stampsOf(data.results);
    const before = seen.current;
    seen.current = next;
    if (!before || !collecting) return;
    const ids = changedIds(before, next);
    if (ids.length > 0) setState((s) => ({ changed: new Set([...s.changed, ...ids]), version: s.version + 1 }));
  }, [data, collecting]);
  return {
    changed: [...state.changed].sort(),
    version: state.version,
    dismiss: () => setState((s) => ({ changed: new Set(), version: s.version })),
  };
}
