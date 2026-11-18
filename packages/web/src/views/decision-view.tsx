import type { AdrFile, AdrMeta, AdrResponse, GraphNode } from '@adrien/api/contract';
import { ArrowLeft, Bot, Box, ExternalLink, Pickaxe, Replace, Stamp, Swords, Tag, UserPen } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { BindingBadge, Chip, DueBadge, PendingBadge, STATUS_ICONS, StatusBadge } from '@/components/badges.tsx';
import { AdrMarkdown } from '@/components/markdown.tsx';
import { ErrorState, LoadingBlocks } from '@/components/states.tsx';
import { buttonVariants } from '@/components/ui/button.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { ApiRequestError } from '@/lib/api.ts';
import { useAdr, useGraph, useMeta } from '@/lib/queries.ts';
import { type Binding, bindingOf, isReviewDue, STATUS_STYLES, verificationOf } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';

const ORIGIN: Record<AdrMeta['origin'], { label: string; icon: typeof Bot }> = {
  manual: { label: 'Written by a person', icon: UserPen },
  agent: { label: 'Proposed by an AI agent', icon: Bot },
  mined: { label: 'Mined from history', icon: Pickaxe },
};

const pendingFileOf = (pending: AdrResponse['pending']): AdrFile | null =>
  pending && pending.kind !== 'deleted' && pending.meta
    ? { meta: pending.meta, body: pending.body ?? '', path: pending.path ?? '' }
    : null;

