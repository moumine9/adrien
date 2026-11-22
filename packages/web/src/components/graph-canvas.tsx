import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import { type GraphLayout, NODE_H, NODE_W, wrapTitle } from '@/lib/graph-layout.ts';
import { INK, isRetired, STATUS_STYLES } from '@/lib/status.ts';

export function GraphCanvas({ layout, titleId }: { layout: GraphLayout; titleId: string }) {
  const { width, height } = layout;
  return (
    <div className="overflow-x-auto panel shadow-shadow">
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
