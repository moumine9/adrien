import { type CheckOptions, type Diagnostic, exitCodeFor, runCheck } from '../src/check.ts';
import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import type { AdrMeta } from '../src/model.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { commitAll, git, initRepo } from './helpers/git.ts';

const ok = (id: string, over: Partial<AdrMeta> = {}) =>
  adrText({ id, title: `Title ${id}`, status: 'accepted', review_rule: 'A rule.', tags: ['backend'], ...over });

async function check(files: Record<string, string>, opts: CheckOptions = {}, env: NodeJS.ProcessEnv = {}) {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), ...files });
  return checkAt(root, opts, env);
}

async function checkAt(root: string, opts: CheckOptions = {}, env: NodeJS.ProcessEnv = {}): Promise<Diagnostic[]> {
  const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: tmpDir(), ...env } });
  return runCheck(ctx, await loadLogView(ctx.logRoot, ctx.config), opts);
}

const codes = (diags: Diagnostic[]) => diags.map((d) => [d.severity, d.code, d.id]);

test('a clean log has no diagnostics', async () => {
  expect(await check({ 'docs/adr/ADR-0001-a.md': ok('ADR-0001', { components: ['billing-service'] }) })).toEqual([]);
});

test('unknown tag → error', async () => {
  const diags = await check({ 'docs/adr/ADR-0001-a.md': ok('ADR-0001', { tags: ['backend', 'ghost'] }) });
  expect(codes(diags)).toEqual([['error', 'unknown-tag', 'ADR-0001']]);
  expect(diags[0]?.message).toContain('ghost');
});

test('unknown component → error', async () => {
  const diags = await check({ 'docs/adr/ADR-0001-a.md': ok('ADR-0001', { components: ['ghost'] }) });
  expect(codes(diags)).toEqual([['error', 'unknown-component', 'ADR-0001']]);
});

test('unparsable or unknown-component anchors → invalid-anchor errors', async () => {
  const diags = await check({ 'docs/adr/ADR-0001-a.md': ok('ADR-0001', { code: ['nocolon', 'ghost:src/**'] }) });
  expect(codes(diags)).toEqual([
    ['error', 'invalid-anchor', 'ADR-0001'],
    ['error', 'invalid-anchor', 'ADR-0001'],
  ]);
});

test('duplicate id → one error listing every path', async () => {
  const diags = await check({ 'docs/adr/ADR-0001-a.md': ok('ADR-0001'), 'docs/adr/ADR-0001-b.md': ok('ADR-0001') });
  expect(codes(diags)).toEqual([['error', 'duplicate-id', 'ADR-0001']]);
  expect(diags[0]?.message).toContain('docs/adr/ADR-0001-a.md');
  expect(diags[0]?.message).toContain('docs/adr/ADR-0001-b.md');
});

test('a link to an unknown id → broken-link', async () => {
  const diags = await check({ 'docs/adr/ADR-0001-a.md': ok('ADR-0001', { related: ['ADR-0099'] }) });
  expect(codes(diags)).toEqual([['error', 'broken-link', 'ADR-0001']]);
});

test('A supersedes B but B is still accepted → supersede-asymmetry', async () => {
  const diags = await check({
    'docs/adr/ADR-0001-a.md': ok('ADR-0001'),
    'docs/adr/ADR-0002-b.md': ok('ADR-0002', { supersedes: ['ADR-0001'] }),
  });
  expect(codes(diags)).toEqual([['error', 'supersede-asymmetry', 'ADR-0002']]);
});

test('accepted without review_rule → error; proposed without is fine', async () => {
  const diags = await check({
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', status: 'accepted' }),
    'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B', status: 'proposed' }),
  });
  expect(codes(diags)).toEqual([['error', 'missing-review-rule', 'ADR-0001']]);
});

test('--here: a missing anchor target is a stale-anchor warning, which never fails CI unless strict', async () => {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    'apps/web/src/a.ts': 'export {};\n',
    'docs/adr/ADR-0001-a.md': ok('ADR-0001', { code: ['web:src/a.ts', 'web:src/missing/**'] }),
  });
  const diags = await checkAt(root, { here: true });
  expect(codes(diags)).toEqual([['warning', 'stale-anchor', 'ADR-0001']]);
  expect(diags[0]?.message).toContain('web:src/missing/**');
  expect(exitCodeFor(diags)).toBe(0);
  expect(exitCodeFor(diags, true)).toBe(1);
});

test('a log repo without a checkout reports anchors-not-verified (never a silent pass)', async () => {
  const diags = await check({ 'docs/adr/ADR-0001-a.md': ok('ADR-0001', { code: ['billing-service:src/**'] }) });
  expect(codes(diags)).toEqual([['info', 'anchors-not-verified', undefined]]);
  expect(diags[0]?.message).toContain('billing-service');
});

