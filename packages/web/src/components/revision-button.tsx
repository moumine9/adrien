import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';

/** Copies the revision on click: it is what `--expect` and `base_revision` take. */
export function RevisionButton({ revision }: { revision: string }) {
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
        className="relative z-10 inline-flex items-center gap-1.5 chip-frame px-2 py-0.5 font-mono text-[0.8125rem] outline-none hover:bg-main focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
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
