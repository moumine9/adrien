import { screen, waitFor, within } from '@testing-library/react';
import { failingFetch, hangingFetch, renderApp } from '@/test/render.tsx';

const location = () => screen.getByTestId('location').textContent;
const CHARGE = 'services/billing/src/payments/charge.ts';

describe('Files view', () => {
  it('asks for paths before calling the API', () => {
    const { calls } = renderApp('/files');
    expect(screen.getByRole('textbox', { name: 'File paths' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Find decisions' })).toBeDisabled();
    expect(calls.some((c) => c.startsWith('/api/for'))).toBe(false);
  });

  it('looks paths up, puts them in the URL and shows binding decisions first', async () => {
    const { user, calls } = renderApp('/files');
    await user.type(screen.getByRole('textbox', { name: 'File paths' }), `${CHARGE}\nREADME.md`);
    await user.click(screen.getByRole('button', { name: 'Find decisions' }));
    await waitFor(() => expect(location()).toBe(`/files?path=${encodeURIComponent(CHARGE)}&path=README.md`));
    expect(calls).toContain(`/api/for?path=${encodeURIComponent(CHARGE)}&path=README.md`);

    const charge = await screen.findByRole('region', { name: CHARGE });
    const rows = within(charge).getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByText('Binding')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByRole('link', { name: /ADR-0004/ })).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText('billing-service:src/payments/**')).toBeInTheDocument();
    expect(within(charge).getAllByText('Matched by its component').length).toBeGreaterThan(0);
    const pendingRow = rows.find((r) => within(r).queryByText('Not binding')) as HTMLElement;
    expect(within(pendingRow).getByText('Pending edit')).toBeInTheDocument();
    expect(within(pendingRow).queryByText('Binding')).toBeNull();
    expect(within(charge).getByText('Hint only')).toBeInTheDocument();

    const readme = screen.getByRole('region', { name: 'README.md' });
    expect(within(readme).getByText(/outside every declared component/)).toBeInTheDocument();
  });

  it('shows the server notes and marks binding as unverified', async () => {
    renderApp(`/files?path=${encodeURIComponent(CHARGE)}`, { variant: 'unresolved' });
    expect(await screen.findByText('Binding is not verified')).toBeInTheDocument();
    expect(screen.getByText(/No default branch was found/)).toBeInTheDocument();
    expect(screen.queryByText('Binding')).toBeNull();
    expect(screen.getAllByText('Unverified').length).toBeGreaterThan(0);
  });

  it('shows a skeleton while looking up', async () => {
    renderApp(`/files?path=${encodeURIComponent(CHARGE)}`, { fetch: hangingFetch });
    expect(await screen.findByRole('status', { name: 'Looking up the decisions' })).toBeInTheDocument();
  });

  it('shows the API error message', async () => {
    renderApp('/files?path=x', { fetch: failingFetch(400, 'INVALID_INPUT', 'path escapes the repository') });
    expect(await screen.findByText('path escapes the repository')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('says when a file in a component is governed by nothing', async () => {
    renderApp('/files?path=services/notifications/README.md');
    expect(await screen.findByText(/No decision governs this file|Matched by its component/)).toBeInTheDocument();
  });
});
