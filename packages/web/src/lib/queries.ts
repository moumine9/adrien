import { keepPreviousData, QueryClient, useQuery } from '@tanstack/react-query';
import { api, isClientError } from './api.ts';
import { type DecisionFilters, filtersToSearch } from './filters.ts';

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
