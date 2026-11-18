import { existsSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
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

test('createAdr writes the body template chosen by the call, else the config, else standard', async () => {
  const root = makeLog();
  const { ctx, view } = await load(root);
  const minimal = createAdr(ctx, view, { title: 'Minimal one', template: 'minimal' }, { today: TODAY });
  expect(minimal.written && minimal.adr.body).toBe('\n## Context\n\n## Decision\n\n## Consequences\n');
  const madr = createAdr(ctx, view, { title: 'Madr one, other', template: 'madr' }, { today: TODAY });
  expect(madr.written && madr.adr.body).toContain('## Decision Outcome\n\n### Consequences\n\n### Confirmation\n');
  const configured = { ...ctx, config: { ...ctx.config, template: 'minimal' as const } };
  const fromConfig = createAdr(configured, view, { title: 'From the config' }, { today: TODAY });
  expect(fromConfig.written && fromConfig.adr.body).toBe('\n## Context\n\n## Decision\n\n## Consequences\n');
});

test('createAdr records review_on', async () => {
  const { ctx, view } = await load(makeLog());
  const result = createAdr(ctx, view, { title: 'Revisit me', review_on: '2027-06-01' }, { today: TODAY });
  expect(result.written && result.adr.meta.review_on).toBe('2027-06-01');
});

test('a --subdir that escapes the ADR dir → INVALID_INPUT and nothing written', async () => {
  const root = makeLog();
  const { ctx, view } = await load(root);
  for (const subdir of ['../../outside', '..', 'a/../../x']) {
    expect(() => createAdr(ctx, view, { title: 'X', subdir }, { today: TODAY })).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT' }),
    );
  }
  expect(existsSync(join(root, 'outside'))).toBe(false);
  const nested = createAdr(ctx, view, { title: 'Y', subdir: 'backend/db' }, { today: TODAY });
  expect(nested.written && nested.adr.path).toBe('docs/adr/backend/db/ADR-0001-y.md');
});

test('createAdr allocates from the files on disk, not from a stale view', async () => {
  const root = makeLog();
  const { ctx, view } = await load(root);
  const first = createAdr(ctx, view, { title: 'First topic' }, { today: TODAY });
  const second = createAdr(ctx, view, { title: 'Second topic, unrelated' }, { today: TODAY });
  expect([first, second].map((r) => r.written && r.adr.meta.id)).toEqual(['ADR-0001', 'ADR-0002']);
  expect(ids(root, ctx).sort()).toEqual(['ADR-0001', 'ADR-0002']);
});

test('createAdr never overwrites a file, even one it cannot parse', async () => {
  const garbage = '---\n: bad: [\n---\n';
  const root = makeLog({ 'docs/adr/ADR-0001-x.md': garbage });
  const { ctx, view } = await load(root);
  expect(() => createAdr(ctx, view, { title: 'X' }, { today: TODAY })).toThrow(
    expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('already exists') }),
  );
  expect(readFileSync(join(root, 'docs/adr/ADR-0001-x.md'), 'utf8')).toBe(garbage);
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

test.skipIf(process.platform === 'win32')(
  'an ADR that is a symlink out of the log is never written through',
  async () => {
    const outside = join(tmpDir(), 'elsewhere.md');
    const original = adrText({ id: 'ADR-0001', title: 'A' });
    writeFileSync(outside, original);
    const root = makeLog();
    writeFiles(root, { 'docs/adr/.keep': '' });
    symlinkSync(outside, join(root, 'docs/adr/ADR-0001-a.md'));
    const { ctx, view } = await load(root);
    expect(() => updateAdr(ctx, view, 'ADR-0001', { review_rule: 'Changed.' })).toThrow(
      expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('outside the log') }),
    );
    expect(readFileSync(outside, 'utf8')).toBe(original);
  },
);

test('an id_format with path separators cannot put a new ADR outside the ADR directory', async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml({ id_format: '../ADR-{n:4}' }) });
  const { ctx, view } = await load(root);
  expect(() => createAdr(ctx, view, { title: 'X' }, { today: TODAY })).toThrow(
    expect.objectContaining({ code: 'INVALID_INPUT' }),
  );
  expect(existsSync(join(root, 'docs/ADR-0001-x.md'))).toBe(false);
});

test('renumber never overwrites a file that already holds the next id, and leaves the source intact', async () => {
  const garbage = '---\n: bad: [\n---\n';
  const root = makeLog({
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }),
    'docs/adr/ADR-0001-dup.md': adrText({ id: 'ADR-0001', title: 'Dup' }),
    'docs/adr/ADR-0002-dup.md': garbage,
  });
  initRepo(root, { origin: true });
  const { ctx, view } = await load(root);
  expect(() => renumber(ctx, view, 'ADR-0001', { path: 'docs/adr/ADR-0001-dup.md' })).toThrow(
    expect.objectContaining({ code: 'INVALID_INPUT', message: expect.stringContaining('already exists') }),
  );
  expect(readFileSync(join(root, 'docs/adr/ADR-0002-dup.md'), 'utf8')).toBe(garbage);
  expect(existsSync(join(root, 'docs/adr/ADR-0001-dup.md'))).toBe(true);
});

test('renumber keeps the file when it is already named for the new id', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0002-dup.md': adrText({ id: 'ADR-0001', title: 'Dup' }) });
  const { ctx, view } = await load(root);
  expect(renumber(ctx, view, 'ADR-0001')).toMatchObject({ to: 'ADR-0002', path: 'docs/adr/ADR-0002-dup.md' });
  expect(readFileSync(join(root, 'docs/adr/ADR-0002-dup.md'), 'utf8')).toContain('id: ADR-0002');
});

test('two edits made from the same stale view both survive', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  const { ctx, view } = await load(root);
  updateAdr(ctx, view, 'ADR-0001', { review_rule: 'First rule.' }, { note: 'first', today: TODAY });
  updateAdr(ctx, view, 'ADR-0001', { tags: ['backend'] }, { note: 'second', today: TODAY });
  const text = readFileSync(join(root, 'docs/adr/ADR-0001-a.md'), 'utf8');
  expect(text).toContain('review_rule: First rule.');
  expect(text).toContain('tags: [backend]');
  expect(text).toContain('first');
  expect(text).toContain('second');
});

test('supersede refuses an ADR that supersedes itself, before writing anything', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  const before = readFileSync(join(root, 'docs/adr/ADR-0001-a.md'), 'utf8');
  const { ctx, view } = await load(root);
  expect(() => supersede(ctx, view, 'ADR-0001', 'ADR-0001')).toThrow(
    expect.objectContaining({ code: 'INVALID_INPUT' }),
  );
  expect(readFileSync(join(root, 'docs/adr/ADR-0001-a.md'), 'utf8')).toBe(before);
});
