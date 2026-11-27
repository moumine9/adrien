import type { GraphNode } from '@adrien/api/contract';
import { useId } from 'react';
import { Link } from 'react-router';
import { StatusBadge } from '@/components/badges.tsx';
import { useWorkspacePath } from '@/lib/workspace.ts';

/** The decisions a decision belongs to through supersession, oldest first. Shown only for a chain of three or more. */
export function LineageList({ chain, currentId }: { chain: GraphNode[]; currentId: string }) {
  const headingId = useId();
  const wp = useWorkspacePath();
  if (chain.length < 3) return null;

  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-lg">
        Lineage
      </h2>
      <ol className="space-y-1">
        {chain.map((node) => {
          const current = node.id === currentId;
          const content = (
            <>
              <span className="font-heading tabular-nums">{node.id}</span>
              <span className="text-muted-foreground"> {node.title}</span>
              {node.pending && <span className="text-muted-foreground"> (pending)</span>}
              {current && <span className="font-heading"> This decision</span>}
            </>
          );
          return (
            <li key={node.id} aria-current={current ? 'page' : undefined} className="flex items-center gap-2">
              <StatusBadge status={node.status} />
              {current ? (
                <span className="min-w-0 break-words">{content}</span>
              ) : (
                <Link to={wp(`/adr/${encodeURIComponent(node.id)}`)} className="min-w-0 break-words hover-underline">
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
