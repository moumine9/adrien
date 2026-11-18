import { CircleAlert, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty.tsx';
import { Skeleton } from '@/components/ui/skeleton.tsx';
import { STATUS_STYLES } from '@/lib/status.ts';
import { cn } from '@/lib/utils.ts';

/** A failed request, with the API's own message and a way to try again. */
export function ErrorState({
  title,
  error,
  onRetry,
  children,
}: {
  title: string;
  error: unknown;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div
      role="alert"
      className="flex gap-4 rounded-base border-2 border-border bg-secondary-background p-5 shadow-shadow sm:p-6"
    >
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center rounded-base border-2 border-border text-ink"
        style={{ backgroundColor: STATUS_STYLES.rejected.fill }}
      >
        <CircleAlert className="size-5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 space-y-2">
        <h2 className="text-lg">{title}</h2>
        <p className="break-words text-muted-foreground">{message}</p>
        <div className="flex flex-wrap gap-3 pt-1">
          {onRetry && (
            <Button variant="neutral" onClick={onRetry}>
              Try again
            </Button>
          )}
          {children}
        </div>
      </div>
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
