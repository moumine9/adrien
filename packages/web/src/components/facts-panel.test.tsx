import type { AdrFile, GraphNode } from '@adrien/api/contract';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FactsPanel } from './facts-panel.tsx';

function fileWithRelated(related: string[]): AdrFile {
  return {
    path: 'docs/adr/ADR-0001-a.md',
    body: '',
    meta: {
      id: 'ADR-0001',
      title: 'A',
      status: 'accepted',
      tags: [],
      components: [],
      code: [],
      sources: [],
      supersedes: [],
      related,
      deciders: [],
      origin: 'manual',
      contested: false,
      extra: {},
    },
  };
}

function renderPanel(related: string[], nodes: Map<string, GraphNode> = new Map()) {
  return render(
    <MemoryRouter>
      <FactsPanel file={fileWithRelated(related)} nodes={nodes} />
    </MemoryRouter>,
  );
}

test('a related reference to another log is plain text, not a link into this log', () => {
  renderPanel(['common/ADR-0004', 'ADR-0002']);
  expect(screen.getByText('common/ADR-0004').closest('a')).toBeNull();
  expect(screen.getByText('ADR-0002').closest('a')).not.toBeNull();
});

test('a related id of this log that contains a slash is still a link', () => {
  const node = { id: 'dec/0001', title: 'Local', status: 'accepted' } as GraphNode;
  renderPanel(['dec/0001', 'common/ADR-0004'], new Map([['dec/0001', node]]));
  expect(screen.getByText('dec/0001').closest('a')).not.toBeNull();
  expect(screen.getByText('common/ADR-0004').closest('a')).toBeNull();
});
