import type { FileDecisions } from '@adrien/api/contract';
import { Box, FileCode } from 'lucide-react';
import { Chip } from '@/components/badges.tsx';
import { DecisionRow } from '@/components/decision-row.tsx';

/** `hasNotes` flags the product's own rows as unverified; `hasCommonNotes` does the same for the common log's rows. */
export function FileResult({
  entry,
  hasNotes,
  hasCommonNotes,
}: {
  entry: FileDecisions;
  hasNotes: boolean;
  hasCommonNotes: boolean;
}) {
  const binding = entry.decisions.filter((d) => d.binding).length;
  return (
    <section aria-label={entry.file} className="overflow-hidden panel shadow-shadow">
      <header className="space-y-2 border-b border-rule bg-background px-5 py-4">
        <div className="flex items-start gap-2">
          <FileCode aria-hidden className="mt-[calc((1lh-1.25rem)/2)] size-5 shrink-0" strokeWidth={2.5} />
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
            <DecisionRow key={`${d.layer}:${d.id}`} d={d} hasNotes={d.workspace === null ? hasNotes : hasCommonNotes} />
          ))}
        </ul>
      )}
    </section>
  );
}
