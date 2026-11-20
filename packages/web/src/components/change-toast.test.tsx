import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateSettings } from '@/lib/settings.ts';
import { renderApp } from '@/test/render.tsx';
import { createMockFetch } from '../../mock/handler.ts';
import { ChangeToast } from './change-toast.tsx';

/** The mock API, with the revisions of the listed decisions replaced while `moved` says so. */
function movingFetch(moved: () => Record<string, string | null>): typeof fetch {
  const inner = createMockFetch('default');
  return async (input, init) => {
    const response = await inner(input, init);
    const url = new URL(String(input), 'http://localhost');
    if (url.pathname !== '/api/adrs') return response;
    const body = await response.json();
    const patch = moved();
    for (const row of body.results) if (row.id in patch) row.revision = patch[row.id];
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/** The toast alone, against a fetch that can change its answers between polls. */
function renderToast(fetchImpl: typeof fetch, dismissAfterMs?: number) {
  vi.stubGlobal('fetch', fetchImpl);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  render(
    <QueryClientProvider client={client}>
      <ChangeToast dismissAfterMs={dismissAfterMs} />
    </QueryClientProvider>,
  );
  return { client, user: userEvent.setup() };
}

async function firstReading(client: QueryClient) {
  await waitFor(() => expect(client.getQueryData(['adrs', ''])).toBeDefined());
}

async function poll(client: QueryClient) {
  await act(async () => {
    await client.refetchQueries({ queryKey: ['adrs'] });
  });
}

beforeEach(() => {
  localStorage.clear();
  updateSettings({ changeNotifications: true });
});

describe('The change toast', () => {
  it('keeps a live region mounted from the first render, empty until something changes', async () => {
    let patch: Record<string, string | null> = {};
    renderApp('/', { fetch: movingFetch(() => patch) });
    const region = await screen.findByTestId('change-toast');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
    patch = {};
  });

  it('names one decision that changed, then says nothing about the first reading', async () => {
    let patch: Record<string, string | null> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
    patch = { 'ADR-0002': 'abcdefabcdef' };
    await poll(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.'));
  });

  it('merges further changes into the same notice instead of stacking', async () => {
    let patch: Record<string, string | null> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': 'abcdefabcdef' };
    await poll(client);
    patch = { 'ADR-0002': 'abcdefabcdef', 'ADR-0001': '123456123456' };
    await poll(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('2 decisions changed.'));
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);
  });

  it('is dismissed by its button and does not take focus', async () => {
    let patch: Record<string, string | null> = {};
    const { client, user } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    const before = document.activeElement;
    patch = { 'ADR-0002': 'abcdefabcdef' };
    await poll(client);
    await screen.findByRole('button', { name: 'Dismiss' });
    expect(document.activeElement).toBe(before);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
  });

  it('leaves by itself after a while', async () => {
    let patch: Record<string, string | null> = {};
    const { client } = renderToast(
      movingFetch(() => patch),
      30,
    );
    await firstReading(client);
    patch = { 'ADR-0002': 'abcdefabcdef' };
    await poll(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('changed'));
    await waitFor(() => expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement());
  });

  it('stays quiet when change notifications are off', async () => {
    updateSettings({ changeNotifications: false });
    let patch: Record<string, string | null> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': 'abcdefabcdef' };
    await poll(client);
    // Give the notice time to appear if it were going to.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(
      client.getQueryData<{ results: { id: string; revision: string }[] }>(['adrs', ''])?.results[1]?.revision,
    ).toBe('abcdefabcdef');
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
  });
});
