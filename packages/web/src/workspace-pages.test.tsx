import { screen, waitFor } from '@testing-library/react';
import { renderApp } from '@/test/render.tsx';

beforeEach(() => {
  localStorage.clear();
});

describe('a named workspace', () => {
  it('lists only its own decisions, with links that keep the /w/<name> prefix', async () => {
    const { calls } = renderApp('/w/common', { variant: 'workspaces' });
    const articles = await screen.findAllByRole('article');
    expect(articles).toHaveLength(3);
    expect(calls).toContain('/api/w/common/adrs');
    for (const article of articles) {
      const link = article.querySelector('a');
      expect(link?.getAttribute('href')).toMatch(/^\/w\/common\/adr\/ADR-000[123]$/);
    }
    expect(screen.getByRole('link', { name: 'Board' })).toHaveAttribute('href', '/w/common/board');
    expect(screen.getByRole('link', { name: 'Adrien' })).toHaveAttribute('href', '/w/common');
  });

  it('opens a decision under its workspace', async () => {
    renderApp('/w/common/adr/ADR-0001', { variant: 'workspaces' });
    expect(await screen.findByRole('heading', { level: 1 })).toBeVisible();
  });

  it('never shows the other workspace while it loads, even from the same cache', async () => {
    const first = renderApp('/w/adrien', { variant: 'workspaces' });
    expect((await screen.findAllByRole('article')).length).toBeGreaterThan(3);
    first.unmount();

    const second = renderApp('/w/common', { variant: 'workspaces', client: first.client });
    const articles = await screen.findAllByRole('article');
    expect(articles).toHaveLength(3);
    expect(second.calls).toContain('/api/w/common/adrs');
    expect(second.client.getQueryState(['adrs', 'common', ''])?.status).toBe('success');
  });

  it('refuses the flat routes when there are several workspaces', async () => {
    const { client } = renderApp('/', { variant: 'workspaces' });
    await waitFor(() => expect(client.getQueryState(['adrs', '', ''])?.status).toBe('error'));
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });
});
