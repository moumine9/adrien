import { X } from 'lucide-react';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useChangeWatch } from '@/lib/change-watch.ts';
import { useSettings } from '@/lib/settings.ts';

export const TOAST_SECONDS = 8;

function message(changed: readonly string[]): string {
  return changed.length === 1 ? `${changed[0]} changed.` : `${changed.length} decisions changed.`;
}

/**
 * Tells the reader, once, that decisions changed while the page was open. The live region is mounted from the first
 * render, because a region that appears together with its text is not announced. It never takes focus and never
 * changes what is on the page: the lists refresh themselves, the notice only says that they did.
 */
export function ChangeToast({ dismissAfterMs = TOAST_SECONDS * 1000 }: { dismissAfterMs?: number }) {
  const { changed, dismiss } = useChangeWatch();
  const [settings] = useSettings();
  const key = changed.join(',');
  // A new change joins the notice and restarts the timer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for the content of `changed`.
  useEffect(() => {
    if (changed.length === 0) return;
    const timer = setTimeout(dismiss, dismissAfterMs);
    return () => clearTimeout(timer);
  }, [key, dismissAfterMs]);
  const show = settings.changeNotifications && changed.length > 0;
  return (
    <div
      data-testid="change-toast"
      aria-live="polite"
      className="pointer-events-none fixed right-4 bottom-4 left-4 z-40 sm:right-auto sm:max-w-md"
    >
      {show && (
        <div className="pointer-events-auto flex items-center gap-3 rounded-base border-2 border-l-8 border-border border-l-caution bg-secondary-background py-2 pr-2 pl-4 shadow-shadow">
          <p className="flex-1 font-heading">{message(changed)}</p>
          <Button variant="neutral" size="icon" onClick={dismiss} aria-label="Dismiss" title="Dismiss">
            <X aria-hidden />
          </Button>
        </div>
      )}
    </div>
  );
}
