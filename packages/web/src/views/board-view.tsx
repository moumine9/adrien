import type { AdrRow, Status } from '@adrien/api/contract';
import { Check, ChevronDown, Copy, Lock, Tag } from 'lucide-react';
import { useId, useState } from 'react';
import { Link } from 'react-router';
import { Chip, InCheckoutBadge, LocalEditBadge, type LocalEditKind, STATUS_ICONS } from '@/components/badges.tsx';
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
 * deletion is hidden only while its base row is shown. Rows are not merged by id: two files can share an id (two branches
 * picked the same number), and `adrien check` reports that, so the board must show both.
 */
const boardRows = (rows: AdrRow[]): AdrRow[] => {
  const baseIds = new Set(rows.filter((r) => r.layer === 'base').map((r) => r.id));
  return rows.filter((r) => r.layer === 'base' || r.pending_kind === 'added' || !baseIds.has(r.id));
};

/** A column shows this many cards until its reader asks for the rest, so one long column does not bury the others. */
const COLUMN_LIMIT = 15;

/**
 * The local edits and removals hidden behind a base row, by id. `boardRows` hides them, so the base card carries the
 * change instead: without it the card would look untouched while this checkout changes the decision.
 */
const localEditsById = (rows: AdrRow[]): Map<string, LocalEditKind> => {
  const baseIds = new Set(rows.filter((r) => r.layer === 'base').map((r) => r.id));
  const edits = new Map<string, LocalEditKind>();
  for (const r of rows) {
    if (r.layer === 'pending' && baseIds.has(r.id) && (r.pending_kind === 'modified' || r.pending_kind === 'deleted')) {
      edits.set(r.id, r.pending_kind);
    }
  }
  return edits;
};

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

function BoardCard({ row, localEdit }: { row: AdrRow; localEdit?: LocalEditKind }) {
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
        {localEdit && <LocalEditBadge kind={localEdit} />}
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
function Column({ status, rows, edits }: { status: Status; rows: AdrRow[]; edits: Map<string, LocalEditKind> }) {
  const headingId = useId();
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const { label, fill } = STATUS_STYLES[status];
  const Icon = STATUS_ICONS[status];
  const remaining = rows.length - COLUMN_LIMIT;
  const shown = expanded || remaining <= 0 ? rows : rows.slice(0, COLUMN_LIMIT);
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
        <>
          <ul id={listId} className="space-y-4">
            {shown.map((row) => (
              <li key={`${row.layer}:${row.path}`}>
                <BoardCard row={row} localEdit={row.layer === 'base' ? edits.get(row.id) : undefined} />
              </li>
            ))}
          </ul>
          {remaining > 0 && (
            <Button
              variant="neutral"
              size="sm"
              aria-controls={listId}
              aria-expanded={expanded}
              onClick={() => setExpanded((open) => !open)}
            >
              {expanded ? 'Show fewer' : `Show ${remaining} more`}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

export function BoardView() {
  const adrs = useAdrs(EMPTY_FILTERS);
  const allRows = adrs.data?.results ?? [];
  const rows = boardRows(allRows);
  const edits = localEditsById(allRows);

  return (
    <div className="space-y-8">
      <title>Board | Adrien</title>
      <PageHeader title="Board">Every decision in the log, grouped by status.</PageHeader>

      <div className="flex gap-3 rounded-base border-2 border-border bg-secondary-background p-4 shadow-shadow">
        <Lock aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.5} />
        <p className="max-w-[72ch]">
          This board is read-only. A decision is approved by merging, never by moving a card.
        </p>
      </div>

      {adrs.isPending ? (
        <LoadingBlocks label="Loading the board" count={3} />
      ) : adrs.isError ? (
        <ErrorState title="Could not load the board" error={adrs.error} onRetry={() => adrs.refetch()} />
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-flow-col lg:grid-cols-[none] lg:auto-cols-[minmax(12.5rem,1fr)] lg:items-start lg:gap-5 lg:overflow-x-auto lg:pb-2">
          {COLUMNS.map((status) => (
            <Column key={status} status={status} rows={rows.filter((r) => r.status === status)} edits={edits} />
          ))}
        </div>
      )}
    </div>
  );
}
