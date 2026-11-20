import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button.tsx';
import { useChangeWatch } from '@/lib/change-watch.ts';
import { cn } from '@/lib/utils.ts';

export const TOAST_SECONDS = 8;

function message(changed: readonly string[]): string {
  return changed.length === 1 ? `${changed[0]} changed.` : `${changed.length} decisions changed.`;
}

/**
 * Tells the reader, once, that decisions changed while the page was open. The live region is mounted from the first
 * render, because a region that appears together with its text is not announced; it holds the sentence only, so the
 * button is not read out with it. The notice never takes focus and never changes what is on the page: the lists
 * refresh themselves, the notice only says that they did. It waits while the pointer or focus is on it.
 */
export function ChangeToast({ dismissAfterMs = TOAST_SECONDS * 1000 }: { dismissAfterMs?: number }) {
  const { changed, version, dismiss } = useChangeWatch();
  const [held, setHeld] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const show = changed.length > 0;
  // A new change joins the notice and restarts the timer.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` stands for "something changed again".
  useEffect(() => {
    if (!show || held) return;
    const timer = setTimeout(dismiss, dismissAfterMs);
    return () => clearTimeout(timer);
  }, [show, held, version, dismissAfterMs]);
  const close = () => {
    // The button the reader pressed is about to go away: give focus to the page rather than to nothing.
    const hadFocus = box.current?.contains(document.activeElement);
    dismiss();
    setHeld(false);
    if (hadFocus) document.getElementById('main')?.focus({ preventScroll: true });
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only watch the pointer and focus to hold the timer; nothing here acts on a click.
    <div
      ref={box}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
      className={cn(
        'fixed right-4 bottom-4 left-4 z-40 sm:right-auto sm:max-w-md',
        show &&
          'flex items-center gap-3 rounded-base border-2 border-l-8 border-border border-l-caution bg-secondary-background py-2 pr-2 pl-4 shadow-shadow',
        !show && 'pointer-events-none',
      )}
    >
      <p data-testid="change-toast" aria-live="polite" className="flex-1 font-heading">
        {show ? message(changed) : null}
      </p>
      {show && (
        <Button variant="neutral" size="icon" onClick={close} aria-label="Dismiss" title="Dismiss">
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
