import type { AdrRow } from '@adrien/api/contract';
import { screen, waitFor, within } from '@testing-library/react';
import { failingFetch, hangingFetch, jsonResponse, overrideFetch, renderApp } from '@/test/render.tsx';

const location = () => screen.getByTestId('location').textContent;
const columnHeadings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const cardOf = (title: string) => screen.getByRole('link', { name: title }).closest('article') as HTMLElement;

const READ_ONLY = 'This board is read-only. A decision is approved by merging, never by moving a card.';

describe('Board view', () => {
  it('shows skeletons while loading', () => {
    renderApp('/board', { fetch: hangingFetch });
    expect(screen.getByRole('status', { name: 'Loading the board' })).toBeInTheDocument();
  });

  it('lists the columns in status order with their counts, and says it is read-only', async () => {
    renderApp('/board');
    await screen.findAllByRole('article');
    expect(columnHeadings()).toEqual([
      'Proposed (3)',
      'Accepted (6)',
      'Rejected (1)',
      'Superseded (2)',
      'Deprecated (1)',
    ]);
    expect(screen.getByText(READ_ONLY)).toBeInTheDocument();
  });

  it('shows each decision once, and marks a decision that only exists in this checkout', async () => {
    renderApp('/board');
    await screen.findAllByRole('article');
    // ADR-0004 has a pending edit as well as its base row: one card, the base one.
    expect(screen.getAllByRole('link', { name: 'Retry outbound payment calls with exponential backoff' })).toHaveLength(
      1,
    );
    expect(
      within(cardOf('Move product search to a dedicated index')).getByText('Pending in this checkout'),
    ).toBeVisible();
    expect(screen.getAllByText('Pending in this checkout')).toHaveLength(1);
  });

  it('shows the approve command on a proposed card, and copies it', async () => {
    const { user } = renderApp('/board');
    await screen.findAllByRole('article');
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

    const card = cardOf('Ship risky changes behind feature flags');
    await user.click(within(card).getByText('How to approve'));
    expect(
      within(card).getByText('Approving is a merge: set the status to accepted in a merge request.'),
    ).toBeVisible();
    expect(within(card).getByText('adrien accept ADR-0008')).toBeVisible();

    await user.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('adrien accept ADR-0008');
    expect(within(card).getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(within(card).getByRole('status')).toHaveTextContent('Command copied.');
  });

  it('does not offer an approve command on a card that is not proposed', async () => {
    renderApp('/board');
    await screen.findAllByRole('article');
    expect(
      within(cardOf('Use PostgreSQL as the system of record for billing')).queryByText('How to approve'),
    ).toBeNull();
  });

  it('says so, and does not crash, when the clipboard refuses', async () => {
    const { user } = renderApp('/board');
    await screen.findAllByRole('article');
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));

    const card = cardOf('Ship risky changes behind feature flags');
    await user.click(within(card).getByText('How to approve'));
    await user.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(await within(card).findByRole('status')).toHaveTextContent('Could not copy.');
    expect(within(card).getByText('adrien accept ADR-0008')).toBeVisible();
  });

  it('does not crash when the clipboard is unavailable', async () => {
    const { user } = renderApp('/board');
    await screen.findAllByRole('article');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });

    const card = cardOf('Ship risky changes behind feature flags');
    await user.click(within(card).getByText('How to approve'));
    await user.click(within(card).getByRole('button', { name: 'Copy' }));
    expect(await within(card).findByRole('status')).toHaveTextContent('Could not copy.');
  });

  it('shows an empty state in a column with no decisions', async () => {
    const accepted: AdrRow = {
      id: 'ADR-0002',
      title: 'Use PostgreSQL as the system of record for billing',
      status: 'accepted',
      tags: ['data'],
      components: ['billing-service'],
      review_rule: null,
      layer: 'base',
      pending_kind: null,
      path: 'ADR-0002-use-postgresql-as-the-system-of-record-for-billing.md',
    };
    renderApp('/board', {
      fetch: overrideFetch((url) => (url.pathname === '/api/adrs' ? jsonResponse({ results: [accepted] }) : undefined)),
    });
    await screen.findByRole('heading', { level: 2, name: 'Accepted (1)' });
    expect(columnHeadings()).toEqual([
      'Proposed (0)',
      'Accepted (1)',
      'Rejected (0)',
      'Superseded (0)',
      'Deprecated (0)',
    ]);
    const rejected = screen.getByRole('region', { name: 'Rejected (0)' });
    expect(within(rejected).getByText('No decision is rejected.')).toBeVisible();
  });

  it('shows the API error message, and retries', async () => {
    const { user, calls } = renderApp('/board', {
      fetch: failingFetch(500, 'INTERNAL', 'The log could not be read.'),
    });
    expect(await screen.findByRole('heading', { name: 'Could not load the board' })).toBeInTheDocument();
    expect(screen.getByText('The log could not be read.')).toBeInTheDocument();
    const before = calls.filter((c) => c.startsWith('/api/adrs')).length;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(calls.filter((c) => c.startsWith('/api/adrs')).length).toBeGreaterThan(before));
  });

  it('is reached from a Board link in the navbar, which is marked current there', async () => {
    const { user } = renderApp('/');
    const link = await screen.findByRole('link', { name: 'Board' });
    expect(link).toHaveAttribute('href', '/board');
    await user.click(link);
    await waitFor(() => expect(location()).toBe('/board'));
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByRole('heading', { level: 1, name: 'Board' })).toBeInTheDocument();
  });
});

