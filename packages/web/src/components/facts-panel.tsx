import type { AdrFile, AdrMeta, GraphNode } from '@adrien/api/contract';
import { Bot, Box, ExternalLink, Pickaxe, Tag, UserPen } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Chip, DueBadge, STATUS_ICONS, StatusBadge } from '@/components/badges.tsx';
import { isReviewDue, STATUS_STYLES } from '@/lib/status.ts';
import { useWorkspacePath } from '@/lib/workspace.ts';

const ORIGIN: Record<AdrMeta['origin'], { label: string; icon: typeof Bot }> = {
  manual: { label: 'Written by a person', icon: UserPen },
  agent: { label: 'Proposed by an AI agent', icon: Bot },
  mined: { label: 'Mined from history', icon: Pickaxe },
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-rule py-2 last:border-b-0">
      <dt className="text-sm font-heading text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

function AdrLink({ id, node }: { id: string; node: GraphNode | undefined }) {
  const Icon = node ? STATUS_ICONS[node.status] : null;
  const wp = useWorkspacePath();
  return (
    <Link
      to={wp(`/adr/${encodeURIComponent(id)}`)}
      className="group flex items-start gap-2 rounded-base py-1 hover-underline"
    >
      {node && Icon && (
        <span
          data-status={node.status}
          title={STATUS_STYLES[node.status].label}
          className="mt-[calc((1lh-1.25rem)/2)] grid size-5 shrink-0 place-items-center rounded-inset border-2 border-border text-ink"
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

export function FactsPanel({ file, nodes }: { file: AdrFile; nodes: Map<string, GraphNode> }) {
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
      <section aria-labelledby="facts-heading" className="panel px-5 py-2">
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
              <span className="flex flex-wrap gap-1">
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
              <span className="flex flex-wrap gap-1">
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
        <section aria-labelledby="links-heading" className="space-y-4">
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
                      {/* A workspace/ADR-n names a decision of another log, which this log cannot link to; an id of this log wins. */}
                      {id.includes('/') && !nodes.has(id) ? (
                        <span className="block py-1">{id}</span>
                      ) : (
                        <AdrLink id={id} node={nodes.get(id)} />
                      )}
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
