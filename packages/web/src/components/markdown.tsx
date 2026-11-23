import { ExternalLink } from 'lucide-react';
import { type ComponentProps, type ReactNode, useMemo } from 'react';
import Markdown, { type Components, defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils.ts';
import { useWorkspace, workspacePath } from '@/lib/workspace.ts';

/** Maps the file name of a link (`ADR-0007-some-title.md`) to the id of the decision in that file, if the log has one. */
export type ResolveFile = (fileName: string) => string | undefined;

/** `ADR-0007-some-title.md`, `../old/0003-x.md#context`: a link to a Markdown file, split into file name and fragment. */
const MARKDOWN_FILE = /^(?:[^#?]*\/)?([^/#?]+\.md)(?:#.*)?$/;

/** `https://…`, `mailto:…`, `//host/…`: it names a file somewhere else, never one in this log. */
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Links to other decision files open inside the app, resolved against the log's real ids (any `id_format`);
 * everything else goes through react-markdown's default transform, which empties `javascript:`, `data:` and other
 * unsafe protocols.
 */
export function adrUrlTransform(url: string, resolveFile?: ResolveFile, workspace?: string): string {
  const file = ABSOLUTE_URL.test(url) ? undefined : MARKDOWN_FILE.exec(url)?.[1];
  const id = file ? resolveFile?.(file) : undefined;
  return id ? `#${workspacePath(workspace, `/adr/${encodeURIComponent(id)}`)}` : defaultUrlTransform(url);
}

const isExternal = (href: string | undefined) => Boolean(href && /^https?:\/\//i.test(href));
/** A link to a heading on this page. The router owns the hash, so these must not be left to the browser. */
const isSamePage = (href: string | undefined): href is string =>
  Boolean(href?.startsWith('#') && !href.startsWith('#/'));

/** GitHub-style heading anchor: lower case, punctuation dropped, spaces to hyphens. */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .trim()
    .replace(/\s+/g, '-');
}

function textOf(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (node && typeof node === 'object' && 'props' in node)
    return textOf((node.props as { children?: ReactNode }).children);
  return '';
}

const heading = (Tag: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6') =>
  function Heading({ children, node: _node, ...rest }: ComponentProps<typeof Tag> & { node?: unknown }) {
    return (
      <Tag data-anchor={slug(textOf(children))} {...rest}>
        {children}
      </Tag>
    );
  };

const components: Components = {
  h1: heading('h1'),
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
  h5: heading('h5'),
  h6: heading('h6'),
  a: ({ href, children, node: _node, ...rest }) => {
    if (isExternal(href)) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
          {children}
          <ExternalLink aria-hidden className="ml-1 inline size-3.5 align-[-2px]" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      );
    }
    if (isSamePage(href)) {
      return (
        <a
          href={href}
          {...rest}
          onClick={(event) => {
            event.preventDefault();
            const anchor = decodeURIComponent(href.slice(1));
            event.currentTarget
              .closest('.prose-adr')
              ?.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`)
              ?.scrollIntoView();
          }}
        >
          {children}
        </a>
      );
    }
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    );
  },
};

/** An ADR body. Raw HTML in the Markdown is skipped, never rendered. */
export function AdrMarkdown({
  source,
  className,
  resolveFile,
}: {
  source: string;
  className?: string;
  resolveFile?: ResolveFile;
}) {
  const workspace = useWorkspace();
  const urlTransform = useMemo(
    () => (url: string) => adrUrlTransform(url, resolveFile, workspace),
    [resolveFile, workspace],
  );
  return (
    <div className={cn('prose-adr', className)}>
      <Markdown remarkPlugins={[remarkGfm]} skipHtml urlTransform={urlTransform} components={components}>
        {source}
      </Markdown>
    </div>
  );
}
