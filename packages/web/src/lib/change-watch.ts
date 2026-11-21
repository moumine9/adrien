import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_FILTERS } from './filters.ts';
import { listSentAt, useAdrs } from './queries.ts';
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
export function useChangeWatch(): {
  changed: string[];
  version: number;
  dismiss: () => void;
  forget: (id: string) => void;
} {
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
  const dismiss = useCallback(() => setState((s) => ({ changed: new Set(), version: s.version })), []);
  const forget = useCallback(
    (id: string) =>
      setState((s) =>
        s.changed.has(id) ? { changed: new Set([...s.changed].filter((x) => x !== id)), version: s.version } : s,
      ),
    [],
  );
  return { changed: [...state.changed].sort(), version: state.version, dismiss, forget };
}

/**
 * Whether the decision on screen has changed since it was loaded, according to the list the app keeps refreshing. Only a
 * reading of the list whose request was sent at or after the decision finished loading can say so: the server reads the
 * files when a request starts, so a slower, older reading that merely arrived later predates what the reader sees.
 * A decision that has left the list counts as changed. Unlike the notice, this is a state of the page, so it does not
 * depend on the notifications setting.
 */
export function useChangedSinceOpened(id: string, shown: { revision?: string | null; loadedAt: number }): boolean {
  const { data } = useAdrs(EMPTY_FILTERS);
  if (!data || shown.revision === undefined || listSentAt(EMPTY_FILTERS) < shown.loadedAt) return false;
  const latest = data.results.find((row) => row.id === id)?.revision ?? null;
  return latest !== shown.revision;
}
