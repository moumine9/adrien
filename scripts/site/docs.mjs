/**
 * Renders the repository's Markdown docs into the static site (scripts/build-site.mjs calls this). README.md becomes the
 * docs home, and each doc gets its own page with a sidebar. Markdown is rendered with `html: false`, so raw HTML in a
 * document is shown as text, never as markup. Links between the pages are rewritten to the generated files; other
 * repository paths point at GitHub. This module has no side effects on import.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import MarkdownIt from 'markdown-it';

export const REPO_URL = 'https://github.com/moumine9/adrien';
const BLOB = `${REPO_URL}/blob/main/`;
const RAW = 'https://raw.githubusercontent.com/moumine9/adrien/main/';
const NPM_URL = 'https://www.npmjs.com/package/adrien';

/** The pages of the docs site: the Markdown source in the repository, the generated file, and its sidebar label. */
export const DOC_PAGES = [
  { source: 'README.md', out: 'index.html', label: 'Overview' },
  { source: 'docs/format.md', out: 'format.html', label: 'ADR format' },
  { source: 'docs/api.md', out: 'api.html', label: 'Local HTTP API' },
  { source: 'docs/self-hosting.md', out: 'self-hosting.html', label: 'Self-hosting' },
  { source: 'docs/releasing.md', out: 'releasing.html', label: 'Releasing' },
];

const PAGE_BY_SOURCE = new Map(DOC_PAGES.map((page) => [page.source, page]));
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// A raw <img> alone on its line (the README's logo). Raw HTML cannot render, so the line is dropped, not shown.
const LONE_IMG = /^[ \t]*<img\b[^>\n]*>[ \t]*$/;

/** A GitHub-style heading id: "ADR format" becomes "adr-format". */
export function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-');
}

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The href a link or image in `sourcePath` (a repository path) becomes on the site. `#anchor` links stay on the page;
 * a link to another page of the site becomes that page's file; any other repository path points at GitHub (images at
 * the raw file); every other URL is kept as written.
 */
function siteHref(href, sourcePath, sourceRoot, isImage) {
  if (href.startsWith('#')) return href;
  const hash = href.indexOf('#');
  const suffix = hash === -1 ? '' : href.slice(hash);
  const target = hash === -1 ? href : href.slice(0, hash);

  if (SCHEME.test(target) || target.startsWith('//')) {
    const page = target.startsWith(BLOB) ? PAGE_BY_SOURCE.get(target.slice(BLOB.length)) : undefined;
    return page ? page.out + suffix : href;
  }

  const repoPath = target.startsWith('/')
    ? posix.normalize(target.slice(1))
    : posix.normalize(posix.join(posix.dirname(sourcePath), target));
  const page = PAGE_BY_SOURCE.get(repoPath);
  if (page && !isImage) return page.out + suffix;
  if (isImage) return RAW + repoPath;

  const local = join(sourceRoot, repoPath);
  const isDirectory = existsSync(local) && statSync(local).isDirectory();
  return `${isDirectory ? `${REPO_URL}/tree/main/` : BLOB}${repoPath}${suffix}`;
}

/** The Markdown renderer: CommonMark with raw HTML off, heading ids, and the site's links and wrapped blocks. */
function createMarkdown() {
  const md = new MarkdownIt({ html: false, linkify: false });

  // Runs once per document; `env` carries where the document is in the repository.
  md.core.ruler.after('inline', 'adrien-site', (state) => {
    const { sourcePath, sourceRoot } = state.env;
    const ids = new Map();
    state.tokens.forEach((token, i) => {
      if (token.type === 'heading_open') {
        const text = (state.tokens[i + 1]?.children ?? [])
          .filter((child) => child.type === 'text' || child.type === 'code_inline')
          .map((child) => child.content)
          .join('');
        const base = slugify(text) || 'section';
        const seen = ids.get(base) ?? 0;
        ids.set(base, seen + 1);
        token.attrSet('id', seen ? `${base}-${seen}` : base);
      }
      if (token.type !== 'inline') return;
      for (const child of token.children ?? []) {
        if (child.type === 'link_open' && child.attrGet('href') !== null) {
          child.attrSet('href', siteHref(child.attrGet('href'), sourcePath, sourceRoot, false));
        }
        if (child.type === 'image' && child.attrGet('src') !== null) {
          child.attrSet('src', siteHref(child.attrGet('src'), sourcePath, sourceRoot, true));
        }
      }
    });
  });

  // Wide blocks scroll on their own, and can be reached by keyboard to do so.
  const fence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) =>
    fence(tokens, idx, options, env, self).replace('<pre>', '<pre tabindex="0">');
  md.renderer.rules.table_open = (tokens, idx, options, _env, self) =>
    `<div class="table-wrap" tabindex="0">${self.renderToken(tokens, idx, options)}`;
  md.renderer.rules.table_close = (tokens, idx, options, _env, self) =>
    `${self.renderToken(tokens, idx, options)}</div>`;

  return md;
}

