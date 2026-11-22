import type { AdrRow, Status } from '@adrien/api/contract';
import { useId, useState } from 'react';
import { type LocalEditKind, STATUS_ICONS } from '@/components/badges.tsx';
import { BoardCard } from '@/components/board-card.tsx';
import { Button } from '@/components/ui/button.tsx';
import { STATUS_STYLES, type Verification } from '@/lib/status.ts';

/** A column shows this many cards until its reader asks for the rest, so one long column does not bury the others. */
const COLUMN_LIMIT = 15;

/** A column is named by its status and icon, so the status never depends on colour alone. */
export function BoardColumn({
  status,
  rows,
  edits,
  verification,
}: {
  status: Status;
  rows: AdrRow[];
  edits: Map<string, LocalEditKind>;
  verification: Verification;
}) {
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
        className="flex items-center gap-2 frame px-2 py-2 text-lg text-ink"
        style={{ backgroundColor: fill }}
      >
        <Icon aria-hidden className="size-4 shrink-0" strokeWidth={2.75} />
        {label} <span className="tabular-nums">({rows.length})</span>
      </h2>
      {rows.length === 0 ? (
        <p className="rounded-base border-2 border-dashed border-border p-4 text-muted-foreground">
          No decision is {label.toLowerCase()}.
        </p>
      ) : (
        <>
          <ul id={listId} className="space-y-4">
            {shown.map((row) => (
              <li key={`${row.layer}:${row.path}`}>
                <BoardCard
                  row={row}
                  verification={verification}
                  localEdit={row.layer === 'base' ? edits.get(row.path) : undefined}
                />
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
