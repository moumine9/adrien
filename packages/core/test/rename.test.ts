import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, vi } from 'vitest';
import { runCheck } from '../src/check.ts';
import { CONFIG_FILE, loadLogConfig } from '../src/config.ts';
import { type Context, resolveContext } from '../src/context.ts';
import { readWorkingLog } from '../src/log.ts';
import { applyWorkspaceRename, planWorkspaceRename } from '../src/rename.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { initRepo } from './helpers/git.ts';

/** Fault injection for the file calls of an apply: `hook` runs before each call and may throw to fail it. */
const faults = vi.hoisted(() => ({
  hook: undefined as undefined | ((op: 'write' | 'rename' | 'unlink', path: string) => void),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    writeFileSync: (...args: Parameters<typeof actual.writeFileSync>) => {
      faults.hook?.('write', String(args[0]));
      return actual.writeFileSync(...args);
    },
    renameSync: (from: string, to: string) => {
      faults.hook?.('rename', to);
      return actual.renameSync(from, to);
    },
    unlinkSync: (file: string) => {
      faults.hook?.('unlink', file);
      return actual.unlinkSync(file);
    },
  };
});

afterEach(() => {
  faults.hook = undefined;
});

const ctxAt = (dir: string, env?: NodeJS.ProcessEnv): Promise<Context> => resolveContext({ cwd: dir, env });

/** The error a synchronous call throws, so a test can check its code. */
function applyError(plan: Parameters<typeof applyWorkspaceRename>[0]): unknown {
  try {
    applyWorkspaceRename(plan);
  } catch (e) {
    return e;
  }
  return undefined;
}

/** The text of every file under `root` (locks and the index live in `.adrien`, which is not part of the log). */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const rel of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (rel.includes('.adrien')) continue;
    const full = join(root, rel);
    if (statSync(full).isFile()) files[rel] = readFileSync(full, 'utf8');
  }
  return files;
}

async function metaOf(ctx: Context, id: string) {
  const adr = readWorkingLog(ctx.logRoot, ctx.config).adrs.find((a) => a.meta.id === id);
  return adr?.meta;
}

const SHARED_RULE = 'docs/adr/ADR-0009-shared.md';

/** A common log at `<root>/shared` named `shared`, with one accepted decision, ADR-0009. */
function sharedFiles(name = 'shared'): Record<string, string> {
  return {
    'shared/adrien.config.yaml': configYaml({ product: 'Shared Co', workspace: name }),
    [`shared/${SHARED_RULE}`]: adrText({
      id: 'ADR-0009',
      title: 'Shared rule',
      status: 'accepted',
      components: ['web'],
      review_rule: 'Shared rule applies.',
    }),
  };
}

/** A product log at `<root>/product` named `acme`, whose common log is `../shared`. */
function productFiles(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: '../shared' }),
    ...extra,
  };
}

test('the target rewrites its own-prefixed references and gets the new workspace field', async () => {
  const root = tmpDir();
  writeFiles(root, {
    'log/adrien.config.yaml': configYaml({ product: 'Old', workspace: 'old' }),
    'log/docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }),
    'log/docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B', related: ['old/ADR-0001', 'ADR-0001'] }),
  });
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  applyWorkspaceRename(plan);
  expect((await metaOf(target, 'ADR-0002'))?.related).toEqual(['new/ADR-0001', 'ADR-0001']);
  expect(loadLogConfig(target.logRoot).workspace).toBe('new');
});

test('renaming a common log rewrites the related and exception_to entries of a product, accepted ones included', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({
        id: 'ADR-0002',
        title: 'Use it',
        status: 'accepted',
        review_rule: 'Use it.',
        review_on: '2027-01-01',
        related: ['shared/ADR-0009'],
        exception_to: ['shared/ADR-0009'],
      }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  applyWorkspaceRename(await planWorkspaceRename({ target: shared, others: [product], to: 'house' }));
  const meta = await metaOf(product, 'ADR-0002');
  expect(meta?.related).toEqual(['house/ADR-0009']);
  expect(meta?.exception_to).toEqual(['house/ADR-0009']);
  expect(meta?.status).toBe('accepted');
});

