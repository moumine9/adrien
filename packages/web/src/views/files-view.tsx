import { Info } from 'lucide-react';
import { type FormEvent, useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { FileResult } from '@/components/file-result.tsx';
import { ErrorState, LoadingBlocks, PageHeader } from '@/components/states.tsx';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert.tsx';
import { Button } from '@/components/ui/button.tsx';
import { Textarea } from '@/components/ui/textarea.tsx';
import { parsePaths } from '@/lib/filters.ts';
import { useFor } from '@/lib/queries.ts';

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

      <form onSubmit={submit} className="max-w-3xl space-y-4">
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
