import type { GraphNode } from '@adrien/api/contract';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { LineageList } from './lineage-list.tsx';

function node(id: string, title: string, extra: Partial<GraphNode> = {}): GraphNode {
  return { id, title, status: 'superseded', tags: [], pending: false, ...extra };
}

function renderList(chain: GraphNode[], currentId: string) {
  return render(
    <MemoryRouter>
      <LineageList chain={chain} currentId={currentId} />
    </MemoryRouter>,
  );
}

test('renders nothing for a chain of two', () => {
  const { container } = renderList([node('ADR-0001', 'First'), node('ADR-0002', 'Second')], 'ADR-0002');
  expect(container).toBeEmptyDOMElement();
});

test('renders the lineage with a link to each other decision and the current one marked', () => {
  const chain = [node('ADR-0001', 'First'), node('ADR-0002', 'Second'), node('ADR-0003', 'Third')];
  renderList(chain, 'ADR-0002');
  const section = screen.getByRole('heading', { name: 'Lineage' }).closest('section') as HTMLElement;
  expect(within(section).getByRole('link', { name: /ADR-0001/ })).toHaveAttribute('href', '/adr/ADR-0001');
  expect(within(section).getByRole('link', { name: /ADR-0003/ })).toHaveAttribute('href', '/adr/ADR-0003');
  expect(within(section).getAllByRole('link')).toHaveLength(2);
  const current = section.querySelector('[aria-current="page"]') as HTMLElement;
  expect(current).toHaveTextContent('ADR-0002');
  expect(current).toHaveTextContent('This decision');
  expect(within(current).queryByRole('link')).toBeNull();
});

test('marks a pending decision', () => {
  const chain = [node('ADR-0001', 'First'), node('ADR-0002', 'Second', { pending: true }), node('ADR-0003', 'Third')];
  renderList(chain, 'ADR-0003');
  expect(screen.getByText('(pending)')).toBeInTheDocument();
});
