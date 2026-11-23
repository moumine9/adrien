import { screen, within } from '@testing-library/react';
import { jsonResponse, overrideFetch, renderApp } from '@/test/render.tsx';
import { createMockFetch } from '../mock/handler.ts';

beforeEach(() => {
  localStorage.clear();
});

describe('choosing a workspace', () => {
  it('shows a chooser at the flat routes when several workspaces are served', async () => {
    renderApp('/', { variant: 'workspaces' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a workspace' })).toBeInTheDocument();
    const main = screen.getByRole('main');
    expect(within(main).getByRole('link', { name: /adrien/ })).toHaveAttribute('href', '/w/adrien');
    expect(within(main).getByRole('link', { name: /Common standards/ })).toHaveAttribute('href', '/w/common');
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('shows the chooser at a flat decision address as well, and asks for no decision', async () => {
    const { calls } = renderApp('/adr/ADR-0001', { variant: 'workspaces' });
    expect(await screen.findByRole('heading', { level: 1, name: 'Choose a workspace' })).toBeInTheDocument();
    // The flat API would refuse these, so the chooser does not ask for them.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.filter((call) => call !== '/api/workspaces')).toEqual([]);
  });

  it('shows a loading state while the workspaces are asked for', async () => {
    const fallback = createMockFetch('workspaces');
    renderApp('/', {
      fetch: async (input, init) =>
        String(input).endsWith('/api/workspaces') ? new Promise<Response>(() => {}) : fallback(input, init),
    });
    expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Choose a workspace' })).not.toBeInTheDocument();
  });

  it('shows the decisions at the flat routes with one workspace, with no chooser and no switcher', async () => {
    renderApp('/');
    expect((await screen.findAllByRole('article')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Choose a workspace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Workspace:/ })).not.toBeInTheDocument();
  });

  it('shows the decisions at the flat routes when the workspaces cannot be listed', async () => {
    renderApp('/', {
      fetch: overrideFetch((url) =>
        url.pathname === '/api/workspaces' ? jsonResponse({ error: { code: 'X', message: 'down' } }, 500) : undefined,
      ),
    });
    expect((await screen.findAllByRole('article')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { name: 'Choose a workspace' })).not.toBeInTheDocument();
  });

  it('names the open workspace in the header, with a link back to the chooser', async () => {
    const { user } = renderApp('/w/common', { variant: 'workspaces' });
    const link = await screen.findByRole('link', { name: 'Workspace: common' });
    expect(link).toHaveAttribute('href', '/');
    await user.click(link);
    expect(await screen.findByRole('heading', { name: 'Choose a workspace' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Workspace:/ })).not.toBeInTheDocument();
  });

  it('shows a not-found page for a workspace that is not served, with a way back to the chooser', async () => {
    renderApp('/w/nope', { variant: 'workspaces' });
    expect(await screen.findByRole('heading', { level: 1, name: 'No such workspace' })).toBeInTheDocument();
    expect(screen.getByText('There is no workspace with the name “nope”.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the start' })).toHaveAttribute('href', '/');
  });

  it('shows the page of a workspace that is served, not the not-found page', async () => {
    renderApp('/w/common', { variant: 'workspaces' });
    expect(await screen.findAllByRole('article')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: 'No such workspace' })).not.toBeInTheDocument();
  });
});
