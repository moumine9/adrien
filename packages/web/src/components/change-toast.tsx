import { useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useMatch } from 'react-router';
import { Button } from '@/components/ui/button.tsx';
import { useChangedSinceOpened, useChangeWatch } from '@/lib/change-watch.ts';
import { useAdr } from '@/lib/queries.ts';
import { cn } from '@/lib/utils.ts';

export const TOAST_SECONDS = 8;
export const UPDATED_MS = 2000;

function message(changed: readonly string[], open: string | undefined): string {
  if (open && changed.length === 1) return `${open} changed.`;
  if (open) return `${open} and ${changed.length - 1} more changed.`;
  return changed.length === 1 ? `${changed[0]} changed.` : `${changed.length} decisions changed.`;
}

/**
 * Tells the reader, once, that decisions changed while the page was open. The live region is mounted from the first
 * render, because a region that appears together with its text is not announced; it holds the sentence only, so the
 * buttons are not read out with it. The notice never takes focus and never changes what is on the page: the lists
 * refresh themselves, the notice only says that they did. On the decision being read it stays until the reader presses
 * Reload (the decision never changes by itself) or dismisses it. It waits while the pointer or focus is on it.
 */
export function ChangeToast({
  dismissAfterMs = TOAST_SECONDS * 1000,
  updatedForMs = UPDATED_MS,
}: {
  dismissAfterMs?: number;
  updatedForMs?: number;
}) {
  const { changed, version, dismiss, forget } = useChangeWatch();
  const client = useQueryClient();
  const match = useMatch('/adr/:id');
  // The router has already decoded the id.
  const openId = match?.params.id;
  // The decision on screen, as loaded: the notice is about the version the reader is looking at, not the latest one.
  const adr = useAdr(openId ?? '');
  const shown = adr.data?.revision;
  const outOfDate = useChangedSinceOpened(openId ?? '', { revision: shown, loadedAt: adr.dataUpdatedAt });
  const openChanged = openId !== undefined && changed.includes(openId) && outOfDate;
  // Once the page shows the latest version, by either Reload, the notice about it is stale.
  useEffect(() => {
    if (openId !== undefined && !outOfDate && shown !== undefined) forget(openId);
  }, [openId, outOfDate, shown, forget]);
  // The pointer and focus are tracked apart: the notice waits while either one is on it.
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [updated, setUpdated] = useState(false);
  const held = hovered || focused;
  const box = useRef<HTMLDivElement>(null);
  const showChanges = changed.length > 0;
  const show = showChanges || updated;
  // A new change joins the notice and restarts the timer. A change to the decision being read waits for the reader.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `version` stands for "something changed again".
  useEffect(() => {
    if (!showChanges || openChanged || held) return;
    const timer = setTimeout(dismiss, dismissAfterMs);
    return () => clearTimeout(timer);
  }, [showChanges, openChanged, held, version, dismissAfterMs]);
  useEffect(() => {
    if (!updated) return;
    const timer = setTimeout(() => setUpdated(false), updatedForMs);
    return () => clearTimeout(timer);
  }, [updated, updatedForMs]);
  // However the notice went away (button, timer, or the setting), nothing is on it any more.
  useEffect(() => {
    if (show) return;
    setHovered(false);
    setFocused(false);
  }, [show]);
  const handFocusToPage = () => {
    // The button the reader pressed is about to go away: give focus to the page rather than to nothing.
    if (box.current?.contains(document.activeElement)) document.getElementById('main')?.focus({ preventScroll: true });
  };
  const close = () => {
    handFocusToPage();
    dismiss();
  };
  const reload = async () => {
    if (!openId) return;
    handFocusToPage();
    await client.refetchQueries({ queryKey: ['adr', openId] });
    // A failed reload leaves the old version on screen, so the notice stays and nothing is "Updated".
    if (client.getQueryState(['adr', openId])?.status === 'error') return;
    forget(openId);
    setUpdated(true);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the handlers only watch the pointer and focus to hold the timer; nothing here acts on a click.
    <div
      ref={box}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      className={cn(
        'fixed right-[max(1rem,env(safe-area-inset-right))] bottom-[max(1rem,env(safe-area-inset-bottom))] left-[max(1rem,env(safe-area-inset-left))] z-40 sm:right-auto sm:max-w-md',
        show &&
          'toast-enter flex items-center gap-3 rounded-base border-2 border-l-8 border-border border-l-caution bg-secondary-background py-2 pr-2 pl-4 shadow-shadow',
        !show && 'pointer-events-none',
      )}
    >
      <p data-testid="change-toast" aria-live="polite" className="flex-1 font-heading">
        {showChanges ? message(changed, openChanged ? openId : undefined) : updated ? 'Updated.' : null}
      </p>
      {showChanges && openChanged && (
        <Button onClick={() => void reload()} aria-label={`Reload ${openId}`}>
          Reload
        </Button>
      )}
      {showChanges && (
        <Button variant="neutral" size="icon" onClick={close} aria-label="Dismiss" title="Dismiss">
          <X aria-hidden />
        </Button>
      )}
    </div>
  );
}
