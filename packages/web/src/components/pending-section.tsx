import type { AdrFile, AdrResponse } from '@adrien/api/contract';
import { PendingBadge } from '@/components/badges.tsx';
import { Changes } from '@/components/changes-panel.tsx';
import { AdrMarkdown } from '@/components/markdown.tsx';
import { PendingBand } from '@/components/pending-band.tsx';
import { useFileResolver } from '@/lib/queries.ts';

export const pendingFileOf = (pending: AdrResponse['pending']): AdrFile | null =>
  pending && pending.kind !== 'deleted' && pending.meta
    ? { meta: pending.meta, body: pending.body ?? '', path: pending.path ?? '' }
    : null;

export function PendingSection({ data }: { data: AdrResponse }) {
  const resolveFile = useFileResolver();
  const pending = data.pending;
  if (!pending) return null;
  const file = pendingFileOf(pending);
  return (
    <section
      aria-labelledby="pending-heading"
      className="overflow-hidden rounded-base border-2 border-dashed border-border bg-secondary-background"
    >
      <PendingBand />
      <div className="space-y-5 p-5 sm:p-6">
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
          <details className="panel">
            <summary className="cursor-pointer px-4 py-3 font-heading">Read the edited text</summary>
            <div className="border-t border-rule px-4 py-4">
              <AdrMarkdown source={file.body} resolveFile={resolveFile} />
            </div>
          </details>
        )}
      </div>
    </section>
  );
}
