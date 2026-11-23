import type { FileDecisions } from '@adrien/api/contract';
import { Anchor, Box, Lightbulb } from 'lucide-react';
import { Link } from 'react-router';
import { BindingBadge, PendingBadge, StatusBadge } from '@/components/badges.tsx';
import { PendingBand } from '@/components/pending-band.tsx';
import { fileBindingOf } from '@/lib/status.ts';
import { useWorkspacePath } from '@/lib/workspace.ts';

type Decision = FileDecisions['decisions'][number];

function MatchNote({ d }: { d: Decision }) {
  return d.match === 'anchor' ? (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <Anchor aria-hidden className="size-3.5" strokeWidth={2.5} />
      Matched by the anchor <code className="font-mono break-all">{d.anchor}</code>
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 text-sm">
      <Box aria-hidden className="size-3.5" strokeWidth={2.5} />
      Matched by its component
    </span>
  );
}

export function DecisionRow({ d, hasNotes }: { d: Decision; hasNotes: boolean }) {
  const binding = fileBindingOf(d, hasNotes);
  const wp = useWorkspacePath();
  return (
    <li className="space-y-2 px-5 py-4">
      {d.layer === 'pending' && <PendingBand className="-mx-5 -mt-4" />}
      <div className="flex flex-wrap items-center gap-2">
        <BindingBadge binding={binding} />
        {d.exemption && (
          <span
            title="An accepted exception of this product departs from this decision for this file."
            className="pill"
          >
            Exempt by {d.exemption.by}
          </span>
        )}
        {binding === 'not-binding' && !d.exemption && (
          <span title="Not accepted on the default branch: worth knowing, not a rule." className="pill">
            <Lightbulb aria-hidden className="size-3.5" strokeWidth={2.5} />
            Hint only
          </span>
        )}
        <StatusBadge status={d.status} />
        {d.pending_kind && <PendingBadge kind={d.pending_kind} />}
      </div>
      <h3 className="text-lg leading-snug">
        {/* A common log's decision is not in this product's log, so it has no page here (yet). */}
        {d.workspace === null ? (
          <Link to={wp(`/adr/${encodeURIComponent(d.id)}`)} className="hover-underline">
            <span className="tabular-nums">{d.id}</span> {d.title}
          </Link>
        ) : (
          <>
            <span className="pill">[{d.workspace}]</span> <span className="tabular-nums">{d.id}</span> {d.title}
          </>
        )}
      </h3>
      {d.review_rule && (
        <p className="max-w-[72ch] border-l-4 border-border pl-4">
          <span className="font-heading">Rule: </span>
          {d.review_rule}
        </p>
      )}
      <MatchNote d={d} />
    </li>
  );
}
