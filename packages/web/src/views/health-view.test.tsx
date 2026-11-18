import { screen, waitFor, within } from '@testing-library/react';
import { failingFetch, hangingFetch, renderApp } from '@/test/render.tsx';

const location = () => screen.getByTestId('location').textContent;

describe('Health view', () => {
  it('shows a skeleton while checking', async () => {
    renderApp('/check', { fetch: hangingFetch });
    expect(await screen.findByRole('status', { name: 'Checking the log' })).toBeInTheDocument();
  });

  it('groups the diagnostics by severity', async () => {
    renderApp('/check');
    expect(await screen.findByText('2 errors, 3 warnings')).toBeInTheDocument();
    const errors = screen.getByRole('region', { name: 'Errors (2)' });
    expect(within(errors).getByText('broken-link')).toBeInTheDocument();
    expect(within(errors).getByRole('link', { name: 'ADR-0008' })).toHaveAttribute('href', '/adr/ADR-0008');
    expect(screen.getByRole('region', { name: 'Warnings (3)' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Notes (1)' })).toBeInTheDocument();
    expect(screen.queryByText('markdown')).toBeNull();
  });

  it('adds the style warnings with the toggle, through the URL', async () => {
    const { user, calls } = renderApp('/check');
    await screen.findByText('2 errors, 3 warnings');
    await user.click(screen.getByRole('switch', { name: 'Include style warnings' }));
    await waitFor(() => expect(location()).toBe('/check?lint=1'));
    expect(await screen.findByText('2 errors, 5 warnings')).toBeInTheDocument();
    expect(calls).toContain('/api/check?lint=1');
    expect(screen.getByText('markdown')).toBeInTheDocument();
  });

  it('has an empty state', async () => {
    renderApp('/check', { variant: 'empty' });
    expect(await screen.findByText('Nothing to report')).toBeInTheDocument();
  });

  it('shows the API error message', async () => {
    renderApp('/check', { fetch: failingFetch(500, 'INTERNAL', 'check crashed') });
    expect(await screen.findByText('check crashed')).toBeInTheDocument();
  });
});

describe('Unknown routes', () => {
  it('shows a not-found page with a way back', async () => {
    renderApp('/nowhere');
    expect(await screen.findByText('No page here')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the decisions' })).toHaveAttribute('href', '/');
  });
});

describe('Layout', () => {
  it('shows the base ref and switches theme', async () => {
    const { user } = renderApp('/check');
    expect(await screen.findByText('origin/main')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Use the (dark|light) theme/ });
    const wasDark = document.documentElement.classList.contains('dark');
    await user.click(toggle);
    expect(document.documentElement.classList.contains('dark')).toBe(!wasDark);
    expect(screen.getByRole('link', { name: 'Health', current: 'page' })).toBeInTheDocument();
  });
});