test('a local id that contains a slash is left alone, even when it starts with the old name', async () => {
  const root = tmpDir();
  writeFiles(root, {
    'log/adrien.config.yaml': configYaml({ product: 'Old', workspace: 'old', id_format: 'old/{n:4}' }),
    'log/docs/adr/old-0001-a.md': adrText({ id: 'old/0001', title: 'A' }),
    'log/docs/adr/old-0002-b.md': adrText({ id: 'old/0002', title: 'B', related: ['old/0001'] }),
  });
  const target = await ctxAt(join(root, 'log'));
  applyWorkspaceRename(await planWorkspaceRename({ target, others: [], to: 'new' }));
  expect((await metaOf(target, 'old/0002'))?.related).toEqual(['old/0001']);
});

test('a new name already used by a log the rename reaches is refused, and nothing is written', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles(),
    'house/adrien.config.yaml': configYaml({ product: 'House', workspace: 'house' }),
  });
  const before = snapshot(root);
  const shared = await ctxAt(join(root, 'shared'));
  const house = await ctxAt(join(root, 'house'));
  await expect(planWorkspaceRename({ target: shared, others: [house], to: 'house' })).rejects.toThrow(/already/);
  expect(snapshot(root)).toEqual(before);
});

test('a new name equal to the own name of the target common log is refused', async () => {
  const root = tmpDir();
  writeFiles(root, { ...sharedFiles('shared-co'), ...productFiles() });
  const product = await ctxAt(join(root, 'product'));
  await expect(planWorkspaceRename({ target: product, others: [], to: 'shared-co' })).rejects.toThrow(/already/);
});

test('a log without an ASCII name among the others does not block a new name', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'kanji/adrien.config.yaml': configYaml({ product: '東京' }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const kanji = await ctxAt(join(root, 'kanji'));
  await expect(planWorkspaceRename({ target: shared, others: [kanji], to: 'house' })).resolves.toMatchObject({
    to: 'house',
  });
});

test('an unreadable common log of the target does not block the rename', async () => {
  const root = tmpDir();
  writeFiles(root, {
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: '../missing' }),
  });
  const product = await ctxAt(join(root, 'product'));
  await expect(planWorkspaceRename({ target: product, others: [], to: 'fresh' })).resolves.toMatchObject({
    from: 'acme',
  });
});

test('a read-only target is refused by the plan, and nothing is written', async () => {
  const root = tmpDir();
  writeFiles(root, sharedFiles());
  const shared = await ctxAt(join(root, 'shared'));
  const before = snapshot(root);
  await expect(planWorkspaceRename({ target: { ...shared, readOnly: true }, others: [], to: 'house' })).rejects.toThrow(
    /read-only/,
  );
  expect(snapshot(root)).toEqual(before);
});

test('a read-only product that has references to rename is refused by the plan', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  await expect(
    planWorkspaceRename({ target: shared, others: [{ ...product, readOnly: true }], to: 'house' }),
  ).rejects.toThrow(/read-only/);
});

test('apply refuses a plan whose log is read-only, and writes nothing', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  const before = snapshot(root);
  const frozen = { ...plan, edits: plan.edits.map((edit) => ({ ...edit, readOnly: true })) };
  expect(() => applyWorkspaceRename(frozen)).toThrow(/read-only/);
  expect(snapshot(root)).toEqual(before);
});

test('a product whose slug-only name gains a workspace field and keeps its product name', async () => {
  const root = tmpDir();
  writeFiles(root, { 'log/adrien.config.yaml': configYaml({ product: 'Acme Store' }) });
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'store' });
  expect(plan.from).toBe('acme-store');
  applyWorkspaceRename(plan);
  const config = loadLogConfig(target.logRoot);
  expect(config).toMatchObject({ product: 'Acme Store', workspace: 'store' });
});

test('a log with no name to rename is refused, with a hint to set the field by hand', async () => {
  const root = tmpDir();
  writeFiles(root, { 'log/adrien.config.yaml': configYaml({ product: '東京' }) });
  const target = await ctxAt(join(root, 'log'));
  await expect(planWorkspaceRename({ target, others: [], to: 'tokyo' })).rejects.toThrow(/workspace/);
});

