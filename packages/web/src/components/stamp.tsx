import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSettings } from '@/lib/settings.ts';
import { exactTime, relativeTime } from '@/lib/time.ts';
import { cn } from '@/lib/utils.ts';

/** Copies the revision on click: it is what `--expect` and `base_revision` take. */
function RevisionButton({ revision }: { revision: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(revision);
      setCopied(true);
    } catch {
      // Clipboard blocked: the revision is still on screen to select.
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={copy}
        title="Copy revision"
        aria-label={`Copy revision ${revision}`}
        className="relative z-10 inline-flex items-center gap-1.5 rounded-inset border-2 border-border bg-secondary-background px-2 py-0.5 font-mono text-[0.8125rem] outline-none hover:bg-main focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
        {revision}
      </button>
      <span role="status" className="text-sm text-muted-foreground">
        {copied ? 'Copied' : ''}
      </span>
    </span>
  );
}

/**
 * When the version in this checkout last changed, and its revision. The time is relative, with the exact one in a tooltip
 * and in the accessible name. The revision is hidden by the "Show revision" setting; with nothing to show, nothing renders.
 */
export function VersionStamp({
  revision,
  modifiedAt,
  className,
}: {
  revision: string | null | undefined;
  modifiedAt: string | null | undefined;
  className?: string;
}) {
  const [settings] = useSettings();
  const showRevision = settings.showRevision && !!revision;
  if (!modifiedAt && !showRevision) return null;
  const exact = modifiedAt ? exactTime(modifiedAt) : '';
  const relativeText = modifiedAt ? relativeTime(modifiedAt) : '';
  return (
    <p className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 text-sm', className)}>
      {modifiedAt && (
        <time dateTime={modifiedAt} title={exact}>
          <span aria-hidden>Changed {relativeText}</span>
          <span className="sr-only">
            Changed {relativeText}, {exact}
          </span>
        </time>
      )}
      {showRevision && revision && <RevisionButton revision={revision} />}
    </p>
  );
}
