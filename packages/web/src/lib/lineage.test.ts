import type { GraphEdge, GraphNode, GraphResponse } from '@adrien/api/contract';
import { supersessionChain } from './lineage.ts';

function node(id: string): GraphNode {
  return { id, title: `Title ${id}`, status: 'accepted', tags: [], pending: false };
}

/** `from` replaces `to` for every [from, to] pair. */
function graph(
  ids: string[],
  supersedes: Array<[string, string]>,
  related: Array<[string, string]> = [],
): GraphResponse {
  const edges: GraphEdge[] = [
    ...supersedes.map(([from, to]) => ({ from, to, type: 'supersedes' as const })),
    ...related.map(([from, to]) => ({ from, to, type: 'related' as const })),
  ];
  return { nodes: ids.map(node), edges };
}

const idsOf = (nodes: GraphNode[]) => nodes.map((n) => n.id);

test('a chain A <- B <- C gives A, B, C in replacement order from any member', () => {
  const g = graph(
    ['A', 'B', 'C'],
    [
      ['B', 'A'],
      ['C', 'B'],
    ],
  );
  expect(idsOf(supersessionChain(g, 'B'))).toEqual(['A', 'B', 'C']);
  expect(idsOf(supersessionChain(g, 'A'))).toEqual(['A', 'B', 'C']);
  expect(idsOf(supersessionChain(g, 'C'))).toEqual(['A', 'B', 'C']);
});

test('a fork where C supersedes both A and B gives A, B, C', () => {
  const g = graph(
    ['A', 'B', 'C'],
    [
      ['C', 'A'],
      ['C', 'B'],
    ],
  );
  expect(idsOf(supersessionChain(g, 'C'))).toEqual(['A', 'B', 'C']);
});

test('a cycle A <-> B gives each ADR once', () => {
  const g = graph(
    ['A', 'B'],
    [
      ['A', 'B'],
      ['B', 'A'],
    ],
  );
  const chain = idsOf(supersessionChain(g, 'A'));
  expect(chain).toHaveLength(2);
  expect([...chain].sort()).toEqual(['A', 'B']);
});

test('a lone ADR gives a chain of itself', () => {
  const g = graph(['A'], []);
  expect(idsOf(supersessionChain(g, 'A'))).toEqual(['A']);
});

test('an unknown id gives an empty chain', () => {
  const g = graph(['A'], []);
  expect(supersessionChain(g, 'Z')).toEqual([]);
});

test('a related edge does not join the chain', () => {
  const g = graph(['A', 'B'], [], [['B', 'A']]);
  expect(idsOf(supersessionChain(g, 'A'))).toEqual(['A']);
});
