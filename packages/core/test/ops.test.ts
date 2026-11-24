import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runCheck } from '../src/check.ts';
import { CODE_CONFIG_FILE, CONFIG_FILE } from '../src/config.ts';
import { type Context, resolveContext } from '../src/context.ts';
import { BODY_TEMPLATE } from '../src/frontmatter.ts';
import { fetchOrigin } from '../src/git.ts';
import { readWorkingLog, revisionOf, revisionOfText } from '../src/log.ts';
import { acceptAdr, createAdr, renumber, setStatus, supersede, updateAdr } from '../src/ops.ts';
import { type LogView, loadLogView, workingRevision } from '../src/view.ts';
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

test('createAdr records exception_to', async () => {
  const { ctx, view } = await load(makeLog());
  const result = createAdr(
    ctx,
    view,
    { title: 'Depart from it', exception_to: ['shared/ADR-0009'], review_on: '2027-06-01' },
    { today: TODAY },
  );
  expect(result.written && result.adr.meta.exception_to).toEqual(['shared/ADR-0009']);
});

test.each([['ADR-0009'], ['not a ref/'], ['acme/ADR-0009']])(
  "createAdr refuses exception_to %s (a plain id or this log's own name) and writes nothing",
  async (entry) => {
    const { ctx, view } = await load(makeLog());
    const before = readWorkingLog(ctx.logRoot, ctx.config).adrs.length;
    expect(() => createAdr(ctx, view, { title: 'Depart', exception_to: [entry] }, { today: TODAY })).toThrow(
      /exception_to/,
    );
    expect(readWorkingLog(ctx.logRoot, ctx.config).adrs.length).toBe(before);
  },
);

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

test('renumber leaves a workspace/ADR-n reference to another log alone, and rewrites only the local one', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  initRepo(root, { origin: true });
  writeFiles(root, {
    'docs/adr/ADR-0001-dup.md': adrText({ id: 'ADR-0001', title: 'Dup' }),
    'docs/adr/ADR-0002-c.md': adrText({
      id: 'ADR-0002',
      title: 'C',
      related: ['common/ADR-0001', 'ADR-0001'],
    }),
  });
  const { ctx, view } = await load(root);
  renumber(ctx, view, 'ADR-0001');
  const log = readWorkingLog(root, ctx.config).adrs;
  expect(log.find((a) => a.meta.id === 'ADR-0002')?.meta.related).toEqual(['common/ADR-0001', 'ADR-0003']);
});

