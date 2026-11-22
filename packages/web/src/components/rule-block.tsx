import { Stamp } from 'lucide-react';
import { PendingBand } from '@/components/pending-band.tsx';
import type { Binding } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';

export function RuleBlock({ rule, binding }: { rule: string | undefined; binding: Binding }) {
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
        'overflow-hidden frame',
        strong ? 'bg-foreground text-background shadow-shadow' : 'bg-secondary-background',
        binding === 'pending' && 'border-dashed',
      )}
    >
      {binding === 'pending' && <PendingBand />}
      <div className="p-5 sm:p-6">
        <h2 id="rule-heading" className="flex items-center gap-2 text-base">
          <Stamp aria-hidden className="size-5" strokeWidth={2.5} />
          {heading[binding]}
        </h2>
        {rule ? (
          <p className="mt-4 max-w-[60ch] text-xl leading-snug font-semibold sm:text-2xl">{rule}</p>
        ) : (
          <p className="mt-4 opacity-80">No review rule is written for this decision.</p>
        )}
      </div>
    </section>
  );
}
