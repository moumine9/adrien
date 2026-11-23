import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router';
import { type Moved, movingFetch } from '@/test/moving-fetch.ts';
import { createMockFetch } from '../../mock/handler.ts';
import { useChangeWatch } from './change-watch.ts';
import { updateSettings } from './settings.ts';

beforeEach(() => {
  localStorage.clear();
  updateSettings({ changeNotifications: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Renders the change watch at `/w/adrien`, with the navigate function beside it, so a test can switch workspaces. */
function renderWatch(patch: { current: Record<string, Moved> }) {
  const adrien = movingFetch(() => patch.current);
  const common = createMockFetch('workspaces');
  vi.stubGlobal('fetch', ((input: RequestInfo | URL, init?: RequestInit) =>
    new URL(String(input), 'http://localhost').pathname.startsWith('/api/w/common')
      ? common(input, init)
      : adrien(input, init)) as typeof fetch);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const { result } = renderHook(() => ({ watch: useChangeWatch(), navigate: useNavigate() }), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/w/adrien']}>
          <Routes>
            <Route path="/w/:workspace" element={children} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    ),
  });
  return { client, result };
}

async function pollLists(client: QueryClient) {
  await act(async () => {
    await client.refetchQueries({ queryKey: ['adrs'] });
  });
}

describe('change notifications across workspaces', () => {
  it('reports a change in one workspace once, reports nothing in another, and does not report it again on return', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client, result } = renderWatch(patch);
    await waitFor(() => expect(client.getQueryData(['adrs', 'adrien', ''])).toBeDefined());
    expect(result.current.watch.changed).toEqual([]);

    // A change in adrien is reported, once.
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await pollLists(client);
    await waitFor(() => expect(result.current.watch.changed).toEqual(['ADR-0002']));
    const reported = result.current.watch.version;
    await pollLists(client);
    expect(result.current.watch.version).toBe(reported);

    // Common is read for the first time: its first reading is its baseline, so nothing is reported.
    await act(async () => {
      result.current.navigate('/w/common');
    });
    await waitFor(() => expect(client.getQueryData(['adrs', 'common', ''])).toBeDefined());
    await pollLists(client);
    expect(result.current.watch.changed).toEqual([]);

    // Back in adrien, the change is the one already reported: no new report, and its baseline is the newer reading.
    await act(async () => {
      result.current.navigate('/w/adrien');
    });
    await waitFor(() => expect(result.current.watch.changed).toEqual(['ADR-0002']));
    await pollLists(client);
    expect(result.current.watch.version).toBe(reported);
    expect(result.current.watch.changed).toEqual(['ADR-0002']);
  });
});
