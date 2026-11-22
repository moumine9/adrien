import type { Diagnostic } from '../src/check.ts';
import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { bodyTemplate, serializeAdr } from '../src/frontmatter.ts';
import { lintAdrs } from '../src/lint.ts';
import { TEMPLATE_NAMES } from '../src/model.ts';
import { slugify } from '../src/slug.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';

async function lint(files: Record<string, string>, config = configYaml()): Promise<Diagnostic[]> {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: config, ...files });
  const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: tmpDir() } });
  return lintAdrs(ctx, await loadLogView(ctx.logRoot, ctx.config));
}

const filled =
  '\n## Context\n\nWe store invoices.\n\n## Decision\n\nUse Postgres.\n\n## Consequences\n\nOne more service.\n';
const codes = (diags: Diagnostic[]) => diags.map((d) => [d.severity, d.code, d.id]);

test('a filled-in Adrien ADR (no H1: the title lives in the frontmatter) lints clean', async () => {
  expect(await lint({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }, filled) })).toEqual([]);
});

test.each(TEMPLATE_NAMES)('the %s template, as written by `adrien new`, lints clean', async (name) => {
  const files = { 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }, bodyTemplate(name)) };
  expect(await lint(files)).toEqual([]);
});

test('a MADR file Adrien has rewritten (title in the frontmatter AND an H1) lints clean', async () => {
  const text = serializeAdr({
    meta: { ...parsedMeta(), extra: { 'decision-makers': 'alice, bob' } },
    body: '\n# Use PostgreSQL\n\n## Decision Outcome\n\nChosen option: "PostgreSQL", because ACID.\n',
  });
  expect(await lint({ 'docs/adr/0003-use-postgres.md': text })).toEqual([]);
});

function parsedMeta() {
  return {
    id: 'ADR-0003',
    title: 'Use PostgreSQL',
    status: 'accepted' as const,
    tags: [],
    components: [],
    code: [],
    review_rule: 'Use it.',
    sources: [],
    supersedes: [],
    related: [],
    deciders: [],
    origin: 'manual' as const,
    contested: false,
    extra: {},
  };
}

test('a markdownlint violation becomes a warning naming the rule and the line in the file', async () => {
  const body = '\n## Context\n\nWe store invoices.\n\n##Decision\n\nUse Postgres.\n';
  const diags = await lint({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }, body) });
  expect(codes(diags)).toEqual([['warning', 'markdown', 'ADR-0001']]);
  expect(diags[0]?.message).toMatch(/^MD018 no-missing-space-atx: .*line 11\b/);
});

test('long lines and repeated headings are not complaints (MADR style); a config override can turn a rule on', async () => {
  const long = `\n## Context\n\n${Array(60).fill('word').join(' ')}\n\n## Options\n\n### Postgres\n\nx\n\n## Pros\n\n### Postgres\n\ny\n`;
  const files = { 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }, long) };
  expect(await lint(files)).toEqual([]);
  const strict = await lint(files, `${configYaml()}lint:\n  markdownlint:\n    MD013: true\n`);
  expect(strict.map((d) => d.message.slice(0, 5))).toEqual(['MD013']);
});

test('a template placeholder left in the body is flagged, but code and {n:4} are not', async () => {
  const body =
    '\n## Context\n\n{short title, representative of solved problem}\n\n## Decision\n\nUse `{n:4}` ids and `{title of option}` in code.\n\n```json\n{ "a": 1 }\n```\n';
  const diags = await lint({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }, body) });
  expect(codes(diags)).toEqual([['warning', 'unfilled-placeholder', 'ADR-0001']]);
  expect(diags[0]?.message).toContain('{short title, representative of solved problem}');
});

test('an accepted ADR with an empty Decision section is flagged; a proposed one is not', async () => {
  const empty = '\n## Context\n\nWe store invoices.\n\n## Decision\n\n## Consequences\n\nNone.\n';
  const accepted = adrText({ id: 'ADR-0001', title: 'A', status: 'accepted', review_rule: 'Rule.' }, empty);
  const proposed = adrText({ id: 'ADR-0002', title: 'B' }, empty);
  expect(codes(await lint({ 'docs/adr/ADR-0001-a.md': accepted, 'docs/adr/ADR-0002-b.md': proposed }))).toEqual([
    ['warning', 'empty-decision', 'ADR-0001'],
  ]);
  const outcome = '\n## Decision Outcome\n\n### Consequences\n\n### Confirmation\n';
  expect(
    codes(
      await lint({
        'docs/adr/ADR-0003-c.md': adrText(
          { id: 'ADR-0003', title: 'C', status: 'accepted', review_rule: 'R.' },
          outcome,
        ),
      }),
    ),
  ).toEqual([['warning', 'empty-decision', 'ADR-0003']]);
});

test('numbered headings are flagged', async () => {
  const body = '\n## 1. Context\n\nWe store invoices.\n\n## 2. Decision\n\nUse Postgres.\n';
  const diags = await lint({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }, body) });
  expect(codes(diags)).toEqual([['warning', 'numbered-heading', 'ADR-0001']]);
});

test('only the ADRs in the working tree are linted, and files that do not parse are left to check', async () => {
  const diags = await lint({ 'docs/adr/ADR-0001-a.md': '---\n: bad: [\n---\n##x\n' });
  expect(diags).toEqual([]);
});

test.each([
  ['ADR-0001-use-postgres.md'],
  ['0001-use-postgres.md'],
  ['2026-03-04-use-postgres.md'],
  ['ADR-0001.md'],
  // `adrien new` writes `<id>-<slug>.md`, and a title with no Latin letters has an empty slug.
  ['ADR-0001-.md'],
])('the file name %s is accepted by filename-convention', async (name) => {
  expect(await lint({ [`docs/adr/${name}`]: adrText({ id: 'ADR-0001', title: 'A' }, filled) })).toEqual([]);
});

test.each([
  ['ADR-0001-Use-Postgres.md'],
  ['ADR-0001-use_postgres.md'],
  ['ADR-0001-use postgres.md'],
  ['use-postgres.md'],
])('the file name %s is flagged by filename-convention', async (name) => {
  const diags = await lint({ [`docs/adr/${name}`]: adrText({ id: 'ADR-0001', title: 'A' }, filled) });
  expect(codes(diags)).toEqual([['warning', 'filename-convention', 'ADR-0001']]);
  expect(diags[0]?.message).toContain(name);
});

test.each([
  'Utiliser Postgres pour la facturation',
  "Don't use the cloud: it's 100% risky!",
  '  --Leading and trailing punctuation--  ',
  'Café crème à la façon d’Œdipe',
  '日本語のタイトル',
  'Use 🚀 rockets',
  'x'.repeat(200),
])('a file name Adrien writes for the title %j passes filename-convention', async (title) => {
  const name = `ADR-0001-${slugify(title)}.md`;
  expect(await lint({ [`docs/adr/${name}`]: adrText({ id: 'ADR-0001', title: 'A' }, filled) })).toEqual([]);
});
