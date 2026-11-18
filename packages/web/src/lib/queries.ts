import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import type { ResolveFile } from '@/components/markdown.tsx';
import { api, isClientError } from './api.ts';
import { type DecisionFilters, EMPTY_FILTERS, filtersToSearch } from './filters.ts';

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

export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: ({ signal }) => api.meta(signal) });

export const useAdrs = (filters: DecisionFilters) =>
  useQuery({
    queryKey: ['adrs', filtersToSearch(filters).toString()],
    queryFn: ({ signal }) => api.adrs(filters, signal),
    // Keep the previous results on screen while a new filter loads, instead of flashing skeletons.
    placeholderData: keepPreviousData,
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
  useQuery({ queryKey: ['adr', id], queryFn: ({ signal }) => api.adr(id, signal), enabled: Boolean(id) });

export const useGraph = () => useQuery({ queryKey: ['graph'], queryFn: ({ signal }) => api.graph(signal) });

export const useFor = (paths: string[]) =>
  useQuery({
    queryKey: ['for', ...paths],
    queryFn: ({ signal }) => api.forFiles(paths, signal),
    enabled: paths.length > 0,
  });

export const useCheck = (lint: boolean) =>
  useQuery({ queryKey: ['check', lint], queryFn: ({ signal }) => api.check(lint, signal) });
