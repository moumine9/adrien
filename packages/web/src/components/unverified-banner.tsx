import type { MetaResponse } from '@adrien/api/contract';
import { TriangleAlert } from 'lucide-react';

export function UnverifiedBanner({ meta }: { meta: MetaResponse }) {
  if (!meta.baseUnresolved && !meta.forkUnresolved) return null;
  return (
    <div role="alert" className="bg-secondary-background">
      {/* The tape strip is the only divide between the header rule above and this banner. */}
      <div aria-hidden className="caution-tape h-2.5" />
      <div className="mx-auto flex max-w-6xl gap-4 px-4 py-4 sm:px-6">
        <TriangleAlert aria-hidden className="mt-[calc((1lh-1.25rem)/2)] size-5 shrink-0" strokeWidth={2.5} />
        {meta.baseUnresolved ? (
          <p className="max-w-[80ch]">
            <strong className="font-heading">No default branch found.</strong> Statuses are read as written, so nothing
            here is verified as binding: an ADR marked accepted may never have been merged. Fetch the default branch
            (for example <code className="font-mono text-[0.875em]">git fetch origin</code>), then reload.
          </p>
        ) : (
          <p className="max-w-[80ch]">
            <strong className="font-heading">This checkout shares no history with the default branch.</strong> Pending
            changes cannot be told apart from merged ones, so nothing here is verified as binding. Fetch more history
            (for example <code className="font-mono text-[0.875em]">git fetch --unshallow</code>), then reload.
          </p>
        )}
      </div>
    </div>
  );
}
