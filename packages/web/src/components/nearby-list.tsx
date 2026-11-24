import type { FileDecisions } from '@adrien/api/contract';
import { Link } from 'react-router';
import { useWorkspacePath } from '@/lib/workspace.ts';

/**
 * The accepted decisions anchored elsewhere in the file's component (ADR-0036). They do not govern the file, so they
 * are shown apart from its decisions, without a binding badge or a rule.
 */
export function NearbyList({ entry }: { entry: FileDecisions }) {
  const wp = useWorkspacePath();
  return (
    <section aria-label="Anchored elsewhere in this component" className="space-y-2 border-t border-rule px-5 py-4">
      <h3 className="caption text-sm text-muted-foreground">
        Anchored elsewhere in {entry.component}, not binding here
      </h3>
      <ul className="space-y-1">
        {entry.nearby.map((n) => (
          <li key={`${n.workspace ?? ''}:${n.id}`} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* A common log's decision is not in this product's log, so it has no page here. */}
            {n.workspace === null ? (
              <Link to={wp(`/adr/${encodeURIComponent(n.id)}`)} className="hover-underline">
                <span className="tabular-nums">{n.id}</span> {n.title}
              </Link>
            ) : (
              <>
                <span className="pill">[{n.workspace}]</span>
                <span>
                  <span className="tabular-nums">{n.id}</span> {n.title}
                </span>
              </>
            )}
            <code className="font-mono text-sm break-all text-muted-foreground">{n.anchors.join(', ')}</code>
          </li>
        ))}
      </ul>
      {entry.nearby_omitted > 0 && (
        <p className="text-muted-foreground">
          And {entry.nearby_omitted} more in {entry.component}.
        </p>
      )}
    </section>
  );
}
