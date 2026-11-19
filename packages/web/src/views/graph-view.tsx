import type { GraphResponse } from '@adrien/api/contract';
import { Tag, Waypoints } from 'lucide-react';
import { type CSSProperties, useId, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { STATUS_ICONS } from '@/components/badges.tsx';
import { EmptyState, ErrorState, LoadingBlocks, PageHeader } from '@/components/states.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Toggle } from '@/components/ui/toggle.tsx';
import { toggle } from '@/lib/filters.ts';
import { type GraphLayout, layoutGraph, NODE_H, NODE_W, wrapTitle } from '@/lib/graph-layout.ts';
import { useGraph } from '@/lib/queries.ts';
import { INK, isRetired, STATUS_ORDER, STATUS_STYLES } from '@/lib/status.ts';

/** Keep nodes that carry any selected tag, and the edges between them. */
export function filterGraph(graph: GraphResponse, tags: string[]): GraphResponse {
  if (tags.length === 0) return graph;
  const nodes = graph.nodes.filter((n) => n.tags.some((t) => tags.includes(t)));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
      {STATUS_ORDER.map((s) => {
        const Icon = STATUS_ICONS[s];
        return (
          <span key={s} className="inline-flex items-center gap-1.5 font-semibold">
            <span
              aria-hidden
              className="grid size-5 place-items-center rounded-[3px] border-2 border-border text-ink"
              style={{ backgroundColor: STATUS_STYLES[s].fill }}
            >
              <Icon className="size-3" strokeWidth={3} />
            </span>
            {STATUS_STYLES[s].label}
          </span>
        );
      })}
      <span className="inline-flex items-center gap-2 font-semibold">
        <svg aria-hidden width="36" height="10" viewBox="0 0 36 10" className="overflow-visible">
          <line x1="0" y1="5" x2="28" y2="5" className="stroke-foreground" strokeWidth="2.5" />
          <path d="M27 0 L36 5 L27 10 z" className="fill-foreground" />
        </svg>
        Replaces
      </span>
      <span className="inline-flex items-center gap-2 font-semibold">
        <svg aria-hidden width="36" height="10" viewBox="0 0 36 10">
          <line x1="0" y1="5" x2="36" y2="5" className="stroke-muted-foreground" strokeWidth="1.75" />
        </svg>
        Related
      </span>
      <span className="inline-flex items-center gap-2 font-semibold">
        <span aria-hidden className="hatch inline-block h-4 w-7 rounded-[3px] border-2 border-dashed border-border" />
        Pending in this checkout
      </span>
    </div>
  );
}

function GraphCanvas({ layout, titleId }: { layout: GraphLayout; titleId: string }) {
  const { width, height } = layout;
  return (
    <div className="overflow-x-auto rounded-base border-2 border-border bg-secondary-background shadow-shadow">
      <svg
        aria-labelledby={titleId}
        viewBox={`0 0 ${width} ${height}`}
        // Fits the card on wide screens; on phones it keeps a legible size and the card scrolls sideways.
        className="mx-auto block w-full max-md:min-w-(--graph-min)"
        style={{ maxWidth: width, '--graph-min': `${Math.round(width * 0.8)}px` } as CSSProperties}
      >
        <title>{`Decision graph, ${layout.nodes.length} decisions`}</title>
        <defs>
          <marker
            id="adr-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M0 0 L10 5 L0 10 z" className="fill-foreground" />
          </marker>
          <pattern id="adr-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="9" stroke={INK} strokeOpacity="0.28" strokeWidth="3" />
          </pattern>
        </defs>
        <g aria-hidden>
          {layout.edges.map((e) => (
            <line
              key={`${e.edge.type}:${e.edge.from}>${e.edge.to}`}
              data-edge={e.edge.type}
              x1={e.x1}
              y1={e.y1}
              x2={e.x2}
              y2={e.y2}
              className={e.edge.type === 'supersedes' ? 'stroke-foreground' : 'stroke-muted-foreground'}
              strokeWidth={e.edge.type === 'supersedes' ? 2.75 : 1.75}
              markerEnd={e.edge.type === 'supersedes' ? 'url(#adr-arrow)' : undefined}
            />
          ))}
        </g>
        {layout.nodes.map(({ node, x, y }) => {
          const left = x - NODE_W / 2;
          const top = y - NODE_H / 2;
          const raised = !node.pending && !isRetired(node.status);
          const label = `${node.id}: ${node.title}. ${STATUS_STYLES[node.status].label}${node.pending ? ', pending in this checkout' : ''}`;
          return (
            <Link
              key={node.id}
              to={`/adr/${encodeURIComponent(node.id)}`}
              aria-label={label}
              data-pending={node.pending || undefined}
              className="group outline-none"
            >
              <title>{label}</title>
              {raised && (
                <rect
                  x={left + 4}
                  y={top + 4}
                  width={NODE_W}
                  height={NODE_H}
                  rx="4"
                  style={{ fill: 'var(--shadow-color)' }}
                />
              )}
              <rect
                x={left}
                y={top}
                width={NODE_W}
                height={NODE_H}
                rx="4"
                fill={STATUS_STYLES[node.status].fill}
                className="stroke-border"
                strokeWidth="2.5"
                strokeDasharray={node.pending ? '7 5' : undefined}
              />
              {node.pending && (
                <rect x={left + 1.5} y={top + 1.5} width={NODE_W - 3} height={8} fill="url(#adr-hatch)" />
              )}
              <rect
                x={left - 6}
                y={top - 6}
                width={NODE_W + 12}
                height={NODE_H + 12}
                rx="7"
                fill="none"
                className="stroke-ring opacity-0 group-hover:opacity-60 group-focus-visible:opacity-100"
                strokeWidth="3"
              />
              <text x={left + 12} y={top + 24} fill={INK} className="font-heading" fontSize="15">
                {node.id}
              </text>
              <text x={left + 12} y={top + 46} fill={INK} fontSize="13.5" fontWeight="600">
                {wrapTitle(node.title, 27, 2).map((line, i) => (
                  <tspan key={line} x={left + 12} dy={i === 0 ? 0 : 18}>
                    {line}
                  </tspan>
                ))}
              </text>
            </Link>
          );
        })}
      </svg>
    </div>
  );
}