test('comments and key order in the config survive the rename', async () => {
  const root = tmpDir();
  writeFiles(root, {
    'log/adrien.config.yaml': [
      '# Acme, kept by hand',
      'product: Acme',
      'workspace: acme # short name',
      'adr_dir: docs/adr',
      'id_format: "ADR-{n:4}"',
      'tags: []',
      'components: {}',
      '',
    ].join('\n'),
  });
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'store' });
  expect(plan.config.text).toBe(
    [
      '# Acme, kept by hand',
      'product: Acme',
      'workspace: store # short name',
      'adr_dir: docs/adr',
      'id_format: "ADR-{n:4}"',
      'tags: []',
      'components: {}',
      '',
    ].join('\n'),
  );
});

test('two logs that both refer to the old name are each rewritten, and other workspaces are left alone', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'shared/docs/adr/ADR-0010-next.md': adrText({
      id: 'ADR-0010',
      title: 'Next',
      related: ['shared/ADR-0009', 'other/ADR-0003', 'ADR-0009', 'ADR-0001'],
    }),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  applyWorkspaceRename(await planWorkspaceRename({ target: shared, others: [product], to: 'house' }));
  expect((await metaOf(shared, 'ADR-0010'))?.related).toEqual([
    'house/ADR-0009',
    'other/ADR-0003',
    'ADR-0009',
    'ADR-0001',
  ]);
  expect((await metaOf(product, 'ADR-0002'))?.related).toEqual(['house/ADR-0009']);
});

test('a product whose common is a git URL of a log named as the target is rewritten too', async () => {
  const shared = tmpDir();
  writeFiles(shared, {
    [CONFIG_FILE]: configYaml({ product: 'Shared Co', workspace: 'shared' }),
    'docs/adr/ADR-0009-shared.md': adrText({
      id: 'ADR-0009',
      title: 'Shared rule',
      status: 'accepted',
      review_rule: 'Shared rule applies.',
    }),
  });
  const { origin } = initRepo(shared, { origin: true });
  const url = pathToFileURL(origin ?? '').href;
  const root = tmpDir();
  writeFiles(root, {
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: url }),
    'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
  });
  const env = { ADRIEN_HOME: tmpDir() };
  const target = await ctxAt(shared);
  const product = await ctxAt(join(root, 'product'), env);
  applyWorkspaceRename(await planWorkspaceRename({ target, others: [product], to: 'house' }));
  expect((await metaOf(product, 'ADR-0002'))?.related).toEqual(['house/ADR-0009']);
});

