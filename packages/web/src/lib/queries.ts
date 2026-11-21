import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ResolveFile } from '@/components/markdown.tsx';
import { api, isClientError } from './api.ts';
import { type DecisionFilters, EMPTY_FILTERS, filtersToSearch } from './filters.ts';
import { type RefreshSeconds, useSettings } from './settings.ts';

/**
 * The server re-reads the log on every request, so a refetch on focus shows edits made meanwhile. The one exception is
 * the decision being read, which changes only when the reader presses Reload (see `useAdr`).
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        retry: (failures, err) => !isClientError(err) && failures < 2,
        refetchOnWindowFocus: true,
      },
    },
  });
}

/** The refresh setting as react-query's interval: `false` turns automatic checks off. */
export function refreshInterval(seconds: RefreshSeconds): number | false {
  return seconds === 0 ? false : seconds * 1000;
}

/** The interval of automatic checks, following the Settings page. */
export function useRefreshInterval(): number | false {
  const [settings] = useSettings();
  return refreshInterval(settings.refreshSeconds);
}

export const useMeta = () =>
  useQuery({
    queryKey: ['meta'],
    queryFn: ({ signal }) => api.meta(signal),
    refetchInterval: useRefreshInterval(),
    refetchIntervalInBackground: false,
  });

/** When the request behind the latest reading of each list was sent, by query key. */
const sentAt = new Map<string, number>();

/**
 * When the request that produced the list's latest reading was sent. The server reads the files when a request starts,
 * not when it answers, so this, and not the time the answer arrived, says how old the reading is.
 */
export const listSentAt = (filters: DecisionFilters): number => sentAt.get(filtersToSearch(filters).toString()) ?? 0;

export const useAdrs = (filters: DecisionFilters) =>
  useQuery({
    queryKey: ['adrs', filtersToSearch(filters).toString()],
    queryFn: async ({ signal }) => {
      const sent = Date.now();
      const result = await api.adrs(filters, signal);
      // Only the unfiltered list is ever read back, so a typed search does not add an entry.
      if (filtersToSearch(filters).toString() === '') sentAt.set('', sent);
      return result;
    },
    // Keep the previous results on screen while a new filter loads, instead of flashing skeletons.
    placeholderData: keepPreviousData,
    refetchInterval: useRefreshInterval(),
    refetchIntervalInBackground: false,
  });

/** Maps the file name of a link in an ADR body to the decision in that file, using the log's own ids and paths. */
export function useFileResolver(): ResolveFile {
  const { data } = useAdrs(EMPTY_FILTERS);
  return useMemo(() => {
    const byName = new Map<string, string>();
    for (const row of data?.results ?? []) {
      const name = row.path.slice(row.path.lastIndexOf('/') + 1);
      if (!byName.has(name)) byName.set(name, row.id);
    }
    return (fileName) => byName.get(fileName);
  }, [data]);
}

/**
 * A decision being read is fetched when it opens and again only on request, so its text never shifts while someone is
 * quoting it. The list keeps refreshing; `useChangedSinceOpened` compares against it to say the decision is out of date.
 */
export const useAdr = (id: string) =>
  useQuery({
    queryKey: ['adr', id],
    queryFn: ({ signal }) => api.adr(id, signal),
    enabled: Boolean(id),
    // Never stale and never kept once nobody looks at it: opening a decision always reads the file as it is now,
    // and nothing re-reads it behind the reader's back (a cached copy swapped for a fresh one would do just that).
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 0,
    refetchInterval: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

export const useGraph = () =>
  useQuery({
    queryKey: ['graph'],
    queryFn: ({ signal }) => api.graph(signal),
    refetchInterval: useRefreshInterval(),
    refetchIntervalInBackground: false,
  });

export const useFor = (paths: string[]) =>
  useQuery({
    queryKey: ['for', ...paths],
    queryFn: ({ signal }) => api.forFiles(paths, signal),
    enabled: paths.length > 0,
    refetchInterval: useRefreshInterval(),
    refetchIntervalInBackground: false,
  });

export const useCheck = (lint: boolean) =>
  useQuery({
    queryKey: ['check', lint],
    queryFn: ({ signal }) => api.check(lint, signal),
    refetchInterval: useRefreshInterval(),
    refetchIntervalInBackground: false,
  });
