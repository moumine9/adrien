import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
function renderToast(fetchImpl: typeof fetch, dismissAfterMs?: number, route = '/') {
  vi.stubGlobal('fetch', fetchImpl);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[route]}>
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

const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');

describe('The change toast', () => {
  it('keeps its offsets clear of the safe area on notched and home-indicator devices', () => {
    renderToast(movingFetch(() => ({})));
    const container = screen.getByTestId('change-toast').parentElement;
    expect(container?.className).toContain('bottom-[max(1rem,env(safe-area-inset-bottom))]');
  });

  it('is a compact single line below the sm breakpoint, and the full notice from sm up', async () => {
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await screen.findByText('ADR-0002 changed.');
    const container = screen.getByTestId('change-toast').parentElement;
    expect(container?.className).toContain('py-1');
    expect(container?.className).toContain('sm:py-2');
    const text = screen.getByTestId('change-toast');
    expect(text.className).toContain('truncate');
    expect(text.className).toContain('sm:whitespace-normal');
    expect(text.className).toContain('sm:overflow-visible');
  });

  it('keeps both buttons from shrinking on a narrow screen', async () => {
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    const dismiss = await screen.findByRole('button', { name: 'Dismiss' });
    expect(dismiss.className).toContain('shrink-0');
    expect(dismiss.className).not.toContain('size-8');
  });

  it('fades and rises in when shown, and not otherwise', async () => {
    let patch: Record<string, Moved> = {};
    const { client } = renderToast(movingFetch(() => patch));
    await firstReading(client);
    expect(screen.getByTestId('change-toast').parentElement?.className).not.toContain('toast-enter');
    patch = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await screen.findByText('ADR-0002 changed.');
    expect(screen.getByTestId('change-toast').parentElement?.className).toContain('toast-enter');
  });

  it('defines the toast-enter utility and its keyframes in the stylesheet', () => {
    expect(css).toMatch(/@utility toast-enter \{/);
    expect(css).toMatch(/@keyframes [\w-]+ \{/);
  });

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

  it('does not take a notice about the decision being read away by itself', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = renderToast(
      movingFetch(() => patch.current),
      30,
      '/adr/ADR-0002',
    );
    await waitFor(() => expect(client.getQueryData(['adr', 'ADR-0002'])).toBeDefined());
    await firstReading(client);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    await screen.findByRole('button', { name: 'Reload ADR-0002' });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
    });
    expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.');
  });

  it('copes with a literal percent sign in the decision id', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = renderToast(
      movingFetch(() => patch.current),
      undefined,
      '/adr/100%25',
    );
    await firstReading(client);
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
  });

  it('does not say "Updated" when the reload failed', async () => {
    const patch = { current: {} as Record<string, Moved> };
    let failing = false;
    const inner = movingFetch(() => patch.current);
    const { client, user } = renderToast(
      (async (input, init) =>
        failing && String(input).startsWith('/api/adrs/ADR-0002')
          ? new Response(JSON.stringify({ error: { code: 'X', message: 'down' } }), { status: 500 })
          : inner(input, init)) as typeof fetch,
      undefined,
      '/adr/ADR-0002',
    );
    await waitFor(() => expect(client.getQueryData(['adr', 'ADR-0002'])).toBeDefined());
    await firstReading(client);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef' } };
    await poll(client);
    failing = true;
    await user.click(await screen.findByRole('button', { name: 'Reload ADR-0002' }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.getByTestId('change-toast')).not.toHaveTextContent('Updated.');
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
