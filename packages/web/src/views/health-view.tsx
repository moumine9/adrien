import type { Diagnostic } from '@adrien/api/contract';
import { CircleCheckBig, CircleX, Info, type LucideIcon, TriangleAlert } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { EmptyState, ErrorState, LoadingBlocks, PageHeader } from '@/components/states.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { useCheck } from '@/lib/queries.ts';
import { STATUS_STYLES } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';

type Severity = Diagnostic['severity'];

const SEVERITY: Record<Severity, { title: string; icon: LucideIcon; fill: string; hint: string }> = {
  error: {
    title: 'Errors',
    icon: CircleX,
    fill: STATUS_STYLES.rejected.fill,
    hint: 'The log is inconsistent: fix these before relying on it.',
  },
  warning: {
    title: 'Warnings',
    icon: TriangleAlert,
    fill: STATUS_STYLES.deprecated.fill,
    hint: 'Worth a look; nothing is broken.',
  },
  info: { title: 'Notes', icon: Info, fill: STATUS_STYLES.superseded.fill, hint: 'For information only.' },
};

const ORDER: Severity[] = ['error', 'warning', 'info'];

function DiagnosticItem({ d }: { d: Diagnostic }) {
  return (
    <li className="space-y-1.5 px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <code className="rounded-[3px] border-2 border-border bg-background px-1.5 font-mono text-sm">{d.code}</code>
        {d.id && (
          <Link
            to={`/adr/${encodeURIComponent(d.id)}`}
            className="font-heading tabular-nums underline decoration-2 underline-offset-4"
          >
            {d.id}
          </Link>
        )}
      </div>
      <p className="max-w-[80ch]">{d.message}</p>
      {d.path && <p className="font-mono text-sm break-all text-muted-foreground">{d.path}</p>}
    </li>
  );
}

function Group({ severity, items }: { severity: Severity; items: Diagnostic[] }) {
  const s = SEVERITY[severity];
  const headingId = `severity-${severity}`;
  return (
    <section aria-labelledby={headingId} className="overflow-hidden panel shadow-shadow">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-border bg-background px-5 py-3">
        <span aria-hidden className="grid size-8 place-items-center frame text-ink" style={{ backgroundColor: s.fill }}>
          <s.icon className="size-4" strokeWidth={2.5} />
        </span>
        <h2 id={headingId} className="text-xl">
          {s.title} <span className="tabular-nums">({items.length})</span>
        </h2>
        <p className="text-sm text-muted-foreground">{s.hint}</p>
      </header>
      <ul className="divide-y-2 divide-border">
        {items.map((d, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: diagnostics have no id and the same code can repeat.
          <DiagnosticItem key={`${d.code}-${d.id ?? ''}-${i}`} d={d} />
        ))}
      </ul>
    </section>
  );
}

export function HealthView() {
  const [params, setParams] = useSearchParams();
  const lint = params.get('lint') === '1';
  const check = useCheck(lint);

  return (
    <div className="space-y-8">
      <title>Health | Adrien</title>
      <PageHeader title="Health">
        What <code className="font-mono">adrien check</code> finds in the log: broken links, unknown tags, stale code
        anchors, review dates that have passed.
      </PageHeader>

      <label className="flex w-fit items-center gap-3 font-heading">
        <Switch
          checked={lint}
          onCheckedChange={(on) => setParams(on ? new URLSearchParams({ lint: '1' }) : new URLSearchParams())}
        />
        Include style warnings
      </label>

      {check.isPending ? (
        <LoadingBlocks label="Checking the log" count={2} />
      ) : check.isError ? (
        <ErrorState title="Could not check the log" error={check.error} onRetry={() => check.refetch()} />
      ) : check.data.diagnostics.length === 0 ? (
        <EmptyState icon={CircleCheckBig} title="Nothing to report">
          The log is consistent{lint ? ' and the Markdown follows the style rules' : ''}.
        </EmptyState>
      ) : (
        <div className="space-y-6">
          <p aria-live="polite" className={cn('text-lg font-heading')}>
            {check.data.errors} {check.data.errors === 1 ? 'error' : 'errors'}, {check.data.warnings}{' '}
            {check.data.warnings === 1 ? 'warning' : 'warnings'}
          </p>
          {ORDER.map((severity) => {
            const items = check.data.diagnostics.filter((d) => d.severity === severity);
            return items.length > 0 ? <Group key={severity} severity={severity} items={items} /> : null;
          })}
        </div>
      )}
    </div>
  );
}
