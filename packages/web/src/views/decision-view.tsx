import { ArrowLeft, Replace, Swords } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { BindingBadge, DueBadge, PendingBadge, StatusBadge } from '@/components/badges.tsx';
import { ErrorState } from '@/components/error-state.tsx';
import { FactsPanel } from '@/components/facts-panel.tsx';
import { AdrMarkdown } from '@/components/markdown.tsx';
import { PendingSection, pendingFileOf } from '@/components/pending-section.tsx';
import { RuleBlock } from '@/components/rule-block.tsx';
import { VersionStamp } from '@/components/stamp.tsx';
import { LoadingBlocks } from '@/components/states.tsx';
import { Button, buttonVariants } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { ApiRequestError } from '@/lib/api.ts';
import { useChangedSinceOpened } from '@/lib/change-watch.ts';
import { useAdr, useFileResolver, useGraph, useMeta } from '@/lib/queries.ts';
import { authorityOf, isReviewDue } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';

function DetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-12 w-full max-w-2xl" />
      <Skeleton className="h-32 w-full" />
      <LoadingBlocks label="Loading the decision" count={2} className="h-48" />
    </div>
  );
}

export function DecisionView() {
  const { id = '' } = useParams();
  const adr = useAdr(id);
  const outOfDate = useChangedSinceOpened(id, { revision: adr.data?.revision, loadedAt: adr.dataUpdatedAt });
  const resolveFile = useFileResolver();
  const meta = useMeta();
  const graph = useGraph();

  const back = (
    <Link to="/" className="inline-flex items-center gap-2 rounded-base font-heading hover-underline print:hidden">
      <ArrowLeft aria-hidden className="size-4" strokeWidth={2.5} />
      All decisions
    </Link>
  );

  if (adr.isPending) return <DetailSkeleton />;
  if (adr.isError) {
    const notFound =
      adr.error instanceof ApiRequestError && (adr.error.status === 404 || adr.error.code === 'ADR_NOT_FOUND');
    return (
      <div className="space-y-6">
        {back}
        <ErrorState
          title={notFound ? `No decision ${id}` : 'Could not load this decision'}
          error={adr.error}
          onRetry={notFound ? undefined : () => adr.refetch()}
        >
          <Link to="/" className={buttonVariants({ variant: 'neutral' })}>
            Back to the decisions
          </Link>
        </ErrorState>
      </div>
    );
  }

  const data = adr.data;
  const pendingFile = pendingFileOf(data.pending);
  const primary = data.base ?? pendingFile;
  if (!primary) {
    return (
      <div className="space-y-6">
        {back}
        <ErrorState title={`No decision ${id}`} error={new Error('The server returned no version of it.')} />
      </div>
    );
  }
  const m = primary.meta;
  const onlyPending = !data.base;
  const { binding, sentence } = authorityOf({ status: m.status, layer: onlyPending ? 'pending' : 'base' }, meta.data);
  const nodes = new Map((graph.data?.nodes ?? []).map((n) => [n.id, n]));

  return (
    <article className="decision-record space-y-8">
      <title>{`${m.id}: ${m.title} | Adrien`}</title>
      {back}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-lg font-heading tabular-nums">{m.id}</span>
          <StatusBadge status={m.status} />
          <BindingBadge binding={binding} />
          {data.pending && <PendingBadge kind={data.pending.kind} />}
          {m.contested && (
            <span className="pill">
              <Swords aria-hidden className="size-3.5" strokeWidth={2.5} />
              Contested
            </span>
          )}
          {isReviewDue(m) && <DueBadge />}
        </div>
        <h1 className="display max-w-[24ch] text-3xl sm:text-5xl" style={{ fontStretch: '115%' }}>
          {m.title}
        </h1>
        <p className="text-lg font-heading">{sentence}</p>
        <VersionStamp revision={data.revision} modifiedAt={data.modifiedAt} />
        {outOfDate && (
          <p className="notice bg-caution py-1 text-ink print:hidden">
            <span className="font-heading">Changed since you opened this</span>
            <Button
              variant="neutral"
              onClick={() => {
                // The button goes away when the new version arrives: keep focus on the page.
                document.getElementById('main')?.focus({ preventScroll: true });
                void adr.refetch();
              }}
            >
              Reload
            </Button>
          </p>
        )}
        {m.status === 'superseded' && m.superseded_by && (
          <p className="notice bg-secondary-background py-2">
            <Replace aria-hidden className="size-4" strokeWidth={2.5} />
            Replaced by
            <Link
              to={`/adr/${encodeURIComponent(m.superseded_by)}`}
              className="font-heading underline decoration-2 underline-offset-4"
            >
              {m.superseded_by}
              {nodes.get(m.superseded_by) ? `: ${nodes.get(m.superseded_by)?.title}` : ''}
            </Link>
          </p>
        )}
      </header>

      <RuleBlock rule={m.review_rule} binding={binding} />
      {onlyPending && <PendingSection data={data} />}

      <div className="decision-record-content grid gap-8 lg:grid-cols-12">
        <section
          aria-label="Decision record"
          className={cn('min-w-0 panel p-5 sm:p-8 lg:col-span-8 lg:self-start', onlyPending && 'border-dashed')}
        >
          {primary.body.trim() ? (
            <AdrMarkdown source={primary.body} resolveFile={resolveFile} />
          ) : (
            <p className="text-muted-foreground">This decision has no text beyond its frontmatter.</p>
          )}
        </section>
        <aside className="lg:col-span-4">
          <FactsPanel file={primary} nodes={nodes} />
        </aside>
      </div>

      {!onlyPending && <PendingSection data={data} />}
    </article>
  );
}
