import type { GraphResponse } from '@adrien/api/contract';
import { Tag, Waypoints } from 'lucide-react';
import { useId, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { GraphCanvas } from '@/components/graph-canvas.tsx';
import { GraphLegend } from '@/components/graph-legend.tsx';
import { EmptyState, ErrorState, LoadingBlocks, PageHeader } from '@/components/states.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Toggle } from '@/components/ui/toggle.tsx';
import { toggle } from '@/lib/filters.ts';
import { layoutGraph } from '@/lib/graph-layout.ts';
import { useGraph } from '@/lib/queries.ts';

/** Keep nodes that carry any selected tag, and the edges between them. */
export function filterGraph(graph: GraphResponse, tags: string[]): GraphResponse {
  if (tags.length === 0) return graph;
  const nodes = graph.nodes.filter((n) => n.tags.some((t) => tags.includes(t)));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: graph.edges.filter((e) => ids.has(e.from) && ids.has(e.to)) };
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
          <GraphLegend />
          {layout && layout.nodes.length > 0 ? (
            <GraphCanvas layout={layout} titleId={titleId} />
          ) : (
            <EmptyState icon={Tag} title="No decision has these tags">
              Choose other tags, or show all decisions.
            </EmptyState>
          )}
          {visible && visible.edges.length > 0 && (
            <details className="panel">
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
