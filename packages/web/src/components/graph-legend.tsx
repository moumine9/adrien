import { STATUS_ICONS } from '@/components/badges.tsx';
import { STATUS_ORDER, STATUS_STYLES } from '@/lib/status.ts';

export function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
      {STATUS_ORDER.map((s) => {
        const Icon = STATUS_ICONS[s];
        return (
          <span key={s} className="inline-flex items-center gap-1.5 font-semibold">
            <span
              aria-hidden
              className="grid size-5 place-items-center rounded-[3px] border-2 border-border text-ink"
              style={{ backgroundColor: STATUS_STYLES[s].fill }}
            >
              <Icon className="size-3" strokeWidth={3} />
            </span>
            {STATUS_STYLES[s].label}
          </span>
        );
      })}
      <span className="inline-flex items-center gap-2 font-semibold">
        <svg aria-hidden width="36" height="10" viewBox="0 0 36 10" className="overflow-visible">
          <line x1="0" y1="5" x2="28" y2="5" className="stroke-foreground" strokeWidth="2.5" />
          <path d="M27 0 L36 5 L27 10 z" className="fill-foreground" />
        </svg>
        Replaces
      </span>
      <span className="inline-flex items-center gap-2 font-semibold">
        <svg aria-hidden width="36" height="10" viewBox="0 0 36 10">
          <line x1="0" y1="5" x2="36" y2="5" className="stroke-muted-foreground" strokeWidth="1.75" />
        </svg>
        Related
      </span>
      <span className="inline-flex items-center gap-2 font-semibold">
        <span aria-hidden className="hatch inline-block h-4 w-7 rounded-[3px] border-2 border-dashed border-border" />
        Pending in this checkout
      </span>
    </div>
  );
}
