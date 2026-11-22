import type { MetaResponse } from '@adrien/api/contract';
import { Box, FilePlus2, SearchX, SlidersHorizontal, Tag } from 'lucide-react';
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { DecisionCard } from '@/components/decision-card.tsx';
import { EmptyState, ErrorState, LoadingBlocks, PageHeader, VerificationNotice } from '@/components/states.tsx';
import { StatusTally } from '@/components/status-tally.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { Switch } from '@/components/ui/switch.tsx';
import { Toggle } from '@/components/ui/toggle.tsx';
import {
  activeFilterCount,
  type DecisionFilters,
  EMPTY_FILTERS,
  filtersFromSearch,
  filtersToSearch,
  toggle,
} from '@/lib/filters.ts';
import { useAdrs, useMeta } from '@/lib/queries.ts';
import { verificationOf } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';

export const SEARCH_DEBOUNCE_MS = 300;

function ChipGroup({
  legend,
  hint,
  values,
  selected,
  icon: Icon,
  onToggle,
}: {
  legend: string;
  hint: string;
  values: string[];
  selected: string[];
  icon: typeof Tag;
  onToggle: (value: string) => void;
}) {
  if (values.length === 0) return null;
  return (
    <fieldset className="space-y-2">
      <legend className="font-heading">{legend}</legend>
      <p className="text-sm text-muted-foreground">{hint}</p>
      <div className="flex flex-wrap gap-2">
        {values.map((v) => (
          <Toggle
            key={v}
            size="sm"
            pressed={selected.includes(v)}
            onPressedChange={() => onToggle(v)}
            className="gap-2 font-semibold data-pressed:shadow-shadow"
          >
            <Icon aria-hidden className="size-3.5" strokeWidth={2.5} />
            {v}
          </Toggle>
        ))}
      </div>
    </fieldset>
  );
}

function summary(meta: MetaResponse): ReactNode {
  const { total, pending } = meta.counts;
  const decisions = `${total} ${total === 1 ? 'decision' : 'decisions'} in ${meta.adrDir}`;
  if (!pending) return `${decisions}.`;
  return `${decisions}, ${pending} pending ${pending === 1 ? 'change' : 'changes'} in this checkout.`;
}

export function DecisionsView() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromSearch(params), [params]);
  const meta = useMeta();
  const adrs = useAdrs(filters);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const panelId = useId();
  const searchId = useId();

  const update = (next: Partial<DecisionFilters>, replace = false) =>
    setParams(filtersToSearch({ ...filters, ...next }), { replace });

  // The search box types freely; the URL (and the request) follows once typing pauses.
  const [draft, setDraft] = useState(filters.q);
  const pushed = useRef(filters.q);
  useEffect(() => {
    if (filters.q !== pushed.current) {
      pushed.current = filters.q;
      setDraft(filters.q);
    }
  }, [filters.q]);
  useEffect(() => {
    const q = draft.trim();
    if (q === pushed.current) return;
    const timer = setTimeout(() => {
      pushed.current = q;
      setParams(filtersToSearch({ ...filters, q }), { replace: true });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [draft, filters, setParams]);

  const active = activeFilterCount(filters);
  const verification = verificationOf(meta.data);
  const results = adrs.data?.results;

  return (
    <div className="space-y-8">
      <div className="space-y-6">
        <PageHeader title="Decisions">
          {meta.data ? summary(meta.data) : meta.isPending ? <Skeleton className="h-5 w-72" /> : null}
        </PageHeader>
        {meta.data && (
          <StatusTally
            counts={meta.data.counts}
            selected={filters.status}
            onToggle={(s) => update({ status: toggle(filters.status, s) })}
          />
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-12">
        <aside className="space-y-5 lg:col-span-4">
          <div className="space-y-2">
            <label htmlFor={searchId} className="font-heading">
              Search
            </label>
            <Input
              id={searchId}
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Title, rule or text"
              className="h-11 text-base"
            />
          </div>

          <Button
            variant="neutral"
            className="w-full justify-between lg:hidden"
            aria-expanded={filtersOpen}
            aria-controls={panelId}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <span className="inline-flex items-center gap-2 font-heading">
              <SlidersHorizontal aria-hidden />
              Filters
            </span>
            {active > 0 && <span className="tabular-nums">{active} on</span>}
          </Button>

          <div id={panelId} className={cn('space-y-6', filtersOpen ? 'block' : 'hidden lg:block')}>
            {meta.data && (
              <>
                <ChipGroup
                  legend="Tags"
                  hint="Shows decisions that have every selected tag."
                  values={meta.data.tags}
                  selected={filters.tag}
                  icon={Tag}
                  onToggle={(t) => update({ tag: toggle(filters.tag, t) })}
                />
                <ChipGroup
                  legend="Components"
                  hint="Shows decisions that apply to any selected component."
                  values={Object.keys(meta.data.components).sort()}
                  selected={filters.component}
                  icon={Box}
                  onToggle={(c) => update({ component: toggle(filters.component, c) })}
                />
              </>
            )}
            <label className="flex items-center gap-3 font-heading">
              <Switch checked={filters.pending} onCheckedChange={(on) => update({ pending: on })} />
              Only pending changes
            </label>
            {(active > 0 || filters.q) && (
              <Button variant="neutral" onClick={() => setParams(filtersToSearch(EMPTY_FILTERS))}>
                Clear filters
              </Button>
            )}
          </div>
        </aside>

        <section aria-labelledby="results-heading" className="space-y-4 lg:col-span-8">
          <h2 id="results-heading" className="sr-only">
            Results
          </h2>
          {adrs.isPending || meta.isPending ? (
            <LoadingBlocks label="Loading decisions" count={4} />
          ) : adrs.isError ? (
            <ErrorState title="Could not load the decisions" error={adrs.error} onRetry={() => adrs.refetch()} />
          ) : results && results.length === 0 ? (
            active > 0 || filters.q ? (
              <EmptyState
                icon={SearchX}
                title="No decision matches"
                action={
                  <Button variant="neutral" onClick={() => setParams(filtersToSearch(EMPTY_FILTERS))}>
                    Clear filters
                  </Button>
                }
              >
                Nothing matches these filters{filters.q ? ` and the search “${filters.q}”` : ''}.
              </EmptyState>
            ) : (
              <EmptyState icon={FilePlus2} title="No decisions yet">
                Record the first one with <code className="font-mono">adrien new</code>, then reload.
              </EmptyState>
            )
          ) : (
            <>
              {meta.isError && !meta.data && <VerificationNotice onRetry={() => meta.refetch()} />}
              <p aria-live="polite" className="text-sm font-semibold text-muted-foreground">
                {results?.length} {results?.length === 1 ? 'result' : 'results'}
                {adrs.isFetching ? ', updating…' : ''}
              </p>
              <ul className={cn('space-y-4', adrs.isPlaceholderData && 'opacity-60')}>
                {results?.map((row) => (
                  <li key={`${row.layer}:${row.path}`}>
                    <DecisionCard row={row} verification={verification} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
