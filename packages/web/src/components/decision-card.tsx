import type { AdrRow } from '@adrien/api/contract';
import { Box, Tag } from 'lucide-react';
import { Link } from 'react-router';
import { bindingOf, isRetired, STATUS_STYLES, type Verification } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';
import { BindingBadge, Chip, PendingBadge, StatusBadge } from './badges.tsx';
import { PendingBand } from './pending-band.tsx';

/**
 * One row of `/api/adrs`. Decisions that stand are raised on a hard shadow; retired ones lie flat; pending changes
 * are hatched with a dashed edge, never raised, because they bind nothing.
 */
export function DecisionCard({ row, verification }: { row: AdrRow; verification: Verification }) {
  const pending = row.layer === 'pending';
  const retired = isRetired(row.status);
  const raised = !pending && !retired;
  return (
    <article
      data-layer={row.layer}
      className={cn(
        'group relative flex flex-col overflow-hidden rounded-base border-2 border-border bg-secondary-background',
        'has-[a:focus-visible]:outline-3 has-[a:focus-visible]:outline-offset-2 has-[a:focus-visible]:outline-ring',
        pending && 'border-dashed',
        raised && 'shadow-shadow hover:translate-x-boxShadowX hover:translate-y-boxShadowY hover:shadow-none',
      )}
    >
      {pending && <PendingBand />}
      <div className="flex min-w-0 flex-1">
        <div
          aria-hidden
          className="w-2.5 shrink-0 border-r border-rule"
          style={{ backgroundColor: STATUS_STYLES[row.status].fill }}
        />
        <div className="min-w-0 flex-1 space-y-3 p-4 sm:p-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 font-heading tabular-nums">{row.id}</span>
            <StatusBadge status={row.status} />
            {pending && row.pending_kind && <PendingBadge kind={row.pending_kind} />}
            <BindingBadge binding={bindingOf(row, verification)} />
          </div>
          <h3 className={cn('text-lg leading-snug sm:text-xl', retired && 'text-muted-foreground')}>
            <Link
              to={`/adr/${encodeURIComponent(row.id)}`}
              className="outline-none after:absolute after:inset-0 hover:underline hover:decoration-2 hover:underline-offset-4"
            >
              {row.title}
            </Link>
          </h3>
          {row.review_rule && (
            <p className="line-clamp-2 max-w-[72ch] border-l-4 border-border pl-3 text-[0.9375rem]">
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
        </div>
      </div>
    </article>
  );
}
