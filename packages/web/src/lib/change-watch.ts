import { useCallback, useEffect, useRef, useState } from 'react';
import { EMPTY_FILTERS } from './filters.ts';
import { listSentAt, useAdrs } from './queries.ts';
import { useSettings } from './settings.ts';
import { useWorkspace } from './workspace.ts';

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
 * Records a reading of one workspace's list and returns the ids that changed since that workspace's previous reading.
 * Each workspace has its own baseline, so reading another workspace for the first time reports nothing, and coming back
 * reports only what changed in the meantime.
 */
export function readingChanges(baselines: Map<string, Stamps>, workspace: string, next: Stamps): string[] {
  const before = baselines.get(workspace);
  baselines.set(workspace, next);
  return before ? changedIds(before, next) : [];
}

/** What the notice holds for one workspace. Kept in a Map: a workspace may be named like an object property (`constructor`). */
interface Notice {
  changed: ReadonlySet<string>;
  version: number;
}

const NO_NOTICE: Notice = { changed: new Set(), version: 0 };

/**
 * Watches the list this page already refreshes and collects the decisions that changed since the reader last
 * dismissed the notice. The first reading of each workspace is its baseline, so opening the app never reports a change.
 * While change notifications are off nothing is collected, so turning them on later does not bring back old news.
 * `version` goes up with every change, even to a decision already collected, so the notice can start its timer again.
 * The notice is kept per workspace: the decisions collected in one workspace are not shown in another.
 */
export function useChangeWatch(): {
  changed: string[];
  version: number;
  dismiss: () => void;
  forget: (id: string) => void;
} {
  const workspace = useWorkspace();
  const key = workspace ?? '';
  const { data } = useAdrs(EMPTY_FILTERS);
  const [settings] = useSettings();
  const baselines = useRef(new Map<string, Stamps>());
  const [notices, setNotices] = useState<ReadonlyMap<string, Notice>>(new Map());
  const notice = notices.get(key) ?? NO_NOTICE;
  const collecting = settings.changeNotifications;
  const update = useCallback(
    (workspaceKey: string, change: (n: Notice) => Notice) =>
      setNotices((all) => {
        const current = all.get(workspaceKey) ?? NO_NOTICE;
        const next = change(current);
        return next === current ? all : new Map(all).set(workspaceKey, next);
      }),
    [],
  );
  useEffect(() => {
    // Turning notifications off takes away a notice that is already showing, in every workspace.
    if (collecting) return;
    setNotices((all) =>
      [...all.values()].some((n) => n.changed.size > 0)
        ? new Map([...all].map(([k, n]) => [k, { changed: new Set<string>(), version: n.version }]))
        : all,
    );
  }, [collecting]);
  useEffect(() => {
    if (!data) return;
    const ids = readingChanges(baselines.current, key, stampsOf(data.results));
    if (!collecting || ids.length === 0) return;
    update(key, (s) => ({ changed: new Set([...s.changed, ...ids]), version: s.version + 1 }));
  }, [data, collecting, key, update]);
  const dismiss = useCallback(() => update(key, (s) => ({ changed: new Set(), version: s.version })), [key, update]);
  const forget = useCallback(
    (id: string) =>
      update(key, (s) =>
        s.changed.has(id) ? { changed: new Set([...s.changed].filter((x) => x !== id)), version: s.version } : s,
      ),
    [key, update],
  );
  return { changed: [...notice.changed].sort(), version: notice.version, dismiss, forget };
}

/**
 * Whether the decision on screen has changed since it was loaded, according to the list the app keeps refreshing. Only a
 * reading of the list whose request was sent at or after the decision finished loading can say so: the server reads the
 * files when a request starts, so a slower, older reading that merely arrived later predates what the reader sees.
 * A decision that has left the list counts as changed. Unlike the notice, this is a state of the page, so it does not
 * depend on the notifications setting.
 */
export function useChangedSinceOpened(id: string, shown: { revision?: string | null; loadedAt: number }): boolean {
  // Reading `dataUpdatedAt` subscribes to every successful poll, even one that returns the same content, so the send
  // time below is read again and the answer follows the newest reading.
  const workspace = useWorkspace();
  const { data, dataUpdatedAt } = useAdrs(EMPTY_FILTERS);
  if (!data || !dataUpdatedAt || shown.revision === undefined || listSentAt(EMPTY_FILTERS, workspace) < shown.loadedAt)
    return false;
  const latest = data.results.find((row) => row.id === id)?.revision ?? null;
  return latest !== shown.revision;
}
