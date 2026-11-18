import type { Context } from '../src/context.ts';
import { adrsForFiles, unverifiedBaseNote } from '../src/for-files.ts';
import type { Adr, AdrMeta } from '../src/model.ts';
import type { LogView, PendingChange } from '../src/view.ts';

const root = '/repo';
const ctx: Context = {
  cwd: root,
  logRoot: root,
  config: {
    product: 'acme',
    adr_dir: 'docs/adr',
    id_format: 'ADR-{n:4}',
    tags: [],
    components: { 'billing-service': { repo: '.' }, web: { repo: '.', root: 'apps/web' } },
  },
  readOnly: false,
  logSource: root,
  codeRepo: { root, components: ['billing-service', 'web'] },
  env: {},
};

function adr(id: string, over: Partial<AdrMeta>): Adr {
  return {
    path: `docs/adr/${id}.md`,
    body: `\n## Rationale\n\nWhy ${id}.\n`,
    meta: {
      id,
      title: `Title ${id}`,
      status: 'accepted',
      tags: [],
      components: [],
      code: [],
      sources: [],
      supersedes: [],
      related: [],
      deciders: [],
      origin: 'manual',
      contested: false,
      extra: {},
      ...over,
    },
  };
}

const anchored = adr('ADR-0001', {
  components: ['billing-service'],
  code: ['billing-service:src/Invoices/**'],
  review_rule: 'Invoice timestamps are UTC.',
});
const componentWide = adr('ADR-0002', { components: ['billing-service'], review_rule: 'R2' });
const webOnly = adr('ADR-0003', { components: ['web'], code: ['web:src/**'] });
const superseded = adr('ADR-0004', { components: ['billing-service'], status: 'superseded' });
const proposed = adr('ADR-0005', {
  components: ['billing-service'],
  code: ['billing-service:src/**'],
  status: 'proposed',
});

const view = (base: Adr[], pending: PendingChange[] = []): LogView => ({
  mode: 'git',
  baseRef: 'origin/main',
  base,
  pending,
  working: base,
  problems: [],
});

const decisionsFor = (v: LogView, file = 'src/Invoices/Invoice.ts') => adrsForFiles(ctx, v, [file])[0]?.decisions ?? [];

test('an accepted anchored ADR is binding with match "anchor" and its review_rule', () => {
  const [first] = decisionsFor(view([anchored]));
  expect(first).toMatchObject({
    id: 'ADR-0001',
    binding: true,
    layer: 'base',
    pending_kind: null,
    match: 'anchor',
    anchor: 'billing-service:src/Invoices/**',
    review_rule: 'Invoice timestamps are UTC.',
    excerpt: 'Why ADR-0001.',
  });
});

test('a component-wide ADR (no code anchors) matches with "component"', () => {
  expect(decisionsFor(view([componentWide]))).toMatchObject([{ id: 'ADR-0002', match: 'component', anchor: null }]);
});

test('an ADR anchored to another component is not returned', () => {
  expect(decisionsFor(view([webOnly]))).toEqual([]);
  expect(decisionsFor(view([webOnly]), 'apps/web/src/a.ts')).toMatchObject([{ id: 'ADR-0003', match: 'anchor' }]);
});

test('superseded is excluded; proposed is included as a non-binding hint', () => {
  expect(decisionsFor(view([superseded, proposed])).map((d) => [d.id, d.binding])).toEqual([['ADR-0005', false]]);
});

test("an agent's pending edit is never binding", () => {
  const current = { ...anchored, meta: { ...anchored.meta, review_rule: 'Local time is fine.' } };
  const decisions = decisionsFor(view([anchored], [{ id: 'ADR-0001', kind: 'modified', base: anchored, current }]));
  expect(decisions.map((d) => [d.layer, d.binding, d.pending_kind, d.review_rule])).toEqual([
    ['base', true, 'modified', 'Invoice timestamps are UTC.'],
    ['pending', false, 'modified', 'Local time is fine.'],
  ]);
});

test('binding first, then anchor matches before component matches, then by id', () => {
  const decisions = decisionsFor(view([proposed, componentWide, anchored]));
  expect(decisions.map((d) => d.id)).toEqual(['ADR-0001', 'ADR-0002', 'ADR-0005']);
});

test('a file outside any component → component null, decisions []', () => {
  expect(adrsForFiles(ctx, view([anchored]), ['../elsewhere/x.ts'])).toEqual([
    { file: '../elsewhere/x.ts', component: null, decisions: [] },
  ]);
});

test('unverifiedBaseNote speaks only when no default branch could be found', () => {
  expect(unverifiedBaseNote(view([]))).toBeNull();
  const note = unverifiedBaseNote({ ...view([]), baseUnresolved: true });
  expect(note).toContain('No default branch');
  expect(note).toContain('read as written');
});
