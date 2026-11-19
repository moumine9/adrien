import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ResolveFile } from '@/components/markdown.tsx';
import { api, isClientError } from './api.ts';
import { type DecisionFilters, EMPTY_FILTERS, filtersToSearch } from './filters.ts';
import { type RefreshSeconds, useSettings } from './settings.ts';

/** The server re-reads the log on every request, so a refetch on focus shows edits made meanwhile. */
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

export const useAdrs = (filters: DecisionFilters) =>
  useQuery({
    queryKey: ['adrs', filtersToSearch(filters).toString()],
    queryFn: ({ signal }) => api.adrs(filters, signal),
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

export const useAdr = (id: string) =>
  useQuery({
    queryKey: ['adr', id],
    queryFn: ({ signal }) => api.adr(id, signal),
    enabled: Boolean(id),
    refetchInterval: useRefreshInterval(),
    refetchIntervalInBackground: false,
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
