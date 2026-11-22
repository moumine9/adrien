import { RevisionButton } from '@/components/revision-button.tsx';
import { useSettings } from '@/lib/settings.ts';
import { exactTime, relativeTime } from '@/lib/time.ts';
import { cn } from '@/lib/utils.ts';

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
        <time dateTime={modifiedAt} title={exact} className="relative z-10">
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
