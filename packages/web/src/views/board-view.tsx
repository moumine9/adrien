import type { AdrRow, Status } from '@adrien/api/contract';
import { Lock } from 'lucide-react';
import type { LocalEditKind } from '@/components/badges.tsx';
import { BoardColumn } from '@/components/board-column.tsx';
import { ErrorState, LoadingBlocks, PageHeader, VerificationNotice } from '@/components/states.tsx';
import { EMPTY_FILTERS } from '@/lib/filters.ts';
import { useAdrs, useMeta } from '@/lib/queries.ts';
import { verificationOf } from '@/lib/status.ts';

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

/**
 * The local edits and removals hidden behind a base row, by the base file's path. `boardRows` hides them, so the base
 * card carries the change instead: without it the card would look untouched while this checkout changes the decision.
 * Like the core, a pending row is paired with the base row at the same path AND id first; only a moved file, whose
 * path changed, is paired by id, and only when that id has a single base row. Two files that share an id are never mixed up.
 */
const localEditsByPath = (rows: AdrRow[]): Map<string, LocalEditKind> => {
  const base = rows.filter((r) => r.layer === 'base');
  const edits = new Map<string, LocalEditKind>();
  for (const r of rows) {
    if (r.layer !== 'pending' || (r.pending_kind !== 'modified' && r.pending_kind !== 'deleted')) continue;
    // The core requires the path AND the id to match: a different decision that reuses a path is not an edit of it.
    const samePlace = base.find((b) => b.path === r.path && b.id === r.id);
    if (samePlace) {
      edits.set(samePlace.path, r.pending_kind);
      continue;
    }
    const sameId = base.filter((b) => b.id === r.id);
    if (sameId.length === 1) edits.set((sameId[0] as AdrRow).path, r.pending_kind);
  }
  return edits;
};

export function BoardView() {
  const adrs = useAdrs(EMPTY_FILTERS);
  const meta = useMeta();
  const verification = verificationOf(meta.data);
  const allRows = adrs.data?.results ?? [];
  const rows = boardRows(allRows);
  const edits = localEditsByPath(allRows);

  return (
    <div className="space-y-8">
      <title>Board | Adrien</title>
      <PageHeader title="Board">Every decision in the log, grouped by status.</PageHeader>

      <div className="flex gap-3 panel p-4 shadow-shadow">
        <Lock aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.5} />
        <p className="max-w-[72ch]">
          This board is read-only. A decision is approved by merging, never by moving a card.
        </p>
      </div>

      {adrs.isPending || meta.isPending ? (
        <LoadingBlocks label="Loading the board" count={3} />
      ) : adrs.isError ? (
        <ErrorState title="Could not load the board" error={adrs.error} onRetry={() => adrs.refetch()} />
      ) : (
        <>
          {meta.isError && !meta.data && <VerificationNotice onRetry={() => meta.refetch()} />}
          <div className="grid grid-cols-1 gap-8 lg:grid-flow-col lg:grid-cols-[none] lg:auto-cols-[minmax(12.5rem,1fr)] lg:items-start lg:gap-5 lg:overflow-x-auto lg:pr-1 lg:pb-2">
            {COLUMNS.map((status) => (
              <BoardColumn
                key={status}
                status={status}
                rows={rows.filter((r) => r.status === status)}
                edits={edits}
                verification={verification}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
