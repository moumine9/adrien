import { screen, waitFor, within } from '@testing-library/react';
import { failingFetch, hangingFetch, overrideFetch, renderApp } from '@/test/render.tsx';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 10, 18, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

const heading = (name: string | RegExp) => screen.findByRole('heading', { name });

describe('Decision view', () => {
  it('shows skeletons while loading', async () => {
    renderApp('/adr/ADR-0002', { fetch: hangingFetch });
    expect(await screen.findByRole('status', { name: 'Loading the decision' })).toBeInTheDocument();
  });

  it('shows the binding rule, the body and the facts of a binding decision', async () => {
    renderApp('/adr/ADR-0002');
    expect(await heading('Use PostgreSQL as the system of record for billing')).toBeInTheDocument();
    const rule = (await heading('The binding rule')).closest('section') as HTMLElement;
    expect(within(rule).getByText(/Persist billing state in PostgreSQL only/)).toBeInTheDocument();
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

  it('keeps working when every other request fails', async () => {
    renderApp('/adr/ADR-0002', { fetch: failingFetch(500, 'INTERNAL', 'down') });
    expect(await screen.findByText('Could not load this decision')).toBeInTheDocument();
  });
});
