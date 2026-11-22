import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { cn } from '@/lib/utils.ts';

/**
 * Shown when the log's metadata could not be fetched: accepted decisions are then drawn as unverified (never as
 * binding), and this says why, with a way to ask again.
 */
export function VerificationNotice({ onRetry }: { onRetry: () => void }) {
  return (
    <div
      role="status"
      aria-label="Decisions could not be verified"
      className="flex flex-wrap items-center gap-2 frame bg-caution px-4 py-2 text-ink"
    >
      <p className="min-w-0 flex-1">
        Could not check the default branch, so accepted decisions are shown as unverified.
      </p>
      <Button
        variant="neutral"
        onClick={() => {
          // The notice goes away when the check succeeds: keep focus on the page, not on the removed button.
          document.getElementById('main')?.focus({ preventScroll: true });
          onRetry();
        }}
      >
        Check again
      </Button>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <Empty className="bg-secondary-background">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle className="text-lg">{title}</EmptyTitle>
        {children && <EmptyDescription className="text-muted-foreground">{children}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** Placeholder blocks while data loads; announced once to screen readers. */
export function LoadingBlocks({ label, count = 3, className }: { label: string; count?: number; className?: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-4">
      {Array.from({ length: count }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: identical placeholders with no identity of their own.
        <Skeleton key={i} className={cn('h-32 w-full', className)} />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl sm:text-4xl" style={{ fontStretch: '118%' }}>
        {title}
      </h1>
      {children && <div className="max-w-[68ch] text-muted-foreground">{children}</div>}
    </div>
  );
}