test('an exception_to entry is renamed even when a local id of the product has the same text', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'product/adrien.config.yaml': configYaml({
      product: 'Acme',
      workspace: 'acme',
      common: '../shared',
      id_format: 'shared/{n:4}',
    }),
    'product/docs/adr/shared-0009-local.md': adrText({ id: 'shared/0009', title: 'Local' }),
    'product/docs/adr/shared-0010-skip.md': adrText({
      id: 'shared/0010',
      title: 'Skip',
      related: ['shared/0009'],
      exception_to: ['shared/0009'],
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  applyWorkspaceRename(await planWorkspaceRename({ target: shared, others: [product], to: 'house' }));
  const meta = await metaOf(product, 'shared/0010');
  expect(meta?.exception_to).toEqual(['house/0009']);
  expect(meta?.related).toEqual(['shared/0009']);
});

/** A log named `shared` that is its own git repo with an origin, and the file URL of that origin. */
function remoteShared(): { dir: string; url: string } {
  const dir = tmpDir();
  writeFiles(dir, {
    [CONFIG_FILE]: configYaml({ product: 'Shared Co', workspace: 'shared' }),
    'docs/adr/ADR-0009-shared.md': adrText({ id: 'ADR-0009', title: 'Shared rule', status: 'accepted' }),
  });
  const { origin } = initRepo(dir, { origin: true });
  return { dir, url: pathToFileURL(origin ?? '').href };
}

test.each([
  ['the target has another origin', true, /not this log's repository/],
  ['the target has no origin', false, /no `origin`/],
])(
  'a product whose git URL common is another repo with the same name is left alone and noted (%s)',
  async (_n, hasOrigin, wording) => {
    const stranger = remoteShared();
    const target = tmpDir();
    writeFiles(target, {
      [CONFIG_FILE]: configYaml({ product: 'Shared Co', workspace: 'shared' }),
      'docs/adr/ADR-0009-shared.md': adrText({ id: 'ADR-0009', title: 'Shared rule', status: 'accepted' }),
    });
    initRepo(target, { origin: hasOrigin });
    const root = tmpDir();
    writeFiles(root, {
      'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: stranger.url }),
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    });
    const env = { ADRIEN_HOME: tmpDir() };
    const product = await ctxAt(join(root, 'product'), env);
    const plan = await planWorkspaceRename({ target: await ctxAt(target), others: [product], to: 'house' });
    applyWorkspaceRename(plan);
    expect((await metaOf(product, 'ADR-0002'))?.related).toEqual(['shared/ADR-0009']);
    expect(plan.notes.join('\n')).toMatch(wording);
  },
);

test('a product whose git URL common is the repo of a subfolder target is left alone and noted', async () => {
  const repo = tmpDir();
  writeFiles(repo, {
    [CONFIG_FILE]: configYaml({ product: 'Root Co', workspace: 'root' }),
    'sub/adrien.config.yaml': configYaml({ product: 'Shared Co', workspace: 'shared' }),
    'sub/docs/adr/ADR-0009-shared.md': adrText({ id: 'ADR-0009', title: 'Shared rule', status: 'accepted' }),
  });
  const { origin } = initRepo(repo, { origin: true });
  const root = tmpDir();
  writeFiles(root, {
    'product/adrien.config.yaml': configYaml({
      product: 'Acme',
      workspace: 'acme',
      common: pathToFileURL(origin ?? '').href,
    }),
    'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['root/ADR-0001'] }),
  });
  const product = await ctxAt(join(root, 'product'), { ADRIEN_HOME: tmpDir() });
  const plan = await planWorkspaceRename({
    target: await ctxAt(join(repo, 'sub')),
    others: [product],
    to: 'house',
  });
  expect(plan.edits).toEqual([]);
  expect(plan.notes.join('\n')).toMatch(/subfolder/);
});

test('a rename is refused, and nothing written, when a rewritten related entry would name a local id', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'product/adrien.config.yaml': configYaml({
      product: 'Acme',
      workspace: 'acme',
      common: '../shared',
      id_format: 'house/{n:4}',
    }),
    'product/docs/adr/house-0009-local.md': adrText({ id: 'house/0009', title: 'Local' }),
    'product/docs/adr/house-0010-next.md': adrText({ id: 'house/0010', title: 'Next', related: ['shared/0009'] }),
  });
  const before = snapshot(root);
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  await expect(planWorkspaceRename({ target: shared, others: [product], to: 'house' })).rejects.toThrow(
    /house\/0009.*local id/,
  );
  expect(snapshot(root)).toEqual(before);
});

test('a local id created after the plan that a rewritten related entry would name refuses the apply', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'product/adrien.config.yaml': configYaml({
      product: 'Acme',
      workspace: 'acme',
      common: '../shared',
      id_format: 'house/{n:4}',
    }),
    'product/docs/adr/house-0010-next.md': adrText({ id: 'house/0010', title: 'Next', related: ['shared/0009'] }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  writeFiles(root, { 'product/docs/adr/house-0009-local.md': adrText({ id: 'house/0009', title: 'Local' }) });
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

test('a linked product with the same own name keeps its self-prefixed references, and a note says so', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'shared', common: '../shared' }),
    'product/docs/adr/ADR-0001-local.md': adrText({ id: 'ADR-0001', title: 'Local' }),
    'product/docs/adr/ADR-0002-next.md': adrText({ id: 'ADR-0002', title: 'Next', related: ['shared/ADR-0001'] }),
  });
  const before = snapshot(join(root, 'product'));
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  applyWorkspaceRename(plan);
  expect(snapshot(join(root, 'product'))).toEqual(before);
  expect(plan.notes.join('\n')).toMatch(/same name/);
});

test('a change to the configuration of an edited product since the plan refuses the apply', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  writeFiles(root, {
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'shared', common: '../shared' }),
  });
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

/** The link diagnostics `check` reports for a log, as `code message` lines. */
async function linkProblems(dir: string, env: NodeJS.ProcessEnv): Promise<string[]> {
  const ctx = await ctxAt(dir, env);
  const diags = await runCheck(ctx, await loadLogView(ctx.logRoot, ctx.config));
  return diags
    .filter((d) => ['broken-link', 'invalid-ref', 'unresolved-ref'].includes(d.code))
    .map((d) => `${d.code} ${d.message}`);
}

