import { ExternalLink } from 'lucide-react';
import Markdown, { type Components, defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils.ts';

/** `ADR-0007-some-title.md`, `./ADR-0007.md#context`: a link to another decision file in the log. */
const ADR_FILE = /^(?:\.\/)?([A-Za-z][A-Za-z0-9]*-\d+)(?:-[^/#?]*)?\.md(?:#.*)?$/;

/**
 * Links to other ADR files open inside the app; everything else goes through react-markdown's default transform,
 * which empties `javascript:`, `data:` and other unsafe protocols.
 */
export function adrUrlTransform(url: string): string {
  const m = ADR_FILE.exec(url);
  if (m) return `#/adr/${m[1]}`;
  return defaultUrlTransform(url);
}

const isExternal = (href: string | undefined) => Boolean(href && /^https?:\/\//i.test(href));

const components: Components = {
  a: ({ href, children, node: _node, ...rest }) =>
    isExternal(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
        {children}
        <ExternalLink aria-hidden className="ml-0.5 inline size-3.5 align-[-2px]" />
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    ) : (
      <a href={href} {...rest}>
        {children}
      </a>
    ),
};

/** An ADR body. Raw HTML in the Markdown is skipped, never rendered. */
export function AdrMarkdown({ source, className }: { source: string; className?: string }) {
  return (
    <div className={cn('prose-adr', className)}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={adrUrlTransform} components={components}>
        {source}
      </Markdown>
    </div>
  );
}
