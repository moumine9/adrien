import type { AdrRow } from '@adrien/api/contract';
import { act, screen, waitFor, within } from '@testing-library/react';
import { failingFetch, hangingFetch, jsonResponse, overrideFetch, renderApp } from '@/test/render.tsx';
import { createMockFetch } from '../../mock/handler.ts';

const location = () => screen.getByTestId('location').textContent;
const columnHeadings = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
/** The card for `title`, once the log has said whether its statuses are verified (cards wait for that). */
const settledCard = async (title: string) =>
  (await screen.findByRole('link', { name: title })).closest('article') as HTMLElement;
const cardOf = (title: string) => screen.getByRole('link', { name: title }).closest('article') as HTMLElement;

const READ_ONLY = 'This board is read-only. A decision is approved by merging, never by moving a card.';

/** The clipboard before any test ran. A test that replaces it gets this property back after it. */
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

/** One row of `/api/adrs`, with the fields a test does not care about filled in. */
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

/** Answers `/api/adrs` with these rows, and everything else from the fixtures. */
const withRows = (rows: AdrRow[]) =>
  overrideFetch((url) => (url.pathname === '/api/adrs' ? jsonResponse({ results: rows }) : undefined));

afterEach(() => {
  if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
  else delete (navigator as { clipboard?: unknown }).clipboard;
  vi.restoreAllMocks();
});