test('check reports the same link problems on every log before and after a rename', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'shared/docs/adr/ADR-0010-next.md': adrText({
      id: 'ADR-0010',
      title: 'Next',
      related: ['shared/ADR-0009', 'ADR-0009'],
    }),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({
        id: 'ADR-0002',
        title: 'Use it',
        related: ['shared/ADR-0009', 'other/ADR-0003'],
        exception_to: ['shared/ADR-0009'],
      }),
    }),
  });
  const env = { ADRIEN_HOME: tmpDir() };
  const dirs = [join(root, 'shared'), join(root, 'product')];
  const before = await Promise.all(dirs.map((dir) => linkProblems(dir, env)));
  const shared = await ctxAt(dirs[0] as string);
  const product = await ctxAt(dirs[1] as string);
  applyWorkspaceRename(await planWorkspaceRename({ target: shared, others: [product], to: 'house' }));
  const after = await Promise.all(dirs.map((dir) => linkProblems(dir, env)));
  expect(after.map((lines) => lines.map((l) => l.split(' ')[0]))).toEqual(
    before.map((lines) => lines.map((l) => l.split(' ')[0])),
  );
});

test('a same-named product with no entries naming the old name gets no note', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'shared', common: '../shared' }),
    'product/docs/adr/ADR-0001-local.md': adrText({ id: 'ADR-0001', title: 'Local' }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  expect(plan.notes).toEqual([]);
});

test('a product whose URL common is the root log of the repo is left alone when a subfolder log is renamed', async () => {
  const repo = tmpDir();
  writeFiles(repo, {
    [CONFIG_FILE]: configYaml({ product: 'Root Co', workspace: 'shared' }),
    'docs/adr/ADR-0009-shared.md': adrText({ id: 'ADR-0009', title: 'Root rule', status: 'accepted' }),
    'sub/adrien.config.yaml': configYaml({ product: 'Sub Co', workspace: 'shared' }),
    'sub/docs/adr/ADR-0001-sub.md': adrText({ id: 'ADR-0001', title: 'Sub rule', status: 'accepted' }),
  });
  const { origin } = initRepo(repo, { origin: true });
  const root = tmpDir();
  writeFiles(root, {
    'product/adrien.config.yaml': configYaml({
      product: 'Acme',
      workspace: 'acme',
      common: pathToFileURL(origin ?? '').href,
    }),
    'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
  });
  const product = await ctxAt(join(root, 'product'), { ADRIEN_HOME: tmpDir() });
  const plan = await planWorkspaceRename({ target: await ctxAt(join(repo, 'sub')), others: [product], to: 'house' });
  expect(plan.edits).toEqual([]);
  expect(plan.notes.join('\n')).toMatch(/subfolder/);
});

test('a configuration that changed after the context was resolved refuses the plan', async () => {
  const root = tmpDir();
  writeFiles(root, sharedFiles());
  const shared = await ctxAt(join(root, 'shared'));
  writeFiles(root, { 'shared/adrien.config.yaml': configYaml({ product: 'Shared Co', workspace: 'intermediate' }) });
  await expect(planWorkspaceRename({ target: shared, others: [], to: 'house' })).rejects.toMatchObject({
    code: 'ADR_CONFLICT',
  });
});

test('a product configuration that changed after its context was resolved refuses the plan', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  writeFiles(root, {
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'shared', common: '../shared' }),
  });
  await expect(planWorkspaceRename({ target: shared, others: [product], to: 'house' })).rejects.toMatchObject({
    code: 'ADR_CONFLICT',
  });
});

test('a product whose URL common is the origin of the target is rewritten even when the clone cannot be made', async () => {
  const shared = tmpDir();
  writeFiles(shared, {
    [CONFIG_FILE]: configYaml({ product: 'Shared Co', workspace: 'shared' }),
    'docs/adr/ADR-0009-shared.md': adrText({ id: 'ADR-0009', title: 'Shared rule', status: 'accepted' }),
  });
  const { origin } = initRepo(shared, { origin: true });
  const url = pathToFileURL(origin ?? '').href;
  rmSync(origin ?? '', { recursive: true, force: true });
  const root = tmpDir();
  writeFiles(root, {
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: url }),
    'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
  });
  const product = await ctxAt(join(root, 'product'), { ADRIEN_HOME: tmpDir() });
  applyWorkspaceRename(await planWorkspaceRename({ target: await ctxAt(shared), others: [product], to: 'house' }));
  expect((await metaOf(product, 'ADR-0002'))?.related).toEqual(['house/ADR-0009']);
});