/** The whole page around a rendered document: head, header, sidebar, article and footer. */
function pageHtml(page, body) {
  const title = `${escapeHtml(page.label)} · Adrien docs`;
  const sidebar = DOC_PAGES.map(
    (p) => `<li><a href="${p.out}"${p === page ? ' aria-current="page"' : ''}>${escapeHtml(p.label)}</a></li>`,
  ).join('\n            ');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="description" content="Adrien documentation: the ADR format, the local HTTP API, self-hosting and releasing." />
    <title>${title}</title>
    <link rel="icon" type="image/svg+xml" href="../icon.svg" />
    <link rel="stylesheet" href="../style.css" />
  </head>
  <body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="wrap bar">
        <a class="brand" href="../index.html"><img src="../icon.svg" alt="" width="36" height="36" />Adrien</a>
        <nav aria-label="Site">
          <ul class="top-links">
            <li><a href="index.html">Docs</a></li>
            <li><a href="../demo/index.html">Live demo</a></li>
            <li><a href="${REPO_URL}">GitHub</a></li>
            <li><a href="${NPM_URL}">npm</a></li>
          </ul>
        </nav>
      </div>
    </header>
    <div class="wrap docs-layout">
      <nav class="docs-nav" aria-label="Docs pages">
        <p class="mono-label">Docs</p>
        <ul>
            ${sidebar}
        </ul>
      </nav>
      <main id="main" class="doc" tabindex="-1">
        <article class="prose">
${body}
        </article>
        <p class="source">Source: <a href="${BLOB}${escapeHtml(page.source)}">${escapeHtml(page.source)}</a>, in the repository.</p>
      </main>
    </div>
    <footer class="site-footer">
      <div class="wrap">Adrien is AGPL-3.0 licensed. Its decisions are plain Markdown in your own repositories.</div>
    </footer>
  </body>
</html>
`;
}

/**
 * Blanks each lone <img> line outside code. A line inside a fenced or indented code block is code, so it stays (and is
 * escaped like any other code). The parser finds the blocks, so fences nested in lists are found too.
 */
function dropLoneImages(md, markdown, env) {
  const code = new Set();
  // A copy of env: parsing records link references in it, and the render must see the document's own state.
  for (const token of md.parse(markdown, { ...env })) {
    if ((token.type === 'fence' || token.type === 'code_block') && token.map) {
      for (let line = token.map[0]; line < token.map[1]; line++) code.add(line);
    }
  }
  return markdown
    .split('\n')
    .map((line, i) => (!code.has(i) && LONE_IMG.test(line) ? '' : line))
    .join('\n');
}

/**
 * Renders every page of DOC_PAGES from `sourceRoot` into `outDir` and returns the file names written. Throws when a
 * source file is missing, so a renamed doc fails the build instead of leaving a dead link.
 */
export function renderDocs({ sourceRoot, outDir }) {
  const md = createMarkdown();
  mkdirSync(outDir, { recursive: true });
  return DOC_PAGES.map((page) => {
    const env = { sourcePath: page.source, sourceRoot };
    const markdown = dropLoneImages(md, readFileSync(join(sourceRoot, page.source), 'utf8'), env);
    const body = md.render(markdown, env);
    writeFileSync(join(outDir, page.out), pageHtml(page, body));
    return page.out;
  });
}