function RuleBlock({ rule, binding }: { rule: string | undefined; binding: Binding }) {
  const heading: Record<Binding, string> = {
    binding: 'The binding rule',
    unverified: 'The rule, binding if merged',
    pending: 'Proposed rule, not binding',
    'not-binding': 'The rule, not in force',
  };
  const strong = binding === 'binding';
  return (
    <section
      aria-labelledby="rule-heading"
      className={cn(
        'rounded-base border-4 border-border p-5 sm:p-6',
        strong ? 'bg-foreground text-background shadow-shadow' : 'bg-secondary-background',
        binding === 'pending' && 'hatch border-dashed',
      )}
    >
      <h2 id="rule-heading" className="flex items-center gap-2 text-base">
        <Stamp aria-hidden className="size-5" strokeWidth={2.5} />
        {heading[binding]}
      </h2>
      {rule ? (
        <p className="mt-3 max-w-[60ch] text-xl leading-snug font-semibold sm:text-2xl">{rule}</p>
      ) : (
        <p className="mt-3 opacity-80">No review rule is written for this decision.</p>
      )}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b-2 border-border py-3 last:border-b-0">
      <dt className="text-sm font-heading text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function AdrLink({ id, node }: { id: string; node: GraphNode | undefined }) {
  const Icon = node ? STATUS_ICONS[node.status] : null;
  return (
    <Link
      to={`/adr/${encodeURIComponent(id)}`}
      className="group flex items-start gap-2 rounded-base py-1 hover:underline hover:decoration-2 hover:underline-offset-4"
    >
      {node && Icon && (
        <span
          title={STATUS_STYLES[node.status].label}
          className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-[3px] border-2 border-border text-ink"
          style={{ backgroundColor: STATUS_STYLES[node.status].fill }}
        >
          <Icon aria-hidden className="size-3" strokeWidth={3} />
          <span className="sr-only">{STATUS_STYLES[node.status].label}: </span>
        </span>
      )}
      <span>
        <span className="font-heading tabular-nums">{id}</span>
        {node && <span className="text-muted-foreground"> {node.title}</span>}
      </span>
    </Link>
  );
}

function FactsPanel({ file, nodes }: { file: AdrFile; nodes: Map<string, GraphNode> }) {
  const m = file.meta;
  const origin = ORIGIN[m.origin];
  const due = isReviewDue(m);
  const links: Array<[string, string[]]> = [
    ['Supersedes', m.supersedes],
    ['Superseded by', m.superseded_by ? [m.superseded_by] : []],
    ['Related', m.related],
  ];
  return (
    <div className="space-y-6">
      <section
        aria-labelledby="facts-heading"
        className="rounded-base border-2 border-border bg-secondary-background px-5 py-2"
      >
        <h2 id="facts-heading" className="sr-only">
          Facts
        </h2>
        <dl>
          <Fact label="Status">
            <StatusBadge status={m.status} />
          </Fact>
          {m.date && <Fact label="Date">{m.date}</Fact>}
          {m.review_on && (
            <Fact label="Review on">
              <span className="inline-flex flex-wrap items-center gap-2">
                {m.review_on}
                {due && <DueBadge />}
              </span>
            </Fact>
          )}
          {m.tags.length > 0 && (
            <Fact label="Tags">
              <span className="flex flex-wrap gap-1.5">
                {m.tags.map((t) => (
                  <Chip key={t} icon={Tag}>
                    {t}
                  </Chip>
                ))}
              </span>
            </Fact>
          )}
          {m.components.length > 0 && (
            <Fact label="Components">
              <span className="flex flex-wrap gap-1.5">
                {m.components.map((c) => (
                  <Chip key={c} icon={Box}>
                    {c}
                  </Chip>
                ))}
              </span>
            </Fact>
          )}
          {m.code.length > 0 && (
            <Fact label="Code anchors">
              <ul className="space-y-1">
                {m.code.map((c) => (
                  <li key={c} className="font-mono text-sm">
                    {c}
                  </li>
                ))}
              </ul>
            </Fact>
          )}
          {m.sources.length > 0 && (
            <Fact label="Sources">
              <ul className="space-y-1">
                {m.sources.map((s) => (
                  <li key={s}>
                    {/^https?:\/\//i.test(s) ? (
                      <a
                        href={s}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 break-all font-semibold underline decoration-2 underline-offset-2"
                      >
                        {s}
                        <ExternalLink aria-hidden className="size-3.5 shrink-0" />
                      </a>
                    ) : (
                      s
                    )}
                  </li>
                ))}
              </ul>
            </Fact>
          )}
          {m.deciders.length > 0 && <Fact label="Deciders">{m.deciders.join(', ')}</Fact>}
          <Fact label="Origin">
            <span className="inline-flex items-center gap-2">
              <origin.icon aria-hidden className="size-4" strokeWidth={2.5} />
              {origin.label}
            </span>
          </Fact>
          <Fact label="Contested">{m.contested ? 'Yes, people disagree with this decision' : 'No'}</Fact>
          <Fact label="File">
            <span className="font-mono text-sm">{file.path}</span>
          </Fact>
        </dl>
      </section>

      {links.some(([, ids]) => ids.length > 0) && (
        <section aria-labelledby="links-heading" className="space-y-3">
          <h2 id="links-heading" className="text-lg">
            Linked decisions
          </h2>
          {links
            .filter(([, ids]) => ids.length > 0)
            .map(([label, ids]) => (
              <div key={label}>
                <h3 className="text-sm text-muted-foreground">{label}</h3>
                <ul>
                  {ids.map((id) => (
                    <li key={id}>
                      <AdrLink id={id} node={nodes.get(id)} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </section>
      )}
    </div>
  );
}

const CHANGED_FIELDS: Array<[keyof AdrMeta, string]> = [
  ['title', 'Title'],
  ['status', 'Status'],
  ['review_rule', 'Rule'],
  ['review_on', 'Review on'],
  ['tags', 'Tags'],
  ['components', 'Components'],
  ['code', 'Code anchors'],
  ['contested', 'Contested'],
  ['supersedes', 'Supersedes'],
  ['superseded_by', 'Superseded by'],
  ['related', 'Related'],
];

function show(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ') || 'none';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v === undefined || v === '' ? 'none' : String(v);
}

/** What a pending edit changes, field by field: the default branch on the left, this checkout on the right. */
function Changes({ before, after }: { before: AdrMeta; after: AdrMeta }) {
  const changed = CHANGED_FIELDS.filter(([k]) => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
  if (changed.length === 0) return <p>The frontmatter is unchanged; only the text differs.</p>;
  return (
    <dl className="space-y-3">
      {changed.map(([k, label]) => (
        <div key={k} className="grid gap-2 sm:grid-cols-[8rem_1fr_1fr]">
          <dt className="font-heading">{label}</dt>
          <dd className="rounded-base border-2 border-border bg-secondary-background p-3">
            <span className="block text-sm font-heading text-muted-foreground">On the default branch</span>
            {show(before[k])}
          </dd>
          <dd className="rounded-base border-2 border-dashed border-border bg-secondary-background p-3">
            <span className="block text-sm font-heading text-muted-foreground">In this checkout</span>
            {show(after[k])}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function PendingSection({ data }: { data: AdrResponse }) {
  const pending = data.pending;
  if (!pending) return null;
  const file = pendingFileOf(pending);
  return (
    <section
      aria-labelledby="pending-heading"
      className="hatch space-y-5 rounded-base border-4 border-dashed border-border bg-secondary-background p-5 sm:p-6"
    >
      <div className="space-y-3">
        <PendingBadge kind={pending.kind} />
        <h2 id="pending-heading" className="text-2xl">
          Pending in this checkout, not binding until merged
        </h2>
        {pending.kind === 'deleted' && (
          <p className="max-w-[68ch]">
            This checkout removes the decision. Until that removal is merged, the version on the default branch still
            applies.
          </p>
        )}
        {pending.kind === 'modified' && (
          <p className="max-w-[68ch]">
            This checkout edits the decision. The version above stays the one that applies until the edit is merged.
          </p>
        )}
        {pending.kind === 'added' && (
          <p className="max-w-[68ch]">
            This decision exists only in this checkout. It is a proposal, whatever its status says, until it is merged
            into the default branch.
          </p>
        )}
      </div>
      {pending.kind === 'modified' && data.base && file && <Changes before={data.base.meta} after={file.meta} />}
      {pending.kind === 'modified' && file && (
        <details className="rounded-base border-2 border-border bg-secondary-background">
          <summary className="cursor-pointer px-4 py-3 font-heading">Read the edited text</summary>
          <div className="border-t-2 border-border px-4 py-4">
            <AdrMarkdown source={file.body} />
          </div>
        </details>
      )}
    </section>
  );
}

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
  const meta = useMeta();
  const graph = useGraph();
  const verification = verificationOf(meta.data);

  const back = (
    <Link
      to="/"
      className="inline-flex items-center gap-2 rounded-base font-heading hover:underline hover:decoration-2 hover:underline-offset-4"
    >
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
  const binding = bindingOf({ status: m.status, layer: onlyPending ? 'pending' : 'base' }, verification);
  const nodes = new Map((graph.data?.nodes ?? []).map((n) => [n.id, n]));

  return (
    <article className="space-y-8">
      <title>{`${m.id}: ${m.title} | Adrien`}</title>
      {back}
      <header className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-lg font-heading tabular-nums">{m.id}</span>
          <StatusBadge status={m.status} />
          <BindingBadge binding={binding} />
          {data.pending && <PendingBadge kind={data.pending.kind} />}
          {m.contested && (
            <span className="inline-flex h-6 items-center gap-1.5 rounded-base border-2 border-border bg-secondary-background px-2 text-[0.8125rem] font-heading">
              <Swords aria-hidden className="size-3.5" strokeWidth={2.5} />
              Contested
            </span>
          )}
          {isReviewDue(m) && <DueBadge />}
        </div>
        <h1 className="max-w-[24ch] text-3xl leading-[1.08] sm:text-5xl" style={{ fontStretch: '115%' }}>
          {m.title}
        </h1>
        {m.status === 'superseded' && m.superseded_by && (
          <p className="inline-flex flex-wrap items-center gap-2 rounded-base border-2 border-border bg-secondary-background px-3 py-2">
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

      {onlyPending && <PendingSection data={data} />}
      <RuleBlock rule={m.review_rule} binding={binding} />

      <div className="grid gap-8 lg:grid-cols-12">
        <section
          aria-label="Decision record"
          className={cn(
            'min-w-0 rounded-base border-2 border-border bg-secondary-background p-5 sm:p-8 lg:col-span-8 lg:self-start',
            onlyPending && 'border-dashed',
          )}
        >
          {primary.body.trim() ? (
            <AdrMarkdown source={primary.body} />
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