export function GraphView() {
  const graph = useGraph();
  const [params, setParams] = useSearchParams();
  const tags = useMemo(() => [...new Set(params.getAll('tag').filter(Boolean))], [params]);
  const titleId = useId();

  const allTags = useMemo(() => [...new Set((graph.data?.nodes ?? []).flatMap((n) => n.tags))].sort(), [graph.data]);
  const visible = useMemo(() => (graph.data ? filterGraph(graph.data, tags) : null), [graph.data, tags]);
  const layout = useMemo(() => (visible ? layoutGraph(visible) : null), [visible]);
  const titles = useMemo(() => new Map((graph.data?.nodes ?? []).map((n) => [n.id, n.title])), [graph.data]);

  const setTags = (next: string[]) => setParams(new URLSearchParams([...next].sort().map((t) => ['tag', t])));

  return (
    <div className="space-y-6">
      <title>Graph | Adrien</title>
      <PageHeader title="Graph">
        <span id={titleId}>How decisions replace and refer to each other. Select a decision to read it.</span>
      </PageHeader>

      {graph.isPending ? (
        <LoadingBlocks label="Loading the graph" count={1} className="h-96" />
      ) : graph.isError ? (
        <ErrorState title="Could not load the graph" error={graph.error} onRetry={() => graph.refetch()} />
      ) : graph.data.nodes.length === 0 ? (
        <EmptyState icon={Waypoints} title="No decisions to draw">
          Once the log has decisions, their links show up here.
        </EmptyState>
      ) : (
        <>
          {allTags.length > 0 && (
            <fieldset className="space-y-2">
              <legend className="font-heading">Show decisions tagged</legend>
              <div className="flex flex-wrap gap-2">
                {allTags.map((t) => (
                  <Toggle
                    key={t}
                    size="sm"
                    pressed={tags.includes(t)}
                    onPressedChange={() => setTags(toggle(tags, t))}
                    className="gap-1.5 font-semibold data-pressed:shadow-shadow"
                  >
                    <Tag aria-hidden className="size-3.5" strokeWidth={2.5} />
                    {t}
                  </Toggle>
                ))}
                {tags.length > 0 && (
                  <Button variant="neutral" size="sm" onClick={() => setTags([])}>
                    Show all
                  </Button>
                )}
              </div>
            </fieldset>
          )}
          <Legend />
          {layout && layout.nodes.length > 0 ? (
            <GraphCanvas layout={layout} titleId={titleId} />
          ) : (
            <EmptyState icon={Tag} title="No decision has these tags">
              Choose other tags, or show all decisions.
            </EmptyState>
          )}
          {visible && visible.edges.length > 0 && (
            <details className="rounded-base border-2 border-border bg-secondary-background">
              <summary className="cursor-pointer px-4 py-3 font-heading">The links as a list</summary>
              <ul className="space-y-1 border-t-2 border-border px-4 py-3">
                {visible.edges.map((e) => (
                  <li key={`${e.type}:${e.from}>${e.to}`}>
                    <Link
                      to={`/adr/${encodeURIComponent(e.from)}`}
                      className="font-heading underline underline-offset-2"
                    >
                      {e.from}
                    </Link>{' '}
                    {e.type === 'supersedes' ? 'replaces' : 'is related to'}{' '}
                    <Link to={`/adr/${encodeURIComponent(e.to)}`} className="font-heading underline underline-offset-2">
                      {e.to}
                    </Link>
                    <span className="text-muted-foreground"> ({titles.get(e.to)})</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
