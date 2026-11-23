import type { AdrResponse } from '@adrien/api/contract';
import { screen, waitFor, within } from '@testing-library/react';
import { failingFetch, hangingFetch, jsonResponse, overrideFetch, renderApp } from '@/test/render.tsx';
import { createMockFetch } from '../../mock/handler.ts';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 18, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

const heading = (name: string | RegExp) => screen.findByRole('heading', { name });

describe('Decision view', () => {
  it('shows the time of a decision deleted in this checkout, but no revision to copy', async () => {
    renderApp('/adr/ADR-0012');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.getAllByText(/^Changed /).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Copy revision/ })).toBeNull();
  });

  it('shows when the decision last changed and its revision under the title, and copies the revision', async () => {
    const { user } = renderApp('/adr/ADR-0002');
    await heading('Use PostgreSQL as the system of record for billing');
    expect(screen.getAllByText(/^Changed \d+ days? ago/)).toHaveLength(2); // the visible text and its full reading
    const copy = screen.getByRole('button', { name: /^Copy revision [0-9a-f]{12}$/ });
    await user.click(copy);
    expect(screen.getByText('Copied')).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toMatch(/^[0-9a-f]{12}$/);
  });

  it('hides the revision but keeps the time when Show revision is off', async () => {
    localStorage.setItem('adrien.settings', JSON.stringify({ showRevision: false }));
    renderApp('/adr/ADR-0002');
    await heading('Use PostgreSQL as the system of record for billing');
    expect(screen.queryByRole('button', { name: /^Copy revision/ })).toBeNull();
    expect(screen.getAllByText(/^Changed /).length).toBeGreaterThan(0);
  });

  it('shows skeletons while loading', async () => {
    renderApp('/adr/ADR-0002', { fetch: hangingFetch });
    expect(await screen.findByRole('status', { name: 'Loading the decision' })).toBeInTheDocument();
  });

  it('shows the binding rule, the body and the facts of a binding decision', async () => {
    renderApp('/adr/ADR-0002');
    expect(await heading('Use PostgreSQL as the system of record for billing')).toBeInTheDocument();
    const rule = (await heading('The binding rule')).closest('section') as HTMLElement;
    expect(within(rule).getByText(/Persist billing state in PostgreSQL only/)).toBeInTheDocument();
    expect(screen.getByText('Binding on origin/main.')).toBeInTheDocument();
    expect(screen.getAllByText('Binding').length).toBeGreaterThan(0);
    expect(screen.getByRole('table')).toBeInTheDocument();

    const facts = screen.getByRole('heading', { name: 'Facts' }).closest('section') as HTMLElement;
    expect(within(facts).getByText('2026-06-01')).toBeInTheDocument();
    expect(within(facts).getByText('Review due')).toBeInTheDocument();
    expect(within(facts).getByText('billing-service:src/db/**')).toBeInTheDocument();
    expect(within(facts).getByText('Written by a person')).toBeInTheDocument();
    expect(within(facts).getByRole('link', { name: /postgresql\.org/ })).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.queryByText('Pending in this checkout, not binding until merged')).toBeNull();
  });

  it('hatches only a band on the top of the rule block of a pending decision', async () => {
    renderApp('/adr/ADR-0013');
    await screen.findByRole('heading', { name: 'Move product search to a dedicated index' });
    const rule = document.getElementById('rule-heading')?.closest('section') as HTMLElement;
    expect(rule.firstElementChild).toHaveClass('hatch');
    expect(rule.firstElementChild).toHaveAttribute('aria-hidden', 'true');
    expect(rule.querySelectorAll('.hatch')).toHaveLength(1);
  });

  it('does not flag a review date still ahead', async () => {
    renderApp('/adr/ADR-0010');
    await heading('Log in structured JSON with a request id');
    expect(screen.getByText('2027-01-15')).toBeInTheDocument();
    expect(screen.queryByText('Review due')).toBeNull();
  });

  it('links to the decisions it supersedes, is superseded by, or relates to', async () => {
    const { user } = renderApp('/adr/ADR-0007');
    await heading('Send notifications through a durable queue');
    expect(await screen.findByRole('link', { name: /ADR-0011: Publish notification events/ })).toBeInTheDocument();
    const links = (await heading('Linked decisions')).closest('section') as HTMLElement;
    expect(within(links).getByRole('link', { name: /ADR-0003/ })).toHaveAttribute('href', '/adr/ADR-0003');
    expect(screen.getByText('Replaced by a later decision.')).toBeInTheDocument();
    expect(screen.getByText('The rule, not in force')).toBeInTheDocument();
    await user.click(within(links).getByRole('link', { name: /ADR-0011/ }));
    expect(await heading('Publish notification events to the event bus')).toBeInTheDocument();
  });

  it('separates a pending edit from the binding version', async () => {
    renderApp('/adr/ADR-0004');
    await heading('Retry outbound payment calls with exponential backoff');
    expect(screen.getByText('The binding rule')).toBeInTheDocument();
    const pending = (await heading('Pending in this checkout, not binding until merged')).closest(
      'section',
    ) as HTMLElement;
    expect(within(pending).getByText('Pending edit')).toBeInTheDocument();
    expect(within(pending).getByText(/capped at 5 attempts/)).toBeInTheDocument();
    expect(within(pending).getByText(/capped at 3 attempts/)).toBeInTheDocument();
    expect(within(pending).getByText('Contested')).toBeInTheDocument();
  });

  it('shows a decision that exists only in this checkout as not binding', async () => {
    renderApp('/adr/ADR-0013');
    await heading('Move product search to a dedicated index');
    expect(screen.getByText('Pending in this checkout and currently not in force.')).toBeInTheDocument();
    const rule = screen.getByRole('region', { name: 'Proposed rule, not binding' });
    const changes = screen.getByRole('region', { name: 'Pending in this checkout, not binding until merged' });
    expect(rule.compareDocumentPosition(changes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Proposed rule, not binding')).toBeInTheDocument();
    expect(screen.getByText('Not binding')).toBeInTheDocument();
    expect(screen.queryByText('Binding')).toBeNull();
    expect(screen.getByText(/exists only in this checkout/)).toBeInTheDocument();
    expect(screen.getByText('Proposed by an AI agent')).toBeInTheDocument();
  });

  it('explains a pending removal', async () => {
    renderApp('/adr/ADR-0012');
    await heading('Cap monthly cloud spend per environment');
    expect(screen.getByText(/This checkout removes the decision/)).toBeInTheDocument();
    expect(screen.getAllByText('Pending removal')).toHaveLength(2);
  });

  it('marks an accepted decision as unverified without a default branch', async () => {
    renderApp('/adr/ADR-0002', { variant: 'unresolved' });
    await heading('Use PostgreSQL as the system of record for billing');
    await waitFor(() => expect(screen.getByText('The rule, binding if merged')).toBeInTheDocument());
    expect(screen.queryByText('Binding')).toBeNull();
    expect(screen.getByText('Accepted, but not verified against a default branch.')).toBeInTheDocument();
  });

  it('says when the id does not exist, without offering a retry', async () => {
    renderApp('/adr/ADR-9999');
    expect(await screen.findByText('No decision ADR-9999')).toBeInTheDocument();
    expect(screen.getByText('No decision with id ADR-9999.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to the decisions' })).toBeInTheDocument();
  });

  it('shows a server error with its message and a retry', async () => {
    renderApp('/adr/ADR-0002', {
      fetch: overrideFetch((url) =>
        url.pathname.startsWith('/api/adrs/')
          ? new Response(JSON.stringify({ error: { code: 'INTERNAL', message: 'git failed' } }), {
              status: 500,
              headers: { 'content-type': 'application/json' },
            })
          : undefined,
      ),
    });
    expect(await screen.findByText('Could not load this decision')).toBeInTheDocument();
    expect(screen.getByText('git failed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('does not call a refused request a missing decision', async () => {
    renderApp('/adr/ADR-0002', {
      fetch: failingFetch(403, 'FORBIDDEN_HOST', 'Host header not allowed.'),
    });
    expect(await screen.findByText('Could not load this decision')).toBeInTheDocument();
    expect(screen.getByText('Host header not allowed.')).toBeInTheDocument();
    expect(screen.queryByText('No decision ADR-0002')).toBeNull();
  });

  it('keeps working when every other request fails', async () => {
    renderApp('/adr/ADR-0002', { fetch: failingFetch(500, 'INTERNAL', 'down') });
    expect(await screen.findByText('Could not load this decision')).toBeInTheDocument();
  });
});

describe('Pending relationship changes', () => {
  it('shows a pending edit that changes only the related decisions', async () => {
    const mock = createMockFetch();
    const base = (await (await mock('/api/adrs/ADR-0002')).json()) as AdrResponse;
    const edited = {
      ...base,
      pending: { kind: 'modified', ...base.base, meta: { ...base.base?.meta, related: ['ADR-0004'] } },
    };
    renderApp('/adr/ADR-0002', {
      fetch: overrideFetch((url) => (url.pathname === '/api/adrs/ADR-0002' ? jsonResponse(edited) : undefined)),
    });
    const pending = (await heading('Pending in this checkout, not binding until merged')).closest(
      'section',
    ) as HTMLElement;
    expect(within(pending).getByText('Related')).toBeInTheDocument();
    expect(within(pending).getByText('ADR-0004')).toBeInTheDocument();
    expect(within(pending).queryByText(/The frontmatter is unchanged/)).not.toBeInTheDocument();
  });
});

describe('Gaps in an accepted decision', () => {
  async function openWith(patch: (base: AdrResponse) => AdrResponse) {
    const base = (await (await createMockFetch()('/api/adrs/ADR-0002')).json()) as AdrResponse;
    renderApp('/adr/ADR-0002', {
      fetch: overrideFetch((url) => (url.pathname === '/api/adrs/ADR-0002' ? jsonResponse(patch(base)) : undefined)),
    });
    await heading('Use PostgreSQL as the system of record for billing');
  }
  const withFile = (base: AdrResponse, meta: object, body: string) =>
    ({ ...base, base: { ...base.base, meta: { ...base.base?.meta, ...meta }, body } }) as AdrResponse;

  it('says so, quietly, when there are no deciders and Confirmation is empty', async () => {
    await openWith((base) =>
      withFile(base, { status: 'accepted', deciders: [] }, '## Decision\n\nX.\n\n### Confirmation\n'),
    );
    const hint = screen.getByText(/No deciders are named/).closest('p');
    expect(hint).toHaveTextContent('The Confirmation section is empty');
    expect(hint).toHaveClass('print:hidden');
  });

  it('says nothing when the record is complete', async () => {
    await openWith((base) =>
      withFile(base, { status: 'accepted', deciders: ['sam.k'] }, '### Confirmation\n\nA test checks it.\n'),
    );
    expect(screen.queryByText(/No deciders are named|Confirmation section is empty/)).toBeNull();
  });
});
