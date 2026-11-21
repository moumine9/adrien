import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { useChangeWatch } from '@/lib/change-watch.ts';
import { updateSettings } from '@/lib/settings.ts';
import { type Moved, movingFetch } from '@/test/moving-fetch.ts';
import { renderApp } from '@/test/render.tsx';
import { ChangeToast } from './change-toast.tsx';

/** The toast alone, against a fetch that can change its answers between polls. */
function renderToast(fetchImpl: typeof fetch, dismissAfterMs?: number) {
  vi.stubGlobal('fetch', fetchImpl);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ChangeToast dismissAfterMs={dismissAfterMs} />
        <main id="main" tabIndex={-1} />
      </MemoryRouter>
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
    renderApp('/', { fetch: movingFetch(() => ({})) });
    const region = screen.getByTestId('change-toast');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('names one decision that changed, then says nothing about the first reading', async () => {
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.'));
  });

  it('merges further changes into the same notice instead of stacking', async () => {
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.'));
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' }, 'ADR-0001': { revision: '123456123456' } };
    await poll(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('2 decisions changed.'));
    expect(screen.getAllByRole('button', { name: 'Dismiss' })).toHaveLength(1);
  });

  it('is dismissed by its button and does not take focus', async () => {
    let patch: Record<string, Moved> = {};
    const { client, user } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    const before = document.activeElement;
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await screen.findByRole('button', { name: 'Dismiss' });
    expect(document.activeElement).toBe(before);
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
  });

  it('leaves by itself after a while', async () => {
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(
      movingFetch(() => patch),
      30,
    );
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('changed'));
    await waitFor(() => expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement());
  });

  it('stays quiet when change notifications are off', async () => {
    updateSettings({ changeNotifications: false });
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    // Give the notice time to appear if it were going to.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(
      client
        .getQueryData<{ results: { id: string; revision: string }[] }>(['adrs', ''])
        ?.results.find((row) => row.id === 'ADR-0002')?.revision,
    ).toBe('abcdefabcdef');
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
  });

  it('does not bring back old news when notifications are turned on again', async () => {
    updateSettings({ changeNotifications: false });
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    act(() => updateSettings({ changeNotifications: true }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
  });

  it('waits while the pointer is on it, and leaves when the pointer does', async () => {
    let patch: Record<string, Moved> = {};
    const { client, user } = renderToast(
      movingFetch(() => patch),
      300,
    );
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    const text = await screen.findByText('ADR-0002 changed.');
    await user.hover(text);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.');
    await user.unhover(text);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement());
  });

  it('keeps waiting while the button has focus, even after the pointer has left', async () => {
    let patch: Record<string, Moved> = {};
    const { client, user } = renderToast(
      movingFetch(() => patch),
      300,
    );
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    const text = await screen.findByText('ADR-0002 changed.');
    await user.hover(text);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
    await user.unhover(text);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.');
    expect(screen.getByRole('button', { name: 'Dismiss' })).toHaveFocus();
  });

  it('keeps waiting while the pointer is on it, even after focus has left', async () => {
    let patch: Record<string, Moved> = {};
    const { client, user } = renderToast(
      movingFetch(() => patch),
      300,
    );
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    const text = await screen.findByText('ADR-0002 changed.');
    await user.hover(text);
    await user.tab();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Dismiss' })).not.toHaveFocus();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });
    expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.');
  });

  it('takes a notice that is already showing away when notifications are turned off', async () => {
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await screen.findByText('ADR-0002 changed.');
    act(() => updateSettings({ changeNotifications: false }));
    await waitFor(() => expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement());
  });

  it('gives focus to the page when the button that had it goes away', async () => {
    let patch: Record<string, Moved> = {};
    const { client, user } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await user.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('keeps the button out of the live region, so only the sentence is announced', async () => {
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    const button = await screen.findByRole('button', { name: 'Dismiss' });
    expect(screen.getByTestId('change-toast')).not.toContainElement(button);
  });
});

describe('useChangeWatch', () => {
  it('counts a change to a decision that was already collected', async () => {
    let patch: Record<string, Moved> = {};
    vi.stubGlobal(
      'fetch',
      movingFetch(() => patch),
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
    });
    const { result } = renderHook(() => useChangeWatch(), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'aaaaaaaaaaaa' } };
    await poll(client);
    await waitFor(() => expect(result.current.version).toBe(1));
    patch = { 'ADR-0002': { revision: 'bbbbbbbbbbbb' } };
    await poll(client);
    await waitFor(() => expect(result.current.version).toBe(2));
    expect(result.current.changed).toEqual(['ADR-0002']);
  });
});
