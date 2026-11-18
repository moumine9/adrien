import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCheck } from '../src/check.ts';
import { CODE_CONFIG_FILE, CONFIG_FILE } from '../src/config.ts';
import { type Context, resolveContext } from '../src/context.ts';
import { BODY_TEMPLATE } from '../src/frontmatter.ts';
import { fetchOrigin } from '../src/git.ts';
import { readWorkingLog } from '../src/log.ts';
import { acceptAdr, createAdr, renumber, supersede, updateAdr } from '../src/ops.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { commitAll, git, initRepo } from './helpers/git.ts';

const TODAY = '2026-11-17';

function makeLog(files: Record<string, string> = {}): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), ...files });
  return root;
}

async function load(cwd: string, env: NodeJS.ProcessEnv = {}) {
  const ctx = await resolveContext({ cwd, env: { ADRIEN_HOME: tmpDir(), ...env } });
  return { ctx, view: await loadLogView(ctx.logRoot, ctx.config) };
}

const ids = (root: string, ctx: Context) => readWorkingLog(root, ctx.config).adrs.map((a) => a.meta.id);

test('createAdr writes a proposed, manual ADR from the body template', async () => {
  const root = makeLog();
  const { ctx, view } = await load(root);
  const result = createAdr(ctx, view, { title: 'Use Postgres', tags: ['database'] }, { today: TODAY });
  expect(result.written).toBe(true);
  const file = join(root, 'docs/adr/ADR-0001-use-postgres.md');
  expect(readFileSync(file, 'utf8')).toBe(
    `---\nid: ADR-0001\ntitle: Use Postgres\nstatus: proposed\ndate: ${TODAY}\ntags: [database]\n---\n${BODY_TEMPLATE}`,
  );
});

test('allocates after an id that exists only on the fetched default branch', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  const { origin } = initRepo(root, { origin: true });
  const other = tmpDir();
  git(other, 'clone', '-q', origin ?? '', '.');
  writeFiles(other, { 'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B' }) });
  commitAll(other, 'add ADR-0002');
  git(other, 'push', '-q', 'origin', 'main');
  await fetchOrigin(root);

  const { ctx, view } = await load(root);
  const result = createAdr(ctx, view, { title: 'C' }, { today: TODAY });
  expect(result.written && result.adr.meta.id).toBe('ADR-0003');
});

test('a near-duplicate title is refused with hits; force writes anyway', async () => {
  const root = makeLog({
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'Use PostgreSQL for the persistence layer' }),
  });
  const { ctx, view } = await load(root);
  const refused = createAdr(ctx, view, { title: 'Use PostgreSQL for persistence' }, { today: TODAY });
  expect(refused).toMatchObject({ written: false, duplicates: [{ id: 'ADR-0001' }] });
  expect(ids(root, ctx)).toEqual(['ADR-0001']);
  expect(createAdr(ctx, view, { title: 'Use PostgreSQL for persistence' }, { today: TODAY, force: true }).written).toBe(
    true,
  );
});

test('an unknown tag → INVALID_INPUT listing the allowed tags', async () => {
  const { ctx, view } = await load(makeLog());
  expect(() => createAdr(ctx, view, { title: 'X', tags: ['ghost'] })).toThrow(
    expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('Allowed: frontend, backend') }),
  );
});

test('a read-only cached log → READ_ONLY_LOG and nothing written', async () => {
  const decisions = makeLog();
  const { origin } = initRepo(decisions, { origin: true });
  const code = tmpDir();
  writeFiles(code, { [CODE_CONFIG_FILE]: `log: ${pathToFileURL(origin ?? '').href}\n` });
  const { ctx, view } = await load(code);
  expect(() => createAdr(ctx, view, { title: 'X' })).toThrow(
    expect.objectContaining({ code: 'READ_ONLY_LOG', message: expect.stringContaining('read-only cached clone') }),
  );
  expect(ids(ctx.logRoot, ctx)).toEqual([]);
});

test('acceptAdr needs a review_rule, then accepts and dates the ADR', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  const { ctx, view } = await load(root);
  expect(() => acceptAdr(ctx, view, 'ADR-0001')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  updateAdr(ctx, view, 'ADR-0001', { review_rule: 'Do A.' }, { origin: 'manual' });
  const accepted = acceptAdr(ctx, (await load(root)).view, 'ADR-0001', { today: TODAY });
  expect(accepted.meta).toMatchObject({ status: 'accepted', date: TODAY, review_rule: 'Do A.' });
});

test('supersede links both ADRs and check has no supersede-asymmetry afterwards', async () => {
  const rule = 'A rule.';
  const root = makeLog({
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', status: 'accepted', review_rule: rule }),
    'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B', status: 'accepted', review_rule: rule }),
  });
  const { ctx, view } = await load(root);
  const { old, replacement } = supersede(ctx, view, 'ADR-0001', 'ADR-0002');
  expect(old.meta).toMatchObject({ status: 'superseded', superseded_by: 'ADR-0002' });
  expect(replacement.meta.supersedes).toEqual(['ADR-0001']);
  const after = await load(root);
  expect(await runCheck(after.ctx, after.view)).toEqual([]);
});

test('renumber fixes a base/pending collision and rewrites pending references only', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', related: [] }) });
  initRepo(root, { origin: true });
  writeFiles(root, {
    'docs/adr/ADR-0001-dup.md': adrText({ id: 'ADR-0001', title: 'Dup' }),
    'docs/adr/ADR-0002-c.md': adrText({ id: 'ADR-0002', title: 'C', related: ['ADR-0001'] }),
  });
  const { ctx, view } = await load(root);
  expect(renumber(ctx, view, 'ADR-0001')).toEqual({
    from: 'ADR-0001',
    to: 'ADR-0003',
    path: 'docs/adr/ADR-0003-dup.md',
  });
  expect(existsSync(join(root, 'docs/adr/ADR-0001-dup.md'))).toBe(false);
  const log = readWorkingLog(root, ctx.config).adrs;
  expect(log.find((a) => a.meta.id === 'ADR-0002')?.meta.related).toEqual(['ADR-0003']);
  expect(log.find((a) => a.path === 'docs/adr/ADR-0001-a.md')?.meta.title).toBe('A');
});

test('updateAdr appends a dated note and rejects a status key', async () => {
  const root = makeLog({
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }, '\n## Decision\n\nDo A.\n'),
  });
  const { ctx, view } = await load(root);
  const updated = updateAdr(ctx, view, 'ADR-0001', { tags: ['backend'] }, { note: 'Also backend.', today: TODAY });
  expect(updated.body).toBe('\n## Decision\n\nDo A.\n\n> Proposed change (agent, 2026-11-17): Also backend.\n');
  expect(updated.meta.tags).toEqual(['backend']);
  const patch = { status: 'accepted' } as unknown as Parameters<typeof updateAdr>[3];
  expect(() => updateAdr(ctx, view, 'ADR-0001', patch)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});
