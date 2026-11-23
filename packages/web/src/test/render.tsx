import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { createMockFetch, type MockVariant } from '../../mock/handler.ts';
import { AppRoutes } from '../routes.tsx';

/** Shows the router location so tests can assert what the URL became. */
function LocationProbe() {
  const location = useLocation();
  return (
    <output data-testid="location" hidden>
      {location.pathname + location.search}
    </output>
  );
}

export interface RenderAppOptions {
  /** Answer `/api/*` from the fixtures of this variant (default), or with a custom fetch. */
  variant?: MockVariant;
  fetch?: typeof fetch;
  /** For debounce tests. */
  fakeTimers?: boolean;
  /** Reuse a query cache, to render one page after another as a reader switching workspaces would. */
  client?: QueryClient;
}

/** Renders the whole app (layout and routes) at `route`, against the mock API, with a fresh query cache. */
export function renderApp(route: string, options: RenderAppOptions = {}) {
  const fetchImpl = options.fetch ?? createMockFetch(options.variant ?? 'default');
  const calls: string[] = [];
  vi.stubGlobal('fetch', (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push(String(input));
    return fetchImpl(input, init);
  }) as typeof fetch);
  const client =
    options.client ??
    new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
  const user = userEvent.setup(options.fakeTimers ? { advanceTimers: vi.advanceTimersByTime } : {});
  const result = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
        <AppRoutes />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, user, client, calls };
}

/** A fetch that never answers: the view stays in its loading state. */
export const hangingFetch: typeof fetch = () => new Promise<Response>(() => {});

/** A fetch that answers every request with an API error. */
export function failingFetch(status: number, code: string, message: string): typeof fetch {
  return async () =>
    new Response(JSON.stringify({ error: { code, message } }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
}

/** Answers `/api/*` from the fixtures, but lets a function override chosen paths. */
export function overrideFetch(
  override: (url: URL) => Response | undefined,
  variant: MockVariant = 'default',
): typeof fetch {
  const fallback = createMockFetch(variant);
  return async (input, init) => {
    const url = new URL(String(input), 'http://test.local');
    return override(url) ?? fallback(input, init);
  };
}

export const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => {
  vi.unstubAllGlobals();
});
