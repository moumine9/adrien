import type { AdrListRow } from '@adrien/api/contract';
import { Box, Tag } from 'lucide-react';
import { Link } from 'react-router';
import { bindingOf, isRetired, type Verification } from '@/lib/status.ts';
import { BindingBadge, Chip, PendingBadge, StatusBadge } from './badges.tsx';
import { DecisionSurface } from './decision-surface.tsx';
import { VersionStamp } from './stamp.tsx';

/** One row of `/api/adrs`, drawn in the frame that matches its binding state (see `DecisionSurface`). */
export function DecisionCard({ row, verification }: { row: AdrListRow; verification: Verification }) {
  const pending = row.layer === 'pending';
  const binding = bindingOf(row, verification);
  return (
    <DecisionSurface as="article" binding={binding} retired={isRetired(row.status)} interactive data-layer={row.layer}>
      <div className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 font-heading tabular-nums">{row.id}</span>
          <StatusBadge status={row.status} />
          {pending && row.pending_kind && <PendingBadge kind={row.pending_kind} />}
          <BindingBadge binding={binding} />
        </div>
        <h3 className="text-lg leading-snug sm:text-xl">
          <Link
            to={`/adr/${encodeURIComponent(row.id)}`}
            className="outline-none after:absolute after:inset-0 hover-underline"
          >
            {row.title}
          </Link>
        </h3>
        {row.review_rule && (
          <p className="line-clamp-2 max-w-[72ch] border-l-4 border-border pl-4 text-[0.9375rem]">
            <span className="font-heading">Rule: </span>
            {row.review_rule}
          </p>
        )}
        {(row.tags.length > 0 || row.components.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {row.tags.length > 0 && <span className="sr-only">Tags:</span>}
            {row.tags.map((t) => (
              <Chip key={`t-${t}`} icon={Tag}>
                {t}
              </Chip>
            ))}
            {row.components.length > 0 && <span className="sr-only">Components:</span>}
            {row.components.map((c) => (
              <Chip key={`c-${c}`} icon={Box} className="bg-secondary-background">
                {c}
              </Chip>
            ))}
          </div>
        )}
        <VersionStamp revision={row.revision} modifiedAt={row.modifiedAt} className="text-muted-foreground" />
      </div>
    </DecisionSurface>
  );
}
