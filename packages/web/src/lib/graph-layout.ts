import type { GraphEdge, GraphNode, GraphResponse } from '@adrien/api/contract';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from 'd3-force';

export const NODE_W = 212;
export const NODE_H = 84;
const PAD = 24;
const GAP = 20;
/** Horizontal step between generations of a supersede chain. */
const STEP = NODE_W + 90;

export interface PlacedNode {
  node: GraphNode;
  /** Centre. */
  x: number;
  y: number;
}

export interface PlacedEdge {
  edge: GraphEdge;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface GraphLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  width: number;
  height: number;
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  gen: number;
  chained: boolean;
}

/** Splits a title into at most `maxLines` lines of `max` characters, on word boundaries, ending in `…` if cut. */
export function wrapTitle(title: string, max: number, maxLines: number): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    const first = words[i] as string;
    if (first.length > max) {
      lines.push(`${first.slice(0, max - 1)}…`);
      return lines;
    }
    let line = first;
    i++;
    while (i < words.length && `${line} ${words[i]}`.length <= max) line = `${line} ${words[i++]}`;
    lines.push(line);
  }
  if (i < words.length) {
    let last = lines.pop() as string;
    while (`${last}…`.length > max && last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '));
    lines.push(`${last}…`);
  }
  return lines;
}

/** How many decisions a node replaces in a row: 0 for one that replaces nothing. Guards against cycles. */
function generations(nodes: GraphNode[], edges: GraphEdge[]): Map<string, number> {
  const replaces = new Map<string, string[]>();
  for (const e of edges) if (e.type === 'supersedes') replaces.set(e.from, [...(replaces.get(e.from) ?? []), e.to]);
  const memo = new Map<string, number>();
  const visit = (id: string, path: Set<string>): number => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (path.has(id)) return 0;
    path.add(id);
    const older = replaces.get(id) ?? [];
    const gen = older.length ? 1 + Math.max(...older.map((o) => visit(o, path))) : 0;
    path.delete(id);
    memo.set(id, gen);
    return gen;
  };
  for (const n of nodes) visit(n.id, new Set());
  return memo;
}

/** Where the segment from the centre of a box towards (tx, ty) leaves the box. */
function exitPoint(cx: number, cy: number, tx: number, ty: number): [number, number] {
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return [cx, cy];
  const scale = Math.min(
    dx === 0 ? Infinity : NODE_W / 2 / Math.abs(dx),
    dy === 0 ? Infinity : NODE_H / 2 / Math.abs(dy),
  );
  return [cx + dx * scale, cy + dy * scale];
}

/** Push apart any boxes the force simulation left overlapping, so labels never collide. */
function separate(nodes: SimNode[]): void {
  for (let pass = 0; pass < 60; pass++) {
    let moved = false;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i] as SimNode;
        const b = nodes[j] as SimNode;
        const dx = (b.x ?? 0) - (a.x ?? 0);
        const dy = (b.y ?? 0) - (a.y ?? 0);
        const ox = NODE_W + GAP - Math.abs(dx);
        const oy = NODE_H + GAP - Math.abs(dy);
        if (ox <= 0 || oy <= 0) continue;
        moved = true;
        if (ox / NODE_W < oy / NODE_H) {
          const push = (ox / 2) * (dx < 0 ? -1 : 1);
          a.x = (a.x ?? 0) - push;
          b.x = (b.x ?? 0) + push;
        } else {
          const push = (oy / 2) * (dy < 0 ? -1 : 1);
          a.y = (a.y ?? 0) - push;
          b.y = (b.y ?? 0) + push;
        }
      }
    }
    if (!moved) return;
  }
}

/**
 * A deterministic force layout (d3-force seeds its own positions, so the same graph always lands the same way).
 * Supersede chains run left to right, oldest first; everything else settles around them.
 */
export function layoutGraph(graph: GraphResponse, ticks = 300): GraphLayout {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to) && e.from !== e.to);
  const gens = generations(graph.nodes, edges);
  const chained = new Set(edges.filter((e) => e.type === 'supersedes').flatMap((e) => [e.from, e.to]));

  const sim: SimNode[] = graph.nodes.map((n) => ({ id: n.id, gen: gens.get(n.id) ?? 0, chained: chained.has(n.id) }));
  const links = edges.map((e) => ({ source: e.from, target: e.to, type: e.type }));

  forceSimulation(sim)
    .force(
      'link',
      forceLink<SimNode, (typeof links)[number]>(links)
        .id((d) => d.id)
        .distance((l) => (l.type === 'supersedes' ? STEP : NODE_W + 40))
        .strength((l) => (l.type === 'supersedes' ? 0.7 : 0.45)),
    )
    .force('charge', forceManyBody().strength(-550))
    .force(
      'collide',
      forceCollide(Math.hypot(NODE_W, NODE_H) / 2 + GAP)
        .strength(1)
        .iterations(3),
    )
    .force(
      'x',
      forceX<SimNode>((d) => (d.chained ? d.gen * STEP : 0)).strength((d) => (d.chained ? 0.5 : 0.04)),
    )
    .force('y', forceY(0).strength(0.16))
    .stop()
    .tick(ticks);
  separate(sim);

  if (sim.length === 0) return { nodes: [], edges: [], width: NODE_W + 2 * PAD, height: NODE_H + 2 * PAD };

  const minX = Math.min(...sim.map((n) => n.x ?? 0)) - NODE_W / 2 - PAD;
  const minY = Math.min(...sim.map((n) => n.y ?? 0)) - NODE_H / 2 - PAD;
  const maxX = Math.max(...sim.map((n) => n.x ?? 0)) + NODE_W / 2 + PAD;
  const maxY = Math.max(...sim.map((n) => n.y ?? 0)) + NODE_H / 2 + PAD;
  const round = (v: number) => Math.round(v * 10) / 10;

  const placed: PlacedNode[] = graph.nodes.map((node, i) => ({
    node,
    x: round((sim[i]?.x ?? 0) - minX),
    y: round((sim[i]?.y ?? 0) - minY),
  }));
  const at = new Map(placed.map((p) => [p.node.id, p]));
  const placedEdges: PlacedEdge[] = edges.map((edge) => {
    const a = at.get(edge.from) as PlacedNode;
    const b = at.get(edge.to) as PlacedNode;
    const [x1, y1] = exitPoint(a.x, a.y, b.x, b.y);
    const [x2, y2] = exitPoint(b.x, b.y, a.x, a.y);
    return { edge, x1, y1, x2, y2 };
  });

  return { nodes: placed, edges: placedEdges, width: Math.ceil(maxX - minX), height: Math.ceil(maxY - minY) };
}
