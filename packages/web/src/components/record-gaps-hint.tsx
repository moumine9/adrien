import { Info } from 'lucide-react';
import type { Gap } from '@/lib/record-gaps.ts';

const SENTENCES: Record<Gap, string> = {
  deciders: 'No deciders are named.',
  confirmation: 'The Confirmation section is empty.',
};

/** A hint under the title of an accepted decision that leaves something out. It only informs; nothing depends on it. */
export function RecordGapsHint({ gaps }: { gaps: readonly Gap[] }) {
  if (gaps.length === 0) return null;
  return (
    <p className="notice bg-secondary-background py-1 print:hidden">
      <Info aria-hidden className="size-4" strokeWidth={2.5} />
      {gaps.map((gap) => SENTENCES[gap]).join(' ')}
    </p>
  );
}