describe('Board view, decisions that share an id', () => {
  const row = (over: Partial<AdrRow>): AdrRow => ({
    id: 'ADR-0001',
    title: 'Base decision',
    status: 'accepted',
    tags: [],
    components: [],
    review_rule: null,
    layer: 'base',
    pending_kind: null,
    path: 'docs/adr/ADR-0001-base.md',
    ...over,
  });
  const withRows = (rows: AdrRow[]) =>
    overrideFetch((url) => (url.pathname === '/api/adrs' ? jsonResponse({ results: rows }) : undefined));

  it('shows a pending proposal that reuses a base id, instead of hiding it', async () => {
    const clash = row({
      title: 'Clashing proposal',
      status: 'proposed',
      layer: 'pending',
      pending_kind: 'added',
      path: 'docs/adr/ADR-0001-clash.md',
    });
    renderApp('/board', { fetch: withRows([row({}), clash]) });
    await screen.findAllByRole('article');
    expect(columnHeadings()).toEqual([
      'Proposed (1)',
      'Accepted (1)',
      'Rejected (0)',
      'Superseded (0)',
      'Deprecated (0)',
    ]);
    expect(screen.getByRole('link', { name: 'Clashing proposal' })).toBeInTheDocument();
  });

  it('shows both files when two base files share an id', async () => {
    const twin = row({ title: 'Twin decision', path: 'docs/adr/ADR-0001-twin.md' });
    renderApp('/board', { fetch: withRows([row({}), twin]) });
    await screen.findAllByRole('article');
    expect(columnHeadings()).toContain('Accepted (2)');
    expect(screen.getByRole('link', { name: 'Twin decision' })).toBeInTheDocument();
  });

  it('does not repeat a decision that has a pending edit or deletion beside its base row', async () => {
    const edit = row({ layer: 'pending', pending_kind: 'modified', title: 'Edited title' });
    const removal = row({ id: 'ADR-0002', layer: 'pending', pending_kind: 'deleted', path: 'docs/adr/ADR-0002-x.md' });
    const base2 = row({ id: 'ADR-0002', title: 'Second', path: 'docs/adr/ADR-0002-x.md' });
    renderApp('/board', { fetch: withRows([row({}), edit, base2, removal]) });
    await screen.findAllByRole('article');
    expect(columnHeadings()).toContain('Accepted (2)');
    expect(screen.queryByRole('link', { name: 'Edited title' })).not.toBeInTheDocument();
  });
});
