import type { CommonLog } from '../src/common.ts';
import type { Context } from '../src/context.ts';
import { adrsForFiles, type FileDecision, unverifiedBaseNote } from '../src/for-files.ts';
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
      exception_to: [],
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
    { file: '../elsewhere/x.ts', component: null, decisions: [], nearby: [], nearby_omitted: 0 },
  ]);
});

test('unverifiedBaseNote speaks only when no default branch could be found', () => {
  expect(unverifiedBaseNote(view([]))).toBeNull();
  const note = unverifiedBaseNote({ ...view([]), baseUnresolved: true });
  expect(note).toContain('No default branch');
  expect(note).toContain('read as written');
});

describe('decisions of a common log', () => {
  const common = (decisions: Adr[]): CommonLog => ({ name: 'common', ctx, view: view(decisions) });
  const sharedRule = adr('ADR-0010', { components: ['billing-service'], review_rule: 'Shared rule.' });
  const sharedAnchored = adr('ADR-0011', {
    components: ['billing-service'],
    code: ['billing-service:src/Invoices/**'],
  });
  const sharedProposed = adr('ADR-0012', { components: ['billing-service'], status: 'proposed' });
  const sharedWebOnly = adr('ADR-0013', { components: ['web'] });
  const sharedNoComponents = adr('ADR-0014', { components: [], code: [] });
  const sharedUnknown = adr('ADR-0015', { components: ['payments'] });
  const invoice = 'src/Invoices/Invoice.ts';

  test('an accepted common decision binds by component, tagged with its workspace', () => {
    const [result] = adrsForFiles(ctx, view([]), [invoice], common([sharedRule]));
    expect(result?.decisions).toEqual([
      expect.objectContaining({
        id: 'ADR-0010',
        workspace: 'common',
        binding: true,
        layer: 'base',
        match: 'component',
        review_rule: 'Shared rule.',
      }),
    ]);
  });

  test('an accepted common decision binds by its code anchor', () => {
    const [result] = adrsForFiles(ctx, view([]), [invoice], common([sharedAnchored]));
    expect(result?.decisions).toMatchObject([
      {
        id: 'ADR-0011',
        workspace: 'common',
        binding: true,
        match: 'anchor',
        anchor: 'billing-service:src/Invoices/**',
      },
    ]);
  });

  test('a proposed common decision and a pending common change never bind or appear', () => {
    const withPending: CommonLog = {
      name: 'common',
      ctx,
      view: { ...view([sharedRule]), pending: [{ id: 'ADR-0010', kind: 'modified', current: sharedRule }] },
    };
    expect(adrsForFiles(ctx, view([]), [invoice], common([sharedProposed]))[0]?.decisions).toEqual([]);
    expect(adrsForFiles(ctx, view([]), [invoice], withPending)[0]?.decisions.map((d) => d.layer)).toEqual(['base']);
  });

  test('a common decision naming a component the product lacks matches nothing', () => {
    expect(adrsForFiles(ctx, view([]), [invoice], common([sharedUnknown]))[0]?.decisions).toEqual([]);
    expect(adrsForFiles(ctx, view([]), [invoice], common([sharedWebOnly]))[0]?.decisions).toEqual([]);
  });

  test('a common decision with neither components nor anchors binds nothing', () => {
    expect(adrsForFiles(ctx, view([]), [invoice], common([sharedNoComponents]))[0]?.decisions).toEqual([]);
  });

  test('an own decision precedes a common one with the same rank and id', () => {
    const ownSameId = adr('ADR-0010', { components: ['billing-service'], review_rule: 'Own.' });
    const [result] = adrsForFiles(ctx, view([ownSameId]), [invoice], common([sharedRule]));
    expect(result?.decisions.map((d) => [d.id, d.workspace])).toEqual([
      ['ADR-0010', null],
      ['ADR-0010', 'common'],
    ]);
  });

  test('common decisions rank by the same order as own ones: anchor matches first', () => {
    const own = adr('ADR-0002', { components: ['billing-service'] });
    const [result] = adrsForFiles(ctx, view([own]), [invoice], common([sharedAnchored]));
    expect(result?.decisions.map((d) => [d.id, d.workspace])).toEqual([
      ['ADR-0011', 'common'],
      ['ADR-0002', null],
    ]);
  });

  test('without a common log the decisions carry workspace null', () => {
    expect(adrsForFiles(ctx, view([componentWide]), [invoice], null)[0]?.decisions[0]).toMatchObject({
      workspace: null,
    });
    expect(adrsForFiles(ctx, view([componentWide]), [invoice])[0]?.decisions[0]).toMatchObject({ workspace: null });
  });
});

