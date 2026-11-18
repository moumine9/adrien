import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DOC_PAGES, renderDocs } from '../../../scripts/site/docs.mjs';
import { tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';

/** A small repository shaped like this one: a README at the root and the docs in docs/. */
const REPO = {
  'README.md': [
    '# Adrien',
    '',
    '<img src="assets/icon-512.png" alt="The mark" width="112" height="112" align="right">',
    '',
    'Architecture decisions for developers.',
    '',
    '## Documentation',
    '',
    'The [format reference](docs/format.md) and the [API](https://github.com/moumine9/adrien/blob/main/docs/api.md#rules).',
    'Read [the license](LICENSE) and [the decisions](docs/decisions).',
    '',
  ].join('\n'),
  LICENSE: 'AGPL-3.0\n',
  'docs/decisions/ADR-0001-example.md': '# Example\n',
  'docs/format.md': [
    '# ADR format',
    '',
    '## Anchors',
    '',
    'See the [API](api.md#endpoints), [self-hosting](self-hosting.md) and [the README](../README.md#install).',
    '',
    '<script>alert("x")</script>',
    '',
    'Inline <b>bold</b> is text, not markup.',
    '',
  ].join('\n'),
  'docs/api.md': '# Local HTTP API\n\n## Endpoints\n\nBack to the [format](format.md).\n',
  'docs/self-hosting.md': '# Self-hosting\n\n<div class="x">raw block</div>\n',
  'docs/releasing.md': '# Releasing\n\nTag a version.\n',
};

/** Renders the fixture repository into a fresh output folder and returns the folder. */
function render(): string {
  const root = tmpDir();
  writeFiles(root, REPO);
  mkdirSync(join(root, 'docs', 'decisions'), { recursive: true });
  const out = join(tmpDir(), 'docs');
  renderDocs({ sourceRoot: root, outDir: out });
  return out;
}

const read = (out: string, name: string) => readFileSync(join(out, name), 'utf8');

test('every page has a title', () => {
  const out = render();
  const pages = readdirSync(out).filter((f) => f.endsWith('.html'));
  expect(pages.sort()).toEqual(DOC_PAGES.map((p) => p.out).sort());
  for (const page of pages) {
    expect(read(out, page)).toMatch(/<title>[^<]+<\/title>/);
  }
});

test('relative .md links are rewritten to the generated pages and keep their anchors', () => {
  const out = render();
  // The README becomes the docs home, so its links to the docs are relative to docs/index.html.
  const home = read(out, 'index.html');
  expect(home).toContain('href="format.html"');
  expect(home).toContain('href="api.html#rules"');
  // Links inside a doc are relative to that doc's own file.
  const format = read(out, 'format.html');
  expect(format).toContain('href="api.html#endpoints"');
  expect(format).toContain('href="self-hosting.html"');
  expect(format).toContain('href="index.html#install"');
  expect(read(out, 'api.html')).toContain('href="format.html"');
  // Site-relative links only: a link to a Markdown file on GitHub (the "Source" line) is allowed.
  for (const page of readdirSync(out)) {
    expect(read(out, page)).not.toMatch(/href="(?!https?:)[^"]*\.md(#[^"]*)?"/);
  }
});

test('links to files that are not pages point at the repository on GitHub', () => {
  const home = read(render(), 'index.html');
  expect(home).toContain('href="https://github.com/moumine9/adrien/blob/main/LICENSE"');
  expect(home).toContain('href="https://github.com/moumine9/adrien/tree/main/docs/decisions"');
});

test('raw HTML in Markdown is escaped, not rendered', () => {
  const out = render();
  const format = read(out, 'format.html');
  expect(format).toContain('&lt;script&gt;');
  expect(format).toContain('&lt;b&gt;bold&lt;/b&gt;');
  expect(read(out, 'self-hosting.html')).toContain('&lt;div class=&quot;x&quot;&gt;');
  expect(read(out, 'self-hosting.html')).not.toContain('<div class="x">');
  // The README's <img> line cannot render either, so the docs home drops it.
  expect(read(out, 'index.html')).not.toContain('&lt;img');
  for (const page of readdirSync(out)) {
    expect(read(out, page)).not.toContain('<script');
  }
});

test('headings carry ids, so anchors resolve', () => {
  const out = render();
  expect(read(out, 'format.html')).toContain('<h2 id="anchors">Anchors</h2>');
  expect(read(out, 'api.html')).toContain('<h2 id="endpoints">Endpoints</h2>');
});
