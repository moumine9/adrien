import type { MetaResponse, Status } from '@adrien/api/contract';
import { STATUS_ORDER, STATUS_STYLES } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';
import { STATUS_ICONS } from './badges.tsx';

/**
 * The log at a glance: one bar split by status, and one toggle per status that filters the list. The bar is
 * decorative; the toggles carry the numbers for screen readers.
 */
export function StatusTally({
  counts,
  selected,
  onToggle,
}: {
  counts: MetaResponse['counts'];
  selected: readonly Status[];
  onToggle: (status: Status) => void;
}) {
  const total = STATUS_ORDER.reduce((n, s) => n + (counts.byStatus[s] ?? 0), 0);
  return (
    <div className="space-y-3">
      {total > 0 && (
        <div aria-hidden className="flex h-5 overflow-hidden rounded-base border-2 border-border shadow-shadow">
          {STATUS_ORDER.filter((s) => counts.byStatus[s]).map((s) => (
            <div
              key={s}
              className="border-r-2 border-border last:border-r-0"
              style={{ flexGrow: counts.byStatus[s], backgroundColor: STATUS_STYLES[s].fill }}
            />
          ))}
        </div>
      )}
      <fieldset>
        <legend className="sr-only">Filter by status</legend>
        <div className="flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => {
            const Icon = STATUS_ICONS[s];
            const on = selected.includes(s);
            return (
              <button
                key={s}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(s)}
                className={cn(
                  'inline-flex h-10 items-center gap-2 rounded-base border-2 border-border pr-3 pl-1.5 font-heading',
                  on ? 'text-ink shadow-shadow' : 'bg-secondary-background hover:bg-background',
                )}
                style={on ? { backgroundColor: STATUS_STYLES[s].fill } : undefined}
              >
                <span
                  aria-hidden
                  className="grid size-6 place-items-center rounded-[3px] border-2 border-border text-ink"
                  style={{ backgroundColor: STATUS_STYLES[s].fill }}
                >
                  <Icon className="size-3.5" strokeWidth={2.75} />
                </span>
                {STATUS_STYLES[s].label}
                <span className="tabular-nums">{counts.byStatus[s] ?? 0}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}