describe('an exception to a common decision', () => {
  const common = (decisions: Adr[]): CommonLog => ({ name: 'common', ctx, view: view(decisions) });
  const sharedRule = () => adr('ADR-0010', { components: ['billing-service'], review_rule: 'Shared rule.' });
  const exception = (over: Partial<AdrMeta> = {}) =>
    adr('ADR-0012', {
      components: ['billing-service'],
      exception_to: ['common/ADR-0010'],
      review_on: '2027-03-04',
      review_rule: 'Local rule.',
      ...over,
    });
  const invoice = 'src/Invoices/Invoice.ts';
  const other = 'src/Other/Thing.ts';
  const summary = (d: FileDecision) => [d.id, d.workspace, d.binding, d.exemption];

  test('with no code anchors it exempts the common decision for every file of the product, and stays listed', () => {
    const files = adrsForFiles(ctx, view([exception()]), [invoice, other], common([sharedRule()]));
    for (const file of files) {
      expect(file.decisions.map(summary)).toEqual([
        ['ADR-0012', null, true, null],
        ['ADR-0010', 'common', false, { by: 'ADR-0012' }],
      ]);
    }
  });

  test('an anchorless exception whose components omit this file still governs it: it is listed with its own rule', () => {
    const ex = exception({ components: [] });
    const [result] = adrsForFiles(ctx, view([ex]), [invoice], common([sharedRule()]));
    expect(result?.decisions).toContainEqual(
      expect.objectContaining({ id: 'ADR-0012', workspace: null, binding: true, match: 'exception', anchor: null }),
    );
    expect(result?.decisions).toContainEqual(
      expect.objectContaining({ id: 'ADR-0010', binding: false, exemption: { by: 'ADR-0012' } }),
    );
  });

  test('an exception that exempts two common decisions is listed once', () => {
    const ex = exception({ components: [], exception_to: ['common/ADR-0010', 'common/ADR-0011'] });
    const second = adr('ADR-0011', { components: ['billing-service'], review_rule: 'Another shared rule.' });
    const [result] = adrsForFiles(ctx, view([ex]), [invoice], common([sharedRule(), second]));
    expect(result?.decisions.filter((d) => d.id === 'ADR-0012')).toHaveLength(1);
    expect(result?.decisions.filter((d) => d.exemption?.by === 'ADR-0012')).toHaveLength(2);
  });

  test('two exceptions to the same common decision are both listed, with the first as the exemption', () => {
    const first = exception({ components: [] });
    const second = adr('ADR-0013', {
      components: [],
      exception_to: ['common/ADR-0010'],
      review_on: '2027-03-04',
      review_rule: 'Another local rule.',
    });
    const [result] = adrsForFiles(ctx, view([first, second]), [invoice], common([sharedRule()]));
    expect(result?.decisions.filter((d) => d.match === 'exception').map((d) => d.id)).toEqual(['ADR-0012', 'ADR-0013']);
    expect(result?.decisions).toContainEqual(
      expect.objectContaining({ id: 'ADR-0010', exemption: { by: 'ADR-0012' } }),
    );
  });

  test('an exception that matches by itself is listed once', () => {
    const [result] = adrsForFiles(ctx, view([exception()]), [invoice], common([sharedRule()]));
    expect(result?.decisions.filter((d) => d.id === 'ADR-0012')).toHaveLength(1);
  });

  test('with code anchors it exempts only the files those anchors match', () => {
    const ex = exception({ code: ['billing-service:src/Invoices/**'] });
    const [inside] = adrsForFiles(ctx, view([ex]), [invoice], common([sharedRule()]));
    const [outside] = adrsForFiles(ctx, view([ex]), [other], common([sharedRule()]));
    expect(inside?.decisions.map(summary)).toContainEqual(['ADR-0010', 'common', false, { by: 'ADR-0012' }]);
    expect(outside?.decisions.map(summary)).toContainEqual(['ADR-0010', 'common', true, null]);
  });

  test('anchors that name only another component exempt nothing here', () => {
    const ex = exception({ code: ['web:apps/web/**'] });
    const [result] = adrsForFiles(ctx, view([ex]), [invoice], common([sharedRule()]));
    expect(result?.decisions.map(summary)).toContainEqual(['ADR-0010', 'common', true, null]);
  });

  test.each(['proposed', 'rejected', 'superseded', 'deprecated'] as const)(
    'a %s exception exempts nothing',
    (status) => {
      const [result] = adrsForFiles(ctx, view([exception({ status })]), [invoice], common([sharedRule()]));
      expect(result?.decisions).toContainEqual(
        expect.objectContaining({ id: 'ADR-0010', binding: true, exemption: null }),
      );
    },
  );

  test('a pending exception, not yet on the default branch, exempts nothing', () => {
    const pending: PendingChange[] = [{ id: 'ADR-0012', kind: 'added', current: exception() }];
    const [result] = adrsForFiles(ctx, view([], pending), [invoice], common([sharedRule()]));
    expect(result?.decisions).toContainEqual(expect.objectContaining({ id: 'ADR-0012', layer: 'pending' }));
    expect(result?.decisions).toContainEqual(
      expect.objectContaining({ id: 'ADR-0010', binding: true, exemption: null }),
    );
  });

  test('an exception naming another log, or a decision the common log does not hold, exempts nothing', () => {
    const otherLog = exception({ exception_to: ['other/ADR-0010'] });
    const missing = exception({ exception_to: ['common/ADR-0099'] });
    for (const ex of [otherLog, missing]) {
      const [result] = adrsForFiles(ctx, view([ex]), [invoice], common([sharedRule()]));
      expect(result?.decisions).toContainEqual(
        expect.objectContaining({ id: 'ADR-0010', binding: true, exemption: null }),
      );
    }
  });

  test('an exception past its review date stays in force', () => {
    const [result] = adrsForFiles(
      ctx,
      view([exception({ review_on: '2020-01-01' })]),
      [invoice],
      common([sharedRule()]),
    );
    expect(result?.decisions).toContainEqual(
      expect.objectContaining({ id: 'ADR-0010', binding: false, exemption: { by: 'ADR-0012' } }),
    );
  });
});

