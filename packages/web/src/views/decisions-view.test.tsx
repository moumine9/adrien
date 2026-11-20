import { act, screen, waitFor, within } from '@testing-library/react';
import { failingFetch, hangingFetch, renderApp } from '@/test/render.tsx';

const location = () => screen.getByTestId('location').textContent;
const cards = () => screen.getAllByRole('article');

beforeEach(() => {
  localStorage.clear();
});

describe('Decisions view', () => {
  it("shows each card's revision and time, and drops the revision when Show revision is off", async () => {
    const first = renderApp('/');
    await screen.findAllByRole('article');
    expect(screen.getAllByRole('button', { name: /^Copy revision [0-9a-f]{12}$/ }).length).toBeGreaterThan(0);
    first.unmount();
    localStorage.setItem('adrien.settings', JSON.stringify({ showRevision: false }));
    renderApp('/');
    await screen.findAllByRole('article');
    expect(screen.queryByRole('button', { name: /^Copy revision/ })).toBeNull();
    expect(screen.getAllByText(/^Changed /).length).toBeGreaterThan(0);
  });

  it('shows skeletons while loading', () => {
    renderApp('/', { fetch: hangingFetch });
    expect(screen.getByRole('status', { name: 'Loading decisions' })).toBeInTheDocument();
  });

  it('lists every decision with its badges', async () => {
    renderApp('/');
    expect(
      await screen.findByRole('link', { name: 'Use PostgreSQL as the system of record for billing' }),
    ).toBeVisible();
    expect(screen.getByText('13 decisions in docs/decisions, 3 pending changes in this checkout.')).toBeInTheDocument();

    const pg = screen
      .getByRole('link', { name: 'Use PostgreSQL as the system of record for billing' })
      .closest('article');
    expect(within(pg as HTMLElement).getByText('Accepted')).toBeInTheDocument();
    expect(within(pg as HTMLElement).getByText('Binding')).toBeInTheDocument();
    expect(within(pg as HTMLElement).getByText(/Persist billing state in PostgreSQL/)).toBeInTheDocument();

    const pending = cards().filter((a) => a.dataset.layer === 'pending');
    expect(pending).toHaveLength(3);
    for (const card of pending) {
      expect(within(card).getByText('Not binding')).toBeInTheDocument();
      expect(within(card).queryByText('Binding')).toBeNull();
    }
    expect(within(pending[0] as HTMLElement).getByText('Pending edit')).toBeInTheDocument();
  });

  it('shows the API error message, and retries', async () => {
    const { user, calls } = renderApp('/', { fetch: failingFetch(500, 'INTERNAL', 'The log could not be read.') });
    expect(await screen.findByText('Could not load the decisions')).toBeInTheDocument();
    expect(screen.getByText('The log could not be read.')).toBeInTheDocument();
    const before = calls.filter((c) => c.startsWith('/api/adrs')).length;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.filter((c) => c.startsWith('/api/adrs')).length).toBeGreaterThan(before));
  });

  it('invites to record a decision when the log is empty', async () => {
    renderApp('/', { variant: 'empty' });
    expect(await screen.findByText('No decisions yet')).toBeInTheDocument();
  });

  it('says when nothing matches, and clears the filters', async () => {
    const { user } = renderApp('/?q=zzzz&tag=cost');
    expect(await screen.findByText('No decision matches')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0] as HTMLElement);
    await waitFor(() => expect(location()).toBe('/'));
    expect(await screen.findAllByRole('article')).not.toHaveLength(0);
  });

  it('reads the filters from the URL and sends them to the API', async () => {
    const { calls } = renderApp('/?status=accepted&tag=security');
    await screen.findByRole('link', { name: /Keep secrets in the platform vault/ });
    expect(calls).toContain('/api/adrs?status=accepted&tag=security');
    expect(screen.getByRole('button', { name: /Accepted/, pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'security', pressed: true })).toBeInTheDocument();
    expect(cards()).toHaveLength(1);
  });

  it('writes status, tag, component and pending filters to the URL', async () => {
    const { user } = renderApp('/');
    await screen.findAllByRole('article');
    await user.click(screen.getByRole('button', { name: /Rejected/ }));
    await waitFor(() => expect(location()).toBe('/?status=rejected'));
    await user.click(screen.getByRole('button', { name: 'frontend' }));
    await waitFor(() => expect(location()).toBe('/?status=rejected&tag=frontend'));
    await user.click(screen.getByRole('button', { name: 'checkout-web' }));
    await user.click(screen.getByRole('switch', { name: 'Only pending changes' }));
    await waitFor(() => expect(location()).toBe('/?status=rejected&tag=frontend&component=checkout-web&pending=1'));
    await user.click(screen.getByRole('button', { name: /Rejected/ }));
    await waitFor(() => expect(location()).toBe('/?tag=frontend&component=checkout-web&pending=1'));
  });

  it('debounces the search before it reaches the URL and the API', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { user, calls } = renderApp('/', { fakeTimers: true });
      await screen.findAllByRole('article');
      await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'vault');
      expect(location()).toBe('/');
      expect(calls.some((c) => c.includes('q='))).toBe(false);
      await act(async () => {
        vi.advanceTimersByTime(350);
      });
      await waitFor(() => expect(location()).toBe('/?q=vault'));
      await waitFor(() => expect(calls).toContain('/api/adrs?q=vault'));
      expect(calls.filter((c) => c.includes('q=')).length).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('warns when no default branch backs the statuses, and binds nothing', async () => {
    renderApp('/', { variant: 'unresolved' });
    expect(await screen.findByRole('alert')).toHaveTextContent('No default branch found.');
    await screen.findAllByRole('article');
    expect(screen.queryByText('Binding')).toBeNull();
    expect(screen.getAllByText('Unverified').length).toBeGreaterThan(0);
  });

  it('warns about a fork with no shared history', async () => {
    renderApp('/', { variant: 'fork' });
    expect(await screen.findByRole('alert')).toHaveTextContent('shares no history with the default branch');
  });
});
