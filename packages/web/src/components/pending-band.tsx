import { cn } from '@/lib/utils.ts';

/**
 * The hatched band along the top edge of a pending object. It is decorative and never sits under text: the dashed
 * border and the "not binding" badge already say "pending", so the body stays plain.
 */
export function PendingBand({ className }: { className?: string }) {
  return <div aria-hidden className={cn('hatch h-2 shrink-0', className)} />;
}
