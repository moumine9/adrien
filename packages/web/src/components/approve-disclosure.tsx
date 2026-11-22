import { Check, ChevronDown, Copy } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button.tsx';

/** Shows the command that approves a proposal. Approval is a merge, so the board never changes a status itself. */
export function ApproveDisclosure({ id }: { id: string }) {
  const command = `adrien accept ${id}`;
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied('copied');
    } catch {
      // No clipboard (an insecure page, or a browser that refuses): the command stays on screen to copy by hand.
      setCopied('failed');
    }
  };

  return (
    <details className="group frame bg-background">
      <summary className="flex h-10 cursor-pointer list-none items-center justify-between gap-2 rounded-base px-4 font-heading focus-ring [&::-webkit-details-marker]:hidden">
        How to approve
        <ChevronDown
          aria-hidden
          className="size-4 shrink-0 transition-transform group-open:rotate-180"
          strokeWidth={2.5}
        />
      </summary>
      <div className="space-y-4 border-t border-rule p-4">
        <p className="text-sm">Approving is a merge: set the status to accepted in a merge request.</p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 break-all chip-frame px-2 py-1 font-mono text-sm">{command}</code>
          <Button variant="neutral" size="sm" onClick={copy}>
            {copied === 'copied' ? <Check aria-hidden strokeWidth={2.5} /> : <Copy aria-hidden strokeWidth={2.5} />}
            {copied === 'copied' ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p role="status" className="text-sm">
          {copied === 'copied' && 'Command copied.'}
          {copied === 'failed' && 'Could not copy. Select the command and copy it by hand.'}
        </p>
      </div>
    </details>
  );
}