test('ADRIEN_REPOS pointing at a checkout lets the log repo detect a stale anchor', async () => {
  const billing = tmpDir();
  writeFiles(billing, { 'src/Invoices/Invoice.ts': 'export {};\n' });
  const diags = await check(
    {
      'docs/adr/ADR-0001-a.md': ok('ADR-0001', { code: ['billing-service:src/Invoices/**', 'billing-service:lib/**'] }),
    },
    {},
    { ADRIEN_REPOS: `billing-service=${billing}` },
  );
  expect(codes(diags)).toEqual([['warning', 'stale-anchor', 'ADR-0001']]);
  expect(diags[0]?.message).toContain('billing-service:lib/**');
});

test("--mr: a pending ADR still 'proposed' → pending-proposed warning", async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), 'docs/adr/ADR-0001-a.md': ok('ADR-0001') });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B' }) });
  expect(codes(await checkAt(root, { mr: true }))).toEqual([['warning', 'pending-proposed', 'ADR-0002']]);
  expect(await checkAt(root)).toEqual([]);
});

test('a parse problem becomes a parse-error diagnostic instead of throwing', async () => {
  const diags = await check({
    'docs/adr/ADR-0001-a.md': ok('ADR-0001'),
    'docs/adr/ADR-0002-bad.md': '---\nid: ADR-0002\ntitle: [unclosed\n---\n',
  });
  expect(diags).toMatchObject([{ severity: 'error', code: 'parse-error', path: 'docs/adr/ADR-0002-bad.md' }]);
});

test('exitCodeFor is 1 on any error', () => {
  expect(exitCodeFor([{ severity: 'error', code: 'unknown-tag', message: 'x' }])).toBe(1);
  expect(exitCodeFor([{ severity: 'info', code: 'anchors-not-verified', message: 'x' }], true)).toBe(0);
});

test('components without a checkout are reported in a single anchors-not-verified line', async () => {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml({
      components: { a: { repo: 'https://x.example/a' }, b: { repo: 'https://x.example/b' } },
    }),
    'docs/adr/ADR-0001-a.md': ok('ADR-0001', { code: ['a:src/**', 'b:lib/**'] }),
  });
  const diags = await checkAt(root);
  expect(codes(diags)).toEqual([['info', 'anchors-not-verified', undefined]]);
  expect(diags[0]?.message).toContain('a, b');
});

test('an ADR id added both upstream and on this branch is a duplicate-id after merging', async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), 'docs/adr/ADR-0001-a.md': ok('ADR-0001') });
  const { origin } = initRepo(root, { origin: true });
  const other = tmpDir();
  git(other, 'clone', '-q', origin ?? '', '.');
  writeFiles(other, { 'docs/adr/ADR-0002-theirs.md': ok('ADR-0002') });
  commitAll(other, 'add ADR-0002 upstream');
  git(other, 'push', '-q', 'origin', 'main');
  git(root, 'fetch', '-q', 'origin');
  writeFiles(root, { 'docs/adr/ADR-0002-mine.md': ok('ADR-0002', { title: 'Mine' }) });

  const diags = await checkAt(root);
  expect(codes(diags).filter(([, code]) => code === 'duplicate-id')).toEqual([['error', 'duplicate-id', 'ADR-0002']]);
});

test('--mr without a resolvable default branch is an error, plain check is not', async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), 'docs/adr/ADR-0001-a.md': ok('ADR-0001') });
  initRepo(root);
  git(root, 'branch', '-m', 'trunk');
  expect(codes(await checkAt(root, { mr: true }))).toEqual([['error', 'base-unresolved', undefined]]);
  expect(await checkAt(root)).toEqual([]);
});

test('review_on: due or overdue → review-due warning; future, retired or absent → nothing', async () => {
  const diags = await check(
    {
      'docs/adr/ADR-0001-a.md': ok('ADR-0001', { review_on: '2026-11-17' }),
      'docs/adr/ADR-0002-b.md': ok('ADR-0002', { review_on: '2026-01-01' }),
      'docs/adr/ADR-0003-c.md': ok('ADR-0003', { review_on: '2027-01-01' }),
      'docs/adr/ADR-0004-d.md': ok('ADR-0004', { review_on: '2026-01-01', status: 'deprecated' }),
      'docs/adr/ADR-0005-e.md': ok('ADR-0005'),
    },
    { today: '2026-11-17' },
  );
  expect(codes(diags)).toEqual([
    ['warning', 'review-due', 'ADR-0001'],
    ['warning', 'review-due', 'ADR-0002'],
  ]);
  expect(diags[1]?.message).toContain('2026-01-01');
});
