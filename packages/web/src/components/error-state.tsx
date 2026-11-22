import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { STATUS_STYLES } from '@/lib/status.ts';

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
    <div role="alert" className="flex gap-4 panel p-5 shadow-shadow sm:p-6">
      <span
        aria-hidden
        className="grid size-10 shrink-0 place-items-center frame text-ink"
        style={{ backgroundColor: STATUS_STYLES.rejected.fill }}
      >
        <CircleAlert className="size-5" strokeWidth={2.5} />
      </span>
      <div className="min-w-0 space-y-2">
        <h2 className="text-lg">{title}</h2>
        <p className="break-words text-muted-foreground">{message}</p>
        <div className="flex flex-wrap gap-2 pt-1">
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