test('a product whose common log cannot be read and is not known to be the target is noted, not skipped silently', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: '../missing' }),
  });
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: await ctxAt(join(root, 'shared')), others: [product], to: 'house' });
  expect(plan.notes.join('\n')).toMatch(/could not be read/);
});

test('supersedes and superseded_by are never touched', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    [`shared/docs/adr/ADR-0010-next.md`]: adrText({
      id: 'ADR-0010',
      title: 'Next',
      supersedes: ['shared/ADR-0001'],
      related: ['shared/ADR-0009'],
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  applyWorkspaceRename(await planWorkspaceRename({ target: shared, others: [], to: 'house' }));
  const meta = await metaOf(shared, 'ADR-0010');
  expect(meta?.supersedes).toEqual(['shared/ADR-0001']);
  expect(meta?.related).toEqual(['house/ADR-0009']);
});

test('a new name that is not a valid workspace name, or is the current one, is refused', async () => {
  const root = tmpDir();
  writeFiles(root, sharedFiles());
  const shared = await ctxAt(join(root, 'shared'));
  await expect(planWorkspaceRename({ target: shared, others: [], to: 'Bad Name' })).rejects.toThrow(/not a valid/);
  await expect(planWorkspaceRename({ target: shared, others: [], to: 'shared' })).rejects.toThrow(/already/);
});

test('a product whose common log is another log is not touched', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'other/adrien.config.yaml': configYaml({ product: 'Other', workspace: 'other' }),
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: '../other' }),
    'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  expect(plan.edits).toEqual([]);
  applyWorkspaceRename(plan);
  expect((await metaOf(product, 'ADR-0002'))?.related).toEqual(['shared/ADR-0009']);
});

test('a rewrite leaves the rest of the ADR file identical', async () => {
  const root = tmpDir();
  const before = adrText(
    {
      id: 'ADR-0002',
      title: 'Use it',
      status: 'accepted',
      review_rule: 'Use it.',
      related: ['shared/ADR-0009'],
      tags: ['backend'],
    },
    '## Context\n\nA body that stays.\n',
  );
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({ 'product/docs/adr/ADR-0002-use-it.md': before }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  applyWorkspaceRename(await planWorkspaceRename({ target: shared, others: [product], to: 'house' }));
  const after = readFileSync(join(root, 'product/docs/adr/ADR-0002-use-it.md'), 'utf8');
  expect(after).toBe(before.replace('shared/ADR-0009', 'house/ADR-0009'));
});

test('a file that cannot be read is reported in the notes and its references are not checked', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0003-broken.md': '---\nid: [broken\n---\n\nBody\n',
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  expect(plan.notes.join('\n')).toContain('ADR-0003-broken.md');
});

test('apply refuses when an ADR changed after the plan, and writes nothing', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  const adrFile = join(root, 'product/docs/adr/ADR-0002-use-it.md');
  writeFileSync(adrFile, `${readFileSync(adrFile, 'utf8')}\nA later edit.\n`);
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

test('apply refuses when an ADR was removed after the plan, and writes nothing', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  rmSync(join(root, 'product/docs/adr/ADR-0002-use-it.md'));
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

test('apply refuses when the config changed after the plan, and writes no ADR', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  const configFile = join(root, 'shared', CONFIG_FILE);
  writeFileSync(configFile, `# edited\n${readFileSync(configFile, 'utf8')}`);
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

/** The temp files a write may have left under `root`. */
const tempFilesIn = (root: string): string[] =>
  readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((rel) => rel.includes('.tmp-'));

/** Makes the first `op` on `path` throw `error`; later calls go through, so a restore of that file can succeed. */
function failOnce(op: 'write' | 'rename' | 'unlink', path: string, error: Error): void {
  let spent = false;
  faults.hook = (called, target) => {
    if (!spent && called === op && target === path) {
      spent = true;
      throw error;
    }
  };
}

/** A shared log, and a product whose three ADRs each refer to the shared decision: an apply writes three ADRs, then the config. */
function renameFixture(): { root: string; one: string; two: string; three: string; config: string } {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0001-use-one.md': adrText({
        id: 'ADR-0001',
        title: 'Use one',
        related: ['shared/ADR-0009'],
      }),
      'product/docs/adr/ADR-0002-use-two.md': adrText({
        id: 'ADR-0002',
        title: 'Use two',
        related: ['shared/ADR-0009'],
      }),
      'product/docs/adr/ADR-0003-use-three.md': adrText({
        id: 'ADR-0003',
        title: 'Use three',
        related: ['shared/ADR-0009'],
      }),
    }),
  });
  return {
    root,
    one: join(root, 'product/docs/adr/ADR-0001-use-one.md'),
    two: join(root, 'product/docs/adr/ADR-0002-use-two.md'),
    three: join(root, 'product/docs/adr/ADR-0003-use-three.md'),
    config: join(root, 'shared', CONFIG_FILE),
  };
}

