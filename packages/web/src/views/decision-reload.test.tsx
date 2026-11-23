import { focusManager, onlineManager, type QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor } from '@testing-library/react';
import { updateSettings } from '@/lib/settings.ts';
import { type Moved, movingFetch } from '@/test/moving-fetch.ts';
import { renderApp } from '@/test/render.tsx';

const OLD = 'Use PostgreSQL as the system of record for billing';
const NEW = 'Use PostgreSQL, and only PostgreSQL, for billing';
const ELSEWHERE = 'ADR-0001';

async function openDecision(
  patchRef: { current: Record<string, Moved> },
  route = '/adr/ADR-0002',
  listKey = ['adrs', '', ''],
) {
  const app = renderApp(route, { fetch: movingFetch(() => patchRef.current) });
  await screen.findByRole('heading', { level: 1, name: OLD });
  // The list is what the app polls; its first reading is the baseline.
  await waitFor(() => expect(app.client.getQueryData(listKey)).toBeDefined());
  return app;
}

async function pollList(client: QueryClient) {
  await act(async () => {
    await client.refetchQueries({ queryKey: ['adrs'] });
  });
}

beforeEach(() => {
  localStorage.clear();
  updateSettings({ changeNotifications: true });
});

describe('A decision that changes while it is open', () => {
  it('keeps the text it showed, says it is out of date, and offers to reload', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    expect(screen.queryByText('Changed since you opened this')).not.toBeInTheDocument();
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    const banner = (await screen.findByText('Changed since you opened this')).closest('p');
    expect(banner).toBeInTheDocument();
    // A printout is a record, not a live page: the whole banner stays off the paper, not only its button.
    expect(banner).toHaveClass('print:hidden');
    expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.');
    expect(screen.getByRole('heading', { level: 1, name: OLD })).toBeInTheDocument();
  });

  it('on a phone the toast expires but the Reload in the header stays', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(width < 40rem)', media: query }));
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    vi.useFakeTimers({ toFake: ['setTimeout'], shouldAdvanceTime: true });
    try {
      patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
      await pollList(client);
      await screen.findByText('Changed since you opened this');
      // The timer is set by an effect after the notice shows: move the clock on until it has run, whenever that is.
      for (let second = 0; second < 20; second++) {
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
      }
    } finally {
      vi.useRealTimers();
    }
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
    expect(screen.getByText('Changed since you opened this')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('inside a workspace, offers Reload and refreshes the decision from that workspace', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client, user } = await openDecision(patch, '/w/adrien/adr/ADR-0002', ['adrs', 'adrien', '']);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    await screen.findByText('Changed since you opened this');
    await user.click(await screen.findByRole('button', { name: 'Reload ADR-0002' }));
    await screen.findByRole('heading', { level: 1, name: NEW });
    expect(await screen.findByText('Updated.')).toBeInTheDocument();
  });

  it('does not swap the text under the reader when the window regains focus or the connection returns', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    await screen.findByText('Changed since you opened this');
    // Make the decision stale, so only the refetch triggers (and not the cache) decide whether the text moves.
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['adr', '', 'ADR-0002'], refetchType: 'none' });
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      onlineManager.setOnline(false);
      onlineManager.setOnline(true);
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    focusManager.setFocused(undefined);
    onlineManager.setOnline(true);
    expect(screen.getByRole('heading', { level: 1, name: OLD })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: NEW })).not.toBeInTheDocument();
  });

  it('does not call a decision out of date when it was fetched after the last reading of the list', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client, user } = renderApp('/', { fetch: movingFetch(() => patch.current) });
    await screen.findByRole('link', { name: OLD });
    await waitFor(() => expect(client.getQueryData(['adrs', '', ''])).toBeDefined());
    // The decision was edited after the list was read; opening it now loads the newer version.
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW, where: 'detail' } };
    await user.click(screen.getByRole('link', { name: OLD }));
    expect(await screen.findByRole('heading', { level: 1, name: NEW })).toBeInTheDocument();
    expect(screen.queryByText('Changed since you opened this')).not.toBeInTheDocument();
  });

  it('does not call a decision out of date because a slower, older reading of the list finished after it', async () => {
    const patch = { current: {} as Record<string, Moved> };
    let release: (() => void) | undefined;
    let hold = false;
    const inner = movingFetch(() => patch.current);
    const slowList: typeof fetch = async (input, init) => {
      const response = await inner(input, init);
      if (hold && new URL(String(input), 'http://localhost').pathname === '/api/adrs') {
        hold = false;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return response;
    };
    const { client, user } = renderApp('/', { fetch: slowList });
    await screen.findByRole('link', { name: OLD });
    await waitFor(() => expect(client.getQueryData(['adrs', '', ''])).toBeDefined());
    // A reading of the list starts, takes the old version... and is slow to answer.
    hold = true;
    const poll = client.refetchQueries({ queryKey: ['adrs'] });
    await waitFor(() => expect(release).toBeDefined());
    // Meanwhile the decision is edited and opened: the page shows the new version.
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await user.click(screen.getByRole('link', { name: OLD }));
    expect(await screen.findByRole('heading', { level: 1, name: NEW })).toBeInTheDocument();
    // Now the old reading of the list arrives. It is older than what is on screen.
    await act(async () => {
      release?.();
      await poll;
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const row = client
      .getQueryData<{ results: { id: string; revision: string | null }[] }>(['adrs', '', ''])
      ?.results.find((r) => r.id === 'ADR-0002');
    expect(row?.revision).not.toBe('abcdefabcdef');
    expect(screen.queryByText('Changed since you opened this')).not.toBeInTheDocument();
  });

  it('reopening a decision shows the version on disk now, without a flash of the old text', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { user } = renderApp('/adr/ADR-0002', { fetch: movingFetch(() => patch.current) });
    await screen.findByRole('heading', { level: 1, name: OLD });
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW, where: 'detail' } };
    await user.click(screen.getByRole('link', { name: /All decisions/ }));
    await screen.findByRole('link', { name: OLD });
    await user.click(screen.getByRole('link', { name: OLD }));
    expect(await screen.findByRole('heading', { level: 1, name: NEW })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: OLD })).not.toBeInTheDocument();
  });

  it('shows the new version, and says "Updated", once Reload is pressed', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client, user } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    await user.click(await screen.findByRole('button', { name: 'Reload ADR-0002' }));
    expect(await screen.findByRole('heading', { level: 1, name: NEW })).toBeInTheDocument();
    expect(screen.queryByText('Changed since you opened this')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('Updated.'));
  });

  it('clears the notice too when the reader reloads from the page', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client, user } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0002 changed.'));
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(await screen.findByRole('heading', { level: 1, name: NEW })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement());
    expect(document.getElementById('main')).toHaveFocus();
  });

  it('leaves the open decision alone when another one changes', async () => {
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    patch.current = { [ELSEWHERE]: { revision: 'abcdefabcdef' } };
    await pollList(client);
    await waitFor(() => expect(screen.getByTestId('change-toast')).toHaveTextContent('ADR-0001 changed.'));
    expect(screen.queryByText('Changed since you opened this')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Reload/ })).not.toBeInTheDocument();
  });

  it('still says so on the page when change notifications are off, but sends no notice', async () => {
    updateSettings({ changeNotifications: false });
    const patch = { current: {} as Record<string, Moved> };
    const { client } = await openDecision(patch);
    patch.current = { 'ADR-0002': { revision: 'abcdefabcdef', title: NEW } };
    await pollList(client);
    expect(await screen.findByText('Changed since you opened this')).toBeInTheDocument();
    expect(screen.getByTestId('change-toast')).toBeEmptyDOMElement();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});
