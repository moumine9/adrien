import type { GraphNode, GraphResponse } from '@adrien/api/contract';

/**
 * The decisions linked to `id` through supersession, in either direction and transitively, ordered so that each ADR
 * comes after the ADRs it replaces. `related` edges are ignored; so are edges whose ends are not in the graph.
 */
export function supersessionChain(graph: GraphResponse, id: string): GraphNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  if (!byId.has(id)) return [];

  const edges = graph.edges.filter((e) => e.type === 'supersedes' && byId.has(e.from) && byId.has(e.to));
  const neighbours = new Map<string, string[]>();
  for (const { from, to } of edges) {
    neighbours.set(from, [...(neighbours.get(from) ?? []), to]);
    neighbours.set(to, [...(neighbours.get(to) ?? []), from]);
  }

  const component = new Set<string>([id]);
  const queue = [id];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const other of neighbours.get(next) ?? []) {
      if (!component.has(other)) {
        component.add(other);
        queue.push(other);
      }
    }
  }

  // Kahn's algorithm: an ADR is ready once every ADR it replaces is placed.
  const waiting = new Map<string, number>([...component].map((n) => [n, 0]));
  const replaced = new Map<string, string[]>();
  for (const { from, to } of edges) {
    if (!component.has(from)) continue;
    waiting.set(from, (waiting.get(from) ?? 0) + 1);
    replaced.set(to, [...(replaced.get(to) ?? []), from]);
  }

  const order: string[] = [];
  const ready = [...component].filter((n) => waiting.get(n) === 0);
  while (ready.length > 0) {
    ready.sort((a, b) => a.localeCompare(b));
    const next = ready.shift() as string;
    order.push(next);
    for (const successor of replaced.get(next) ?? []) {
      const left = (waiting.get(successor) ?? 0) - 1;
      waiting.set(successor, left);
      if (left === 0) ready.push(successor);
    }
  }

  // Nodes still waiting are on a cycle: they come last, by id.
  const placed = new Set(order);
  const leftover = [...component].filter((n) => !placed.has(n)).sort((a, b) => a.localeCompare(b));

  return [...order, ...leftover].map((n) => byId.get(n) as GraphNode);
}