describe('nearby decisions (ADR-0036)', () => {
  const importer = 'src/Importers/InvoiceImporter.ts';
  const elsewhere = (id: string, glob: string, over: Partial<AdrMeta> = {}) =>
    adr(id, { components: ['billing-service'], code: [`billing-service:${glob}`], ...over });
  const common = (decisions: Adr[]): CommonLog => ({ name: 'common', ctx, view: view(decisions) });
  const nearbyIds = (v: LogView, file = importer, c: CommonLog | null = null) =>
    adrsForFiles(ctx, v, [file], c)[0]?.nearby.map((n) => [n.id, n.workspace]);

  test('a decision of the same component anchored to another path is listed, even when another decision governs', () => {
    const [file] = adrsForFiles(ctx, view([anchored, componentWide, webOnly]), [importer]);
    expect(file?.decisions.map((d) => d.id)).toEqual(['ADR-0002']);
    expect(file?.nearby).toEqual([
      { id: 'ADR-0001', title: 'Title ADR-0001', workspace: null, anchors: ['billing-service:src/Invoices/**'] },
    ]);
    expect(file?.nearby_omitted).toBe(0);
  });

  test('the decision that covers a file is not nearby for it', () => {
    expect(nearbyIds(view([anchored]), 'src/Invoices/Invoice.ts')).toEqual([]);
  });

  test('only accepted decisions on the default branch are nearby', () => {
    const proposedElsewhere = elsewhere('ADR-0006', 'src/Payments/**', { status: 'proposed' });
    const deprecated = elsewhere('ADR-0007', 'src/Payments/**', { status: 'deprecated' });
    const added = elsewhere('ADR-0008', 'src/Payments/**');
    const pendingOnly: PendingChange = { id: 'ADR-0008', kind: 'added', current: added };
    expect(nearbyIds(view([proposedElsewhere, deprecated], [pendingOnly]))).toEqual([]);
  });

  test('a decision already listed for the file in another layer is not nearby', () => {
    const widened = { ...anchored, meta: { ...anchored.meta, code: ['billing-service:src/**'] } };
    const pending: PendingChange = { id: 'ADR-0001', kind: 'modified', base: anchored, current: widened };
    const [file] = adrsForFiles(ctx, view([anchored], [pending]), [importer]);
    expect(file?.decisions.map((d) => [d.id, d.layer])).toEqual([['ADR-0001', 'pending']]);
    expect(file?.nearby).toEqual([]);
  });

  test("only the anchors in the file's component are given", () => {
    const both = adr('ADR-0009', {
      components: ['billing-service', 'web'],
      code: ['billing-service:src/Invoices/**', 'web:src/**', 'billing-service:lib/**'],
    });
    expect(adrsForFiles(ctx, view([both]), [importer])[0]?.nearby).toEqual([
      {
        id: 'ADR-0009',
        title: 'Title ADR-0009',
        workspace: null,
        anchors: ['billing-service:src/Invoices/**', 'billing-service:lib/**'],
      },
    ]);
  });

  test('closest folders first, then by id; at most ten, with a count of the rest', () => {
    const far = Array.from({ length: 11 }, (_, i) => elsewhere(`ADR-01${String(i + 1).padStart(2, '0')}`, 'lib/x/**'));
    const sibling = elsewhere('ADR-0120', 'src/Importers/Other.ts');
    const cousin = elsewhere('ADR-0115', 'src/Payments/**');
    const [file] = adrsForFiles(ctx, view([...far, cousin, sibling]), [importer]);
    expect(file?.nearby.map((n) => n.id)).toEqual([
      'ADR-0120',
      'ADR-0115',
      'ADR-0101',
      'ADR-0102',
      'ADR-0103',
      'ADR-0104',
      'ADR-0105',
      'ADR-0106',
      'ADR-0107',
      'ADR-0108',
    ]);
    expect(file?.nearby_omitted).toBe(3);
  });

  test('a decision is as close as its closest anchor', () => {
    const twoAnchors = adr('ADR-0130', {
      components: ['billing-service'],
      code: ['billing-service:lib/**', 'billing-service:src/Importers/Other.ts'],
    });
    const cousin = elsewhere('ADR-0115', 'src/Payments/**');
    expect(nearbyIds(view([cousin, twoAnchors]))).toEqual([
      ['ADR-0130', null],
      ['ADR-0115', null],
    ]);
  });

  test("a common log's accepted decision anchored elsewhere is nearby with its workspace, after an own one of the same id", () => {
    const own = elsewhere('ADR-0011', 'src/Payments/**');
    const shared = elsewhere('ADR-0011', 'src/Payments/**');
    const sharedProposed = elsewhere('ADR-0016', 'src/Payments/**', { status: 'proposed' });
    expect(nearbyIds(view([own]), importer, common([shared, sharedProposed]))).toEqual([
      ['ADR-0011', null],
      ['ADR-0011', 'common'],
    ]);
  });

  test('a common decision that an accepted exception exempts for the file is not nearby', () => {
    const shared = elsewhere('ADR-0010', 'src/Invoices/**');
    const exception = (code: string[]) =>
      adr('ADR-0012', {
        components: ['billing-service'],
        code,
        exception_to: ['common/ADR-0010'],
        review_on: '2027-03-04',
      });
    expect(nearbyIds(view([exception([])]), importer, common([shared]))).toEqual([]);
    expect(nearbyIds(view([exception(['billing-service:src/Invoices/**'])]), importer, common([shared]))).toEqual([
      ['ADR-0010', 'common'],
      ['ADR-0012', null],
    ]);
  });
});