async function fixturePlan(root: string) {
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  return planWorkspaceRename({ target: shared, others: [product], to: 'house' });
}

test('a rename that succeeds leaves no temp file behind', async () => {
  const { root } = renameFixture();
  applyWorkspaceRename(await fixturePlan(root));
  expect(tempFilesIn(root)).toEqual([]);
});

test('a write that fails midway puts every file back as it was, and rethrows the original error', async () => {
  const { root, two } = renameFixture();
  const plan = await fixturePlan(root);
  const before = snapshot(root);
  const injected = new Error('disk full');
  failOnce('rename', two, injected);
  expect(applyError(plan)).toBe(injected);
  expect(snapshot(root)).toEqual(before);
  expect(tempFilesIn(root)).toEqual([]);
});

test('a config write that fails after every ADR was written restores all of them', async () => {
  const { root, config } = renameFixture();
  const plan = await fixturePlan(root);
  const before = snapshot(root);
  const injected = new Error('config locked');
  failOnce('rename', config, injected);
  expect(applyError(plan)).toBe(injected);
  expect(snapshot(root)).toEqual(before);
  expect(tempFilesIn(root)).toEqual([]);
});

test('a temp file whose write fails is removed, and the original error is rethrown', async () => {
  const { root, config } = renameFixture();
  const plan = await fixturePlan(root);
  const before = snapshot(root);
  const injected = new Error('no space left');
  failOnce('write', `${config}.tmp-${process.pid}`, injected);
  expect(applyError(plan)).toBe(injected);
  expect(snapshot(root)).toEqual(before);
  expect(tempFilesIn(root)).toEqual([]);
});

test('a temp file that cannot be removed does not hide the original error', async () => {
  const { root, config } = renameFixture();
  const plan = await fixturePlan(root);
  const injected = new Error('no space left');
  const temp = `${config}.tmp-${process.pid}`;
  let spent = false;
  faults.hook = (op, path) => {
    if (op === 'write' && path === temp && !spent) {
      spent = true;
      throw injected;
    }
    if (op === 'unlink') throw new Error('unlink refused');
  };
  expect(applyError(plan)).toBe(injected);
});

test('a restore that also fails names each file as restored, left renamed or unchanged', async () => {
  const { root, one, two, three, config } = renameFixture();
  const plan = await fixturePlan(root);
  const injected = new Error('disk full');
  let spent = false;
  faults.hook = (op, path) => {
    if (op !== 'rename') return;
    if (path === two && !spent) {
      spent = true;
      throw injected;
    }
    if (path === one && spent) throw new Error('read-only volume');
  };
  const error = applyError(plan);
  expect(error).toMatchObject({ code: 'ADR_CONFLICT' });
  const message = (error as Error).message;
  expect(message).toContain('disk full');
  expect(message).toContain(`${one}: left renamed`);
  expect(message).toContain('mixed state');
  expect(message).toContain(`${two}: unchanged`);
  expect(message).toContain(`${three}: unchanged`);
  expect(message).toContain(`${config}: unchanged`);
});

test('a symlinked ADR is rewritten through the link, which stays a link', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    'product/store/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: '../shared' }),
  });
  mkdirSync(join(root, 'product/docs/adr'), { recursive: true });
  const link = join(root, 'product/docs/adr/ADR-0002-use-it.md');
  symlinkSync(join(root, 'product/store/ADR-0002-use-it.md'), link);
  applyWorkspaceRename(await fixturePlan(root));
  expect(lstatSync(link).isSymbolicLink()).toBe(true);
  expect(readFileSync(link, 'utf8')).toContain('house/ADR-0009');
});
