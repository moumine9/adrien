import { screen, waitFor } from '@testing-library/react';
import { failingFetch, hangingFetch, renderApp } from '@/test/render.tsx';
import { filterGraph } from './graph-view.tsx';

const location = () => screen.getByTestId('location').textContent;

describe('Graph view', () => {
  it('shows a skeleton while loading', async () => {
    renderApp('/graph', { fetch: hangingFetch });
    expect(await screen.findByRole('status', { name: 'Loading the graph' })).toBeInTheDocument();
  });

  it('shows the API error message', async () => {
    renderApp('/graph', { fetch: failingFetch(500, 'INTERNAL', 'graph broke') });
    expect(await screen.findByText('graph broke')).toBeInTheDocument();
  });

  it('has an empty state', async () => {
    renderApp('/graph', { variant: 'empty' });
    expect(await screen.findByText('No decisions to draw')).toBeInTheDocument();
  });

  it('draws one link per decision, edges by type, and pending nodes apart', async () => {
    const { container } = renderApp('/graph');
    const node = await screen.findByRole('link', { name: /^ADR-0011: Publish notification events/ });
    expect(node).toHaveAccessibleName(expect.stringContaining('Accepted'));
    const pending = screen.getByRole('link', { name: /^ADR-0013:/ });
    expect(pending).toHaveAccessibleName(expect.stringContaining('pending in this checkout'));
    expect(pending).toHaveAttribute('data-pending', 'true');
    expect(container.querySelectorAll('line[data-edge="supersedes"][marker-end]')).toHaveLength(2);
    expect(container.querySelectorAll('line[data-edge="related"]:not([marker-end])').length).toBeGreaterThan(0);
  });

  it('opens a decision when its node is clicked', async () => {
    const { user } = renderApp('/graph');
    await user.click(await screen.findByRole('link', { name: /^ADR-0009:/ }));
    await waitFor(() => expect(location()).toBe('/adr/ADR-0009'));
  });

  it('filters by tag through the URL', async () => {
    const { user } = renderApp('/graph');
    await screen.findByRole('link', { name: /^ADR-0001:/ });
    await user.click(screen.getByRole('button', { name: 'security' }));
    await waitFor(() => expect(location()).toBe('/graph?tag=security'));
    expect(screen.queryByRole('link', { name: /^ADR-0001:/ })).toBeNull();
    expect(screen.getByRole('link', { name: /^ADR-0009:/ })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Show all' }));
    await waitFor(() => expect(location()).toBe('/graph'));
  });

  it('keeps only the edges between the decisions left by a filter', () => {
    const g = filterGraph(
      {
        nodes: [
          { id: 'A', title: 'a', status: 'accepted', tags: ['x'], pending: false },
          { id: 'B', title: 'b', status: 'accepted', tags: ['y'], pending: false },
          { id: 'C', title: 'c', status: 'accepted', tags: ['x', 'y'], pending: false },
        ],
        edges: [
          { from: 'A', to: 'B', type: 'related' },
          { from: 'C', to: 'A', type: 'supersedes' },
        ],
      },
      ['x'],
    );
    expect(g.nodes.map((n) => n.id)).toEqual(['A', 'C']);
    expect(g.edges).toEqual([{ from: 'C', to: 'A', type: 'supersedes' }]);
  });
});