test('renumber rewrites the references from what is on disk now, not from the stale view, and picks an id nobody took since', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  initRepo(root, { origin: true });
  writeFiles(root, {
    'docs/adr/ADR-0001-dup.md': adrText({ id: 'ADR-0001', title: 'Dup' }),
    'docs/adr/ADR-0002-c.md': adrText({ id: 'ADR-0002', title: 'C', related: ['ADR-0001'] }),
  });
  const { ctx, view } = await load(root);
  // After the view was built, another process edited ADR-0002 and created ADR-0003.
  writeFiles(root, {
    'docs/adr/ADR-0002-c.md': adrText({ id: 'ADR-0002', title: 'C, edited since', related: ['ADR-0001'] }),
    'docs/adr/ADR-0003-new.md': adrText({ id: 'ADR-0003', title: 'Created since' }),
  });
  expect(renumber(ctx, view, 'ADR-0001').to).toBe('ADR-0004');
  const log = readWorkingLog(root, ctx.config).adrs;
  const referencing = log.find((a) => a.meta.id === 'ADR-0002');
  expect(referencing?.meta.title).toBe('C, edited since');
  expect(referencing?.meta.related).toEqual(['ADR-0004']);
  expect(log.find((a) => a.meta.id === 'ADR-0003')?.meta.title).toBe('Created since');
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

test('renumber skips an id a concurrent create has reserved, and leaves no reservation behind', async () => {
  const root = makeLog({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0001-dup.md': adrText({ id: 'ADR-0001', title: 'Dup' }) });
  const { ctx, view } = await load(root);
  // Another process is creating ADR-0002 right now: its marker exists but its file does not yet.
  mkdirSync(join(root, '.adrien'), { recursive: true });
  writeFileSync(join(root, '.adrien', 'create-2.lock'), '');
  expect(renumber(ctx, view, 'ADR-0001').to).toBe('ADR-0003');
  expect(existsSync(join(root, '.adrien', 'create-3.lock'))).toBe(false);
});

test('accept and status return the revision of the file they wrote, so it can be reused as the next base', async () => {
  const root = makeLog({
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', review_rule: 'Do A.' }),
  });
  const { ctx, view } = await load(root);
  const accepted = acceptAdr(ctx, view, 'ADR-0001', { today: TODAY });
  expect(accepted.revision).toBe(revisionOf(root, accepted.path));
  const next = setStatus(ctx, view, 'ADR-0001', 'deprecated', { expectedRevision: accepted.revision });
  expect(next.revision).toBe(revisionOf(root, next.path));
  const edited = updateAdr(ctx, view, 'ADR-0001', { tags: ['backend'] }, { expectedRevision: next.revision });
  expect(edited.revision).toBe(revisionOf(root, edited.path));
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

test('createAdr skips a reservation abandoned by a crashed writer', async () => {
  const root = makeLog({ '.adrien/create-1.lock': '' });
  const { ctx, view } = await load(root);
  expect(createAdr(ctx, view, { title: 'Storage' })).toMatchObject({ adr: { meta: { id: 'ADR-0002' } } });
  expect(existsSync(join(root, '.adrien/create-2.lock'))).toBe(false);
});

test('createAdr retries a number published after its initial scan', async () => {
  const root = makeLog();
  const { ctx, view } = await load(root);
  let published = false;
  const result = createAdr(ctx, view, {
    get title() {
      if (!published) {
        createAdr(ctx, view, { title: 'Caching' });
        published = true;
      }
      return 'Rendering';
    },
  });
  expect(result).toMatchObject({ adr: { meta: { id: 'ADR-0002' } } });
  expect(ids(root, ctx).sort()).toEqual(['ADR-0001', 'ADR-0002']);
});

describe('one writer per ADR', () => {
  const lockFile = (root: string, id: string) => join(root, '.adrien', 'locks', `${id.toLowerCase()}.lock`);
  /** Holds an ADR as a live process of this machine would. */
  function hold(root: string, id: string): void {
    mkdirSync(join(root, '.adrien', 'locks'), { recursive: true });
    writeFileSync(lockFile(root, id), JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }));
  }
  const quick = { ADRIEN_LOCK_TIMEOUT_MS: '100' };
  const ready = (id: string) => adrText({ id, title: `T ${id}`, review_rule: 'A rule.' });

  async function setup() {
    const root = makeLog({
      'docs/adr/ADR-0001-a.md': ready('ADR-0001'),
      'docs/adr/ADR-0002-b.md': ready('ADR-0002'),
    });
    const { ctx, view } = await load(root, quick);
    return { root, ctx, view };
  }

  test.each([
    ['updateAdr', (c: Context, v: LogView) => updateAdr(c, v, 'ADR-0001', { title: 'New title' })],
    ['acceptAdr', (c: Context, v: LogView) => acceptAdr(c, v, 'ADR-0001', { today: TODAY })],
    ['setStatus', (c: Context, v: LogView) => setStatus(c, v, 'ADR-0001', 'rejected')],
    ['supersede, the old ADR', (c: Context, v: LogView) => supersede(c, v, 'ADR-0001', 'ADR-0002')],
    ['supersede, the new ADR', (c: Context, v: LogView) => supersede(c, v, 'ADR-0002', 'ADR-0001')],
    ['renumber', (c: Context, v: LogView) => renumber(c, v, 'ADR-0002')],
  ])('%s fails with ADR_LOCKED while another process holds the ADR, and changes nothing', async (_name, run) => {
    const { root, ctx, view } = await setup();
    const before = readFileSync(join(root, 'docs/adr/ADR-0001-a.md'), 'utf8');
    hold(root, 'ADR-0001');
    expect(() => run(ctx, view)).toThrow(expect.objectContaining({ code: 'ADR_LOCKED' }));
    expect(readFileSync(join(root, 'docs/adr/ADR-0001-a.md'), 'utf8')).toBe(before);
  });

  test('a lock on another ADR does not get in the way', async () => {
    const { root, ctx, view } = await setup();
    hold(root, 'ADR-0002');
    expect(updateAdr(ctx, view, 'ADR-0001', { title: 'Fine' }).meta.title).toBe('Fine');
  });

  test('every operation releases its locks, whether it succeeds or fails', async () => {
    const { root, ctx, view } = await setup();
    updateAdr(ctx, view, 'ADR-0001', { title: 'Done' });
    supersede(ctx, view, 'ADR-0001', 'ADR-0002');
    expect(() => setStatus(ctx, view, 'ADR-0099', 'rejected')).toThrow(
      expect.objectContaining({ code: 'ADR_NOT_FOUND' }),
    );
    expect(readdirSync(join(root, '.adrien', 'locks')).filter((n) => n.endsWith('.lock'))).toEqual([]);
  });

  test('the wait can be tuned with ADRIEN_LOCK_TIMEOUT_MS, and a bad value falls back to the default', async () => {
    const { root } = await setup();
    const { ctx, view } = await load(root, { ADRIEN_LOCK_TIMEOUT_MS: 'soon' });
    // No lock is held, so the default wait is never used: the call just works.
    expect(updateAdr(ctx, view, 'ADR-0001', { title: 'Works' }).meta.title).toBe('Works');
    const zero = await load(root, { ADRIEN_LOCK_TIMEOUT_MS: '-5' });
    expect(updateAdr(zero.ctx, zero.view, 'ADR-0001', { title: 'Still works' }).meta.title).toBe('Still works');
  });
});

describe('a change based on a stale read is refused, like a push after the base moved', () => {
  const ready = (id: string) => adrText({ id, title: `T ${id}`, review_rule: 'A rule.' });
  const REVISION = /^[0-9a-f]{12}$/;

  async function setup() {
    const root = makeLog({ 'docs/adr/ADR-0001-a.md': ready('ADR-0001') });
    const { ctx, view } = await load(root);
    return { root, ctx, view, file: join(root, 'docs/adr/ADR-0001-a.md') };
  }

  /** The revision a reader gets today: from a view built now. */
  const revisionNow = async (root: string, id: string) => workingRevision((await load(root)).view, id);

  test('workingRevision is a short hash of the file that changes with its content and not otherwise', async () => {
    const { root, ctx, view, file } = await setup();
    const first = await revisionNow(root, 'ADR-0001');
    expect(first).toMatch(REVISION);
    expect(await revisionNow(root, 'ADR-0001')).toBe(first);
    updateAdr(ctx, view, 'ADR-0001', { title: 'Another title' });
    expect(await revisionNow(root, 'ADR-0001')).not.toBe(first);
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nedited by hand\n`);
    expect(await revisionNow(root, 'ADR-0001')).toMatch(REVISION);
  });

  test('workingRevision is null for an ADR that is not in the working copy, or whose id is used twice', async () => {
    const root = makeLog({
      'docs/adr/ADR-0001-a.md': ready('ADR-0001'),
      'docs/adr/ADR-0002-b.md': ready('ADR-0002'),
      'docs/adr/ADR-0002-dup.md': ready('ADR-0002'),
    });
    expect(await revisionNow(root, 'ADR-0099')).toBeNull();
    expect(await revisionNow(root, 'ADR-0002')).toBeNull();
    expect(await revisionNow(root, 'ADR-0001')).toMatch(REVISION);
  });

  test('the revision a view gives is never newer than the content the view holds, even if the file changes after it was read', async () => {
    const { root, view, file } = await setup();
    const heldText = readFileSync(file, 'utf8');
    // Another process writes the ADR after the view was built, as one can while the view waits on git.
    writeFileSync(file, heldText.replace('title: T ADR-0001', 'title: Written after'));
    expect(workingRevision(view, 'ADR-0001')).toBe(revisionOfText(heldText));
    expect(workingRevision(view, 'ADR-0001')).not.toBe(revisionOf(root, 'docs/adr/ADR-0001-a.md'));
  });

  test('a change on the revision that was read goes through, and moves the revision on', async () => {
    const { root, ctx, view } = await setup();
    const read = (await revisionNow(root, 'ADR-0001')) as string;
    updateAdr(ctx, view, 'ADR-0001', { title: 'Mine' }, { expectedRevision: read });
    expect(await revisionNow(root, 'ADR-0001')).not.toBe(read);
  });

  test.each([
    [
      'updateAdr',
      (c: Context, v: LogView, r: string) => updateAdr(c, v, 'ADR-0001', { title: 'Mine' }, { expectedRevision: r }),
    ],
    [
      'acceptAdr',
      (c: Context, v: LogView, r: string) => acceptAdr(c, v, 'ADR-0001', { today: TODAY, expectedRevision: r }),
    ],
    [
      'setStatus',
      (c: Context, v: LogView, r: string) => setStatus(c, v, 'ADR-0001', 'rejected', { expectedRevision: r }),
    ],
  ])('%s fails with ADR_CONFLICT when the ADR changed since it was read, and writes nothing', async (_name, run) => {
    const { root, ctx, view, file } = await setup();
    const read = (await revisionNow(root, 'ADR-0001')) as string;
    // Someone else changes the same ADR by another means, right after we read it.
    updateAdr(ctx, view, 'ADR-0001', { title: 'Theirs' });
    const theirs = readFileSync(file, 'utf8');
    const now = await revisionNow(root, 'ADR-0001');
    expect(() => run(ctx, view, read)).toThrow(
      expect.objectContaining({
        code: 'ADR_CONFLICT',
        message: expect.stringContaining(`you based your change on revision ${read}, it is now ${now}`),
      }),
    );
    expect(readFileSync(file, 'utf8')).toBe(theirs);
  });

  test('a conflict says what to do, and releases the lock', async () => {
    const { root, ctx, view } = await setup();
    updateAdr(ctx, view, 'ADR-0001', { title: 'Theirs' });
    expect(() => updateAdr(ctx, view, 'ADR-0001', { title: 'Mine' }, { expectedRevision: '000000000000' })).toThrow(
      /Read it again, redo your change on the latest version, and retry/,
    );
    expect(readdirSync(join(root, '.adrien', 'locks')).filter((n) => n.endsWith('.lock'))).toEqual([]);
  });

  test('without an expected revision a change applies to the latest version, as before', async () => {
    const { ctx, view } = await setup();
    updateAdr(ctx, view, 'ADR-0001', { title: 'First' });
    expect(updateAdr(ctx, view, 'ADR-0001', { title: 'Second' }).meta.title).toBe('Second');
  });
});
