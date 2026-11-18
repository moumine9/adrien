import type { GraphNode, GraphResponse } from '@adrien/api/contract';
import { layoutGraph, NODE_H, NODE_W, wrapTitle } from './graph-layout.ts';

const node = (id: string, over: Partial<GraphNode> = {}): GraphNode => ({
  id,
  title: `Decision ${id}`,
  status: 'accepted',
  tags: [],
  pending: false,
  ...over,
});

const chain: GraphResponse = {
  nodes: [node('A'), node('B', { status: 'superseded' }), node('C', { status: 'superseded' }), node('D'), node('E')],
  edges: [
    { from: 'A', to: 'B', type: 'supersedes' },
    { from: 'B', to: 'C', type: 'supersedes' },
    { from: 'D', to: 'A', type: 'related' },
    { from: 'E', to: 'GHOST', type: 'related' },
  ],
};

describe('wrapTitle', () => {
  it('wraps on words and ellipsises what does not fit', () => {
    expect(wrapTitle('Keep secrets in the platform vault, never in environment files', 20, 2)).toEqual([
      'Keep secrets in the',
      'platform vault,…',
    ]);
    expect(wrapTitle('Short', 20, 2)).toEqual(['Short']);
    expect(wrapTitle('Averyveryverylongsingleword here', 10, 2)).toEqual(['Averyvery…']);
  });
});

describe('layoutGraph', () => {
  it('is deterministic', () => {
    expect(layoutGraph(chain)).toEqual(layoutGraph(chain));
  });

  it('keeps every node inside the canvas', () => {
    const g = layoutGraph(chain);
    for (const n of g.nodes) {
      expect(n.x - NODE_W / 2).toBeGreaterThanOrEqual(0);
      expect(n.y - NODE_H / 2).toBeGreaterThanOrEqual(0);
      expect(n.x + NODE_W / 2).toBeLessThanOrEqual(g.width);
      expect(n.y + NODE_H / 2).toBeLessThanOrEqual(g.height);
    }
  });

  it('never overlaps two nodes', () => {
    const { nodes } = layoutGraph({ nodes: Array.from({ length: 14 }, (_, i) => node(`N${i}`)), edges: [] });
    for (const a of nodes) {
      for (const b of nodes) {
        if (a === b) continue;
        const apart = Math.abs(a.x - b.x) >= NODE_W || Math.abs(a.y - b.y) >= NODE_H;
        expect(apart, `${a.node.id} / ${b.node.id}`).toBe(true);
      }
    }
  });

  it('lays a supersede chain out from the oldest on the left to the newest on the right', () => {
    const at = Object.fromEntries(layoutGraph(chain).nodes.map((n) => [n.node.id, n.x]));
    expect(at.C).toBeLessThan(at.B as number);
    expect(at.B).toBeLessThan(at.A as number);
  });

  it('drops edges to unknown nodes and ends edges on the node borders', () => {
    const g = layoutGraph(chain);
    expect(g.edges.map((e) => `${e.edge.from}>${e.edge.to}`)).toEqual(['A>B', 'B>C', 'D>A']);
    for (const e of g.edges) {
      const target = g.nodes.find((n) => n.node.id === e.edge.to);
      if (!target) throw new Error('missing target');
      const onBorder =
        Math.abs(Math.abs(e.x2 - target.x) - NODE_W / 2) < 0.5 ||
        Math.abs(Math.abs(e.y2 - target.y) - NODE_H / 2) < 0.5;
      expect(onBorder).toBe(true);
    }
  });

  it('handles an empty graph', () => {
    const g = layoutGraph({ nodes: [], edges: [] });
    expect(g.nodes).toEqual([]);
    expect(g.width).toBeGreaterThan(0);
  });
});