describe('Board view', () => {
  it('hatches only a band on the top of a pending card, never the text', async () => {
    renderApp('/board');
    const card = (await screen.findByRole('link', { name: 'Move product search to a dedicated index' })).closest(
      'article',
    ) as HTMLElement;
    expect(card).toHaveAttribute('data-binding', 'pending');
    const band = card.querySelector('.hatch') as HTMLElement;
    expect(band).toHaveAttribute('aria-hidden', 'true');
    expect(card.querySelectorAll('.hatch')).toHaveLength(1);
  });

  it('draws an accepted decision as binding with its edge when the default branch backs it', async () => {
    renderApp('/board');
    const card = await settledCard('Use PostgreSQL as the system of record for billing');
    await waitFor(() => expect(card).toHaveAttribute('data-binding', 'binding'));
    expect(card.querySelector('[data-surface-edge]')).not.toBeNull();
    expect(card.querySelector('[data-surface-notch]')).toBeNull();
  });

  it('draws it as unverified, with a notch and no edge, when no default branch backs it', async () => {
    renderApp('/board', { variant: 'unresolved' });
    const card = await settledCard('Use PostgreSQL as the system of record for billing');
    await waitFor(() => expect(card).toHaveAttribute('data-binding', 'unverified'));
    expect(card.querySelector('[data-surface-notch]')).not.toBeNull();
    expect(card.querySelector('[data-surface-edge]')).toBeNull();
  });

  it('draws a proposed decision on the default branch as not binding, with no edge', async () => {
    renderApp('/board');
    const card = await settledCard('Ship risky changes behind feature flags');
    expect(card).toHaveAttribute('data-binding', 'not-binding');
    expect(card.querySelector('[data-surface-edge]')).toBeNull();
    expect(card).not.toHaveAttribute('data-retired');
  });

  it('mutes a retired decision', async () => {
    renderApp('/board');
    const card = await settledCard('Render the checkout entirely on the server');
    expect(card).toHaveAttribute('data-retired', 'true');
  });

  it('draws no card until the log says whether its statuses are verified, so none flashes as unverified', async () => {
    const inner = createMockFetch('default');
    const metaNeverAnswers: typeof fetch = (input, init) =>
      String(input).startsWith('/api/meta') ? new Promise<Response>(() => {}) : inner(input, init);
    renderApp('/board', { fetch: metaNeverAnswers });
    expect(screen.getByRole('status', { name: 'Loading the board' })).toBeInTheDocument();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('draws the cards, as unverified, when the log cannot say', async () => {
    const inner = createMockFetch('default');
    const metaFails: typeof fetch = async (input, init) =>
      String(input).startsWith('/api/meta')
        ? new Response(JSON.stringify({ error: { code: 'X', message: 'down' } }), { status: 500 })
        : inner(input, init);
    renderApp('/board', { fetch: metaFails });
    const card = await settledCard('Use PostgreSQL as the system of record for billing');
    expect(card).toHaveAttribute('data-binding', 'unverified');
  });

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

  it('puts the read-only banner after the page heading', async () => {
    renderApp('/board');
    await screen.findAllByRole('article');
    const heading = screen.getByRole('heading', { level: 1, name: 'Board' });
    const banner = screen.getByText(READ_ONLY);
    expect(heading.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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

  it('keeps a pending edit that has no base row, marked as pending in this checkout', async () => {
    const orphan = row({
      id: 'ADR-0007',
      title: 'Orphan edit',
      status: 'proposed',
      layer: 'pending',
      pending_kind: 'modified',
      path: 'docs/adr/ADR-0007-orphan.md',
    });
    renderApp('/board', { fetch: withRows([orphan]) });
    await screen.findAllByRole('article');
    expect(screen.getByRole('link', { name: 'Orphan edit' })).toBeInTheDocument();
    expect(columnHeadings()).toContain('Proposed (1)');
  });
});

describe('Board view, local edits to a decision', () => {
  const base = row({ id: 'ADR-0003', title: 'Retry payment calls', path: 'docs/adr/ADR-0003-retry.md' });

  it('marks the base card of a decision edited in this checkout, with an icon and a label', async () => {
    const edit = row({
      id: 'ADR-0003',
      title: 'Retry payment calls, edited',
      layer: 'pending',
      pending_kind: 'modified',
      path: 'docs/adr/ADR-0003-retry.md',
    });
    renderApp('/board', { fetch: withRows([base, edit]) });
    await screen.findAllByRole('article');
    const badge = within(cardOf('Retry payment calls')).getByText('Edited in this checkout');
    expect(badge).toBeVisible();
    expect(badge.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Retry payment calls, edited' })).toBeNull();
  });

  it('marks the base card of a decision deleted in this checkout', async () => {
    const removal = row({
      id: 'ADR-0003',
      layer: 'pending',
      pending_kind: 'deleted',
      path: 'docs/adr/ADR-0003-retry.md',
    });
    renderApp('/board', { fetch: withRows([base, removal]) });
    await screen.findAllByRole('article');
    expect(within(cardOf('Retry payment calls')).getByText('Deleted in this checkout')).toBeVisible();
  });

  it('marks neither on a decision with no local change', async () => {
    renderApp('/board', { fetch: withRows([base]) });
    await screen.findAllByRole('article');
    const card = cardOf('Retry payment calls');
    expect(within(card).queryByText('Edited in this checkout')).toBeNull();
    expect(within(card).queryByText('Deleted in this checkout')).toBeNull();
  });
});

describe('Board view, long columns', () => {
  const proposals = (count: number): AdrRow[] =>
    Array.from({ length: count }, (_, i) => {
      const id = `ADR-${String(i + 1).padStart(4, '0')}`;
      return row({ id, title: `Proposal ${i + 1}`, status: 'proposed', path: `docs/adr/${id}-proposal.md` });
    });

  it('shows the first 15 cards of a column with more, and a button for the rest', async () => {
    renderApp('/board', { fetch: withRows(proposals(20)) });
    await screen.findAllByRole('article');
    const column = screen.getByRole('region', { name: 'Proposed (20)' });
    expect(within(column).getAllByRole('article')).toHaveLength(15);
    expect(within(column).getByRole('button', { name: 'Show 5 more' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows every card when asked, then collapses again, and keeps the full count in the heading', async () => {
    const { user } = renderApp('/board', { fetch: withRows(proposals(20)) });
    await screen.findAllByRole('article');
    const column = screen.getByRole('region', { name: 'Proposed (20)' });

    await user.click(within(column).getByRole('button', { name: 'Show 5 more' }));
    expect(within(column).getAllByRole('article')).toHaveLength(20);
    expect(within(column).getByRole('button', { name: 'Show fewer' })).toHaveAttribute('aria-expanded', 'true');
    expect(columnHeadings()).toContain('Proposed (20)');

    await user.click(within(column).getByRole('button', { name: 'Show fewer' }));
    expect(within(column).getAllByRole('article')).toHaveLength(15);
    expect(within(column).getByRole('button', { name: 'Show 5 more' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggles from the keyboard, and keeps focus on the button', async () => {
    const { user } = renderApp('/board', { fetch: withRows(proposals(20)) });
    await screen.findAllByRole('article');
    const column = screen.getByRole('region', { name: 'Proposed (20)' });
    const toggle = within(column).getByRole('button', { name: 'Show 5 more' });

    toggle.focus();
    await user.keyboard('{Enter}');
    expect(within(column).getAllByRole('article')).toHaveLength(20);
    expect(toggle).toHaveTextContent('Show fewer');
    expect(toggle).toHaveFocus();

    await user.keyboard(' ');
    expect(within(column).getAllByRole('article')).toHaveLength(15);
    expect(toggle).toHaveTextContent('Show 5 more');
    expect(toggle).toHaveFocus();
  });

  it('shows no button for a column of exactly 15 cards', async () => {
    renderApp('/board', { fetch: withRows(proposals(15)) });
    await screen.findAllByRole('article');
    const column = screen.getByRole('region', { name: 'Proposed (15)' });
    expect(within(column).getAllByRole('article')).toHaveLength(15);
    expect(within(column).queryByRole('button', { name: /Show/ })).toBeNull();
  });
});

describe('Board view, local edits on decisions that share an id', () => {
  const row = (over: Partial<AdrRow>): AdrRow => ({
    id: 'ADR-0001',
    title: 'First file',
    status: 'accepted',
    tags: [],
    components: [],
    review_rule: null,
    layer: 'base',
    pending_kind: null,
    path: 'docs/adr/ADR-0001-first.md',
    ...over,
  });
  const second = { title: 'Second file', path: 'docs/adr/ADR-0001-second.md' };
  const withRows = (rows: AdrRow[]) =>
    overrideFetch((url) => (url.pathname === '/api/adrs' ? jsonResponse({ results: rows }) : undefined));
  const badgeOf = (title: string, text: string) => within(cardOf(title)).queryByText(text);

  it('marks only the file that was edited, not every file with the same id', async () => {
    const edit = row({ layer: 'pending', pending_kind: 'modified' });
    renderApp('/board', { fetch: withRows([row({}), row(second), edit]) });
    await screen.findAllByRole('article');
    expect(badgeOf('First file', 'Edited in this checkout')).toBeVisible();
    expect(badgeOf('Second file', 'Edited in this checkout')).toBeNull();
  });

  it('gives each file its own kind when one is edited and the other deleted', async () => {
    const edited = row({ layer: 'pending', pending_kind: 'modified' });
    const deleted = row({ ...second, layer: 'pending', pending_kind: 'deleted' });
    renderApp('/board', { fetch: withRows([row({}), row(second), edited, deleted]) });
    await screen.findAllByRole('article');
    expect(badgeOf('First file', 'Edited in this checkout')).toBeVisible();
    expect(badgeOf('First file', 'Deleted in this checkout')).toBeNull();
    expect(badgeOf('Second file', 'Deleted in this checkout')).toBeVisible();
    expect(badgeOf('Second file', 'Edited in this checkout')).toBeNull();
  });

  it("still marks a file that was moved, when its id is the base file's only one", async () => {
    const moved = row({ layer: 'pending', pending_kind: 'modified', path: 'docs/adr/ADR-0001-renamed.md' });
    renderApp('/board', { fetch: withRows([row({}), moved]) });
    await screen.findAllByRole('article');
    expect(badgeOf('First file', 'Edited in this checkout')).toBeVisible();
  });
});

describe('Board view, a reused file path', () => {
  const row = (over: Partial<AdrRow>): AdrRow => ({
    id: 'ADR-0001',
    title: 'Original decision',
    status: 'accepted',
    tags: [],
    components: [],
    review_rule: null,
    layer: 'base',
    pending_kind: null,
    path: 'docs/adr/ADR-0001-original.md',
    ...over,
  });
  const withRows = (rows: AdrRow[]) =>
    overrideFetch((url) => (url.pathname === '/api/adrs' ? jsonResponse({ results: rows }) : undefined));

  it("does not attach another decision's pending edit to a base card that only shares its path", async () => {
    // The base file at this path is ADR-0001; the checkout has ADR-0002 at the same path, which the core pairs by
    // path AND id, so it is not an edit of ADR-0001.
    const other = row({ id: 'ADR-0002', title: 'Newcomer', layer: 'pending', pending_kind: 'modified' });
    renderApp('/board', { fetch: withRows([row({}), other]) });
    await screen.findAllByRole('article');
    expect(within(cardOf('Original decision')).queryByText('Edited in this checkout')).toBeNull();
    expect(within(cardOf('Original decision')).queryByText('Deleted in this checkout')).toBeNull();
  });
});
