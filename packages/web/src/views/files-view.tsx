import type { FileDecisions } from '@adrien/api/contract';
import { Anchor, Box, FileCode, Info, Lightbulb } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BindingBadge, Chip, PendingBadge, StatusBadge } from '@/components/badges.tsx';
import { PendingBand } from '@/components/pending-band.tsx';
import { ErrorState, LoadingBlocks, PageHeader } from '@/components/states.tsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { parsePaths } from '@/lib/filters.ts';
import { useFor } from '@/lib/queries.ts';
import { fileBindingOf } from '@/lib/status.ts';

type Decision = FileDecisions['decisions'][number];

function MatchNote({ d }: { d: Decision }) {
  return d.match === 'anchor' ? (
    <span className="inline-flex flex-wrap items-center gap-2 text-sm">
      <Anchor aria-hidden className="size-3.5" strokeWidth={2.5} />
      Matched by the anchor <code className="font-mono break-all">{d.anchor}</code>
    </span>
  ) : (
    <span className="inline-flex items-center gap-2 text-sm">
      <Box aria-hidden className="size-3.5" strokeWidth={2.5} />
      Matched by its component
    </span>
  );
}

function DecisionRow({ d, hasNotes }: { d: Decision; hasNotes: boolean }) {
  const binding = fileBindingOf(d, hasNotes);
  return (
    <li className="space-y-2 px-5 py-4">
      {d.layer === 'pending' && <PendingBand className="-mx-5 -mt-4" />}
      <div className="flex flex-wrap items-center gap-2">
        <BindingBadge binding={binding} />
        {binding === 'not-binding' && (
          <span title="Not accepted on the default branch: worth knowing, not a rule." className="pill">
            <Lightbulb aria-hidden className="size-3.5" strokeWidth={2.5} />
            Hint only
          </span>
        )}
        <StatusBadge status={d.status} />
        {d.pending_kind && <PendingBadge kind={d.pending_kind} />}
      </div>
      <h3 className="text-lg leading-snug">
        <Link to={`/adr/${encodeURIComponent(d.id)}`} className="hover-underline">
          <span className="tabular-nums">{d.id}</span> {d.title}
        </Link>
      </h3>
      {d.review_rule && (
        <p className="max-w-[72ch] border-l-4 border-border pl-3">
          <span className="font-heading">Rule: </span>
          {d.review_rule}
        </p>
      )}
      <MatchNote d={d} />
    </li>
  );
}

function FileResult({ entry, hasNotes }: { entry: FileDecisions; hasNotes: boolean }) {
  const binding = entry.decisions.filter((d) => d.binding).length;
  return (
    <section aria-label={entry.file} className="overflow-hidden panel shadow-shadow">
      <header className="space-y-2 border-b border-rule bg-background px-5 py-3">
        <div className="flex items-start gap-2">
          <FileCode aria-hidden className="mt-0.5 size-5 shrink-0" strokeWidth={2.5} />
          <h2 className="min-w-0 flex-1 font-mono text-base font-semibold break-all">{entry.file}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-7">
          {entry.component && (
            <Chip icon={Box} className="bg-secondary-background">
              {entry.component}
            </Chip>
          )}
          {entry.decisions.length > 0 && (
            <span className="text-sm text-muted-foreground">
              {binding} binding, {entry.decisions.length - binding} other
            </span>
          )}
        </div>
      </header>
      {entry.decisions.length === 0 ? (
        <p className="px-5 py-4 text-muted-foreground">
          {entry.component
            ? 'No decision governs this file.'
            : 'This file is outside every declared component, so no decision applies to it.'}
        </p>
      ) : (
        <ul className="divide-y divide-rule">
          {entry.decisions.map((d) => (
            <DecisionRow key={`${d.layer}:${d.id}`} d={d} hasNotes={hasNotes} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function FilesView() {
  const [params, setParams] = useSearchParams();
  const paths = useMemo(() => parsePaths(params.getAll('path').join('\n')), [params]);
  const [draft, setDraft] = useState(paths.join('\n'));
  const fieldId = useId();
  const helpId = useId();
  const result = useFor(paths);

  useEffect(() => {
    setDraft(paths.join('\n'));
  }, [paths]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setParams(new URLSearchParams(parsePaths(draft).map((p) => ['path', p])));
  };

  const notes = result.data?.notes ?? [];

  return (
    <div className="space-y-8">
      <title>Files | Adrien</title>
      <PageHeader title="Which decisions govern these files?">
        The decisions that apply to each file, binding ones first, with the rule to check the code against.
      </PageHeader>

      <form onSubmit={submit} className="max-w-3xl space-y-3">
        <label htmlFor={fieldId} className="block font-heading">
          File paths
        </label>
        <p id={helpId} className="text-sm text-muted-foreground">
          One per line, relative to the folder where <code className="font-mono">adrien serve</code> was started.
        </p>
        <Textarea
          id={fieldId}
          aria-describedby={helpId}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e);
          }}
          rows={4}
          spellCheck={false}
          placeholder={'services/billing/src/payments/charge.ts\napps/checkout/src/search/index.ts'}
          className="min-h-28 font-mono text-[0.9375rem]"
        />
        <Button type="submit" size="lg" className="px-6 font-heading" disabled={parsePaths(draft).length === 0}>
          Find decisions
        </Button>
      </form>

      {paths.length > 0 &&
        (result.isPending ? (
          <LoadingBlocks label="Looking up the decisions" count={2} />
        ) : result.isError ? (
          <ErrorState title="Could not look up these files" error={result.error} onRetry={() => result.refetch()} />
        ) : (
          <div className="space-y-6">
            {notes.length > 0 && (
              <Alert className="bg-caution text-ink">
                <Info aria-hidden />
                <AlertTitle>Binding is not verified</AlertTitle>
                <AlertDescription>
                  {notes.map((n) => (
                    <p key={n}>{n}</p>
                  ))}
                </AlertDescription>
              </Alert>
            )}
            {result.data.files.map((f) => (
              <FileResult key={f.file} entry={f} hasNotes={notes.length > 0} />
            ))}
          </div>
        ))}
    </div>
  );
}
