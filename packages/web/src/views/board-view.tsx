import type { AdrRow, Status } from '@adrien/api/contract';
import { Check, ChevronDown, Copy, Lock, Tag } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Chip, InCheckoutBadge, STATUS_ICONS } from '@/components/badges.tsx';
import { ErrorState, LoadingBlocks, PageHeader } from '@/components/states.tsx';
import { Button } from '@/components/ui/button.tsx';
import { EMPTY_FILTERS } from '@/lib/filters.ts';
import { useAdrs } from '@/lib/queries.ts';
import { isRetired, STATUS_STYLES } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';

/** The order of the columns. It is not the order statuses are counted in (`STATUS_ORDER`). */
const COLUMNS: readonly Status[] = ['proposed', 'accepted', 'rejected', 'superseded', 'deprecated'];

/**
 * The rows of the board: every default-branch row, plus decisions that only exist in this checkout. A pending edit or
 * deletion always has a base row of its own, so it is not shown twice. Rows are not merged by id: two files can share an id
 * (two branches picked the same number), and `adrien check` reports that, so the board must show both.
 */
const boardRows = (rows: AdrRow[]): AdrRow[] => rows.filter((r) => r.layer === 'base' || r.pending_kind === 'added');

/** Shows the command that approves a proposal. Approval is a merge, so the board never changes a status itself. */
function ApproveDisclosure({ id }: { id: string }) {
  const command = `adrien accept ${id}`;
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied('copied');
    } catch {
      // No clipboard (an insecure page, or a browser that refuses): the command stays on screen to copy by hand.
      setCopied('failed');
    }
  };

  return (
    <details className="group rounded-base border-2 border-border bg-background">
      <summary className="flex h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-base px-3 font-heading outline-none focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        How to approve
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
          strokeWidth={2.5}
        />
      </summary>
      <div className="space-y-3 border-t-2 border-border p-3">
        <p className="text-sm">Approving is a merge: set the status to accepted in a merge request.</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all rounded-base border-2 border-border bg-secondary-background px-2 py-1 font-mono text-sm">
            {command}
          </code>
          <Button variant="neutral" size="sm" onClick={copy}>
            {copied === 'copied' ? <Check aria-hidden strokeWidth={2.5} /> : <Copy aria-hidden strokeWidth={2.5} />}
            {copied === 'copied' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p role="status" className="text-sm">
          {copied === 'copied' && 'Command copied.'}
          {copied === 'failed' && 'Could not copy. Select the command and copy it by hand.'}
        </p>
      </div>
    </details>
  );
}

function BoardCard({ row }: { row: AdrRow }) {
  const pending = row.layer === 'pending';
  const retired = isRetired(row.status);
  return (
    <article
      className={cn(
        'space-y-3 rounded-base border-2 border-border bg-secondary-background p-4',
        pending && 'hatch border-dashed',
        !pending && !retired && 'shadow-shadow',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-heading tabular-nums">{row.id}</span>
        {pending && <InCheckoutBadge />}
      </div>
      <h3 className={cn('text-base leading-snug', retired && 'text-muted-foreground')}>
        <Link
          to={`/adr/${encodeURIComponent(row.id)}`}
          className="rounded-base underline-offset-4 outline-none hover:underline hover:decoration-2 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {row.title}
        </Link>
      </h3>
      {row.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {row.tags.map((t) => (
            <Chip key={t} icon={Tag}>
              {t}
            </Chip>
          ))}
        </div>
      )}
      {row.status === 'proposed' && <ApproveDisclosure id={row.id} />}
    </article>
  );
}

/** A column is named by its status and icon, so the status never depends on colour alone. */
function Column({ status, rows }: { status: Status; rows: AdrRow[] }) {
  const headingId = useId();
  const { label, fill } = STATUS_STYLES[status];
  const Icon = STATUS_ICONS[status];
  return (
    <section aria-labelledby={headingId} className="min-w-0 space-y-4">
      <h2
        id={headingId}
        className="flex items-center gap-2 rounded-base border-2 border-border px-3 py-2 text-lg text-ink"
        style={{ backgroundColor: fill }}
      >
        <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2.75} />
        {label} <span className="tabular-nums">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-base border-2 border-dashed border-border p-4 text-sm text-muted-foreground">
          No decision is {label.toLowerCase()}.
        </p>
      ) : (
        <ul className="space-y-4">
          {rows.map((row) => (
            <li key={`${row.layer}:${row.path}`}>
              <BoardCard row={row} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function BoardView() {
  const adrs = useAdrs(EMPTY_FILTERS);
  const rows = boardRows(adrs.data?.results ?? []);

  return (
    <div className="space-y-8">
      <title>Board | Adrien</title>
      <div className="flex gap-3 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow">
        <Lock aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.5} />
        <p className="max-w-[72ch]">
          This board is read-only. A decision is approved by merging, never by moving a card.
        </p>
      </div>

      <PageHeader title="Board">Every decision in the log, grouped by status.</PageHeader>

      {adrs.isPending ? (
        <LoadingBlocks label="Loading the board" count={3} />
      ) : adrs.isError ? (
        <ErrorState title="Could not load the board" error={adrs.error} onRetry={() => adrs.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-flow-col lg:grid-cols-[none] lg:auto-cols-[minmax(12.5rem,1fr)] lg:items-start lg:gap-5 lg:overflow-x-auto lg:pb-2">
          {COLUMNS.map((status) => (
            <Column key={status} status={status} rows={rows.filter((r) => r.status === status)} />
          ))}
        </div>
      )}
    </div>
  );
}
