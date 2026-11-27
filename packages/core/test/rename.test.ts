import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, vi } from 'vitest';
import { runCheck } from '../src/check.ts';
import { CONFIG_FILE, loadLogConfig } from '../src/config.ts';
import { type Context, resolveContext } from '../src/context.ts';
import { withFolderLock } from '../src/lock.ts';
import { readWorkingLog } from '../src/log.ts';
import { acceptAdr, createAdr, updateAdr } from '../src/ops.ts';
import { applyWorkspaceRename, planReferenceCatchUp, planWorkspaceRename } from '../src/rename.ts';
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
    // Keys use `/` on every platform, so a test can name a file the same way everywhere.
    if (statSync(full).isFile()) files[rel.replaceAll('\\', '/')] = readFileSync(full, 'utf8');
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
  expect(plan.config?.text).toBe(
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
  // The only note is the target's own folder, which is not named after the workspace: the product adds none.
  expect(plan.notes).toEqual(['The ADR folder docs/adr is not named after the workspace, so it was left where it is.']);
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
    'shared/docs/adr/ADR-0010-next.md': adrText({
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

test('a temp file whose write fails after it was created is removed, and the original error is rethrown', async () => {
  const { root } = renameFixture();
  const plan = await fixturePlan(root);
  const before = snapshot(root);
  const injected = new Error('no space left');
  let spent = false;
  // The temp file is written through its descriptor, which the hook sees as a number.
  faults.hook = (op, path) => {
    if (op === 'write' && /^\d+$/.test(path) && !spent) {
      spent = true;
      throw injected;
    }
  };
  expect(applyError(plan)).toBe(injected);
  expect(snapshot(root)).toEqual(before);
  expect(tempFilesIn(root)).toEqual([]);
});

test('a temp file that cannot be removed does not hide the original error', async () => {
  const { root, config } = renameFixture();
  const plan = await fixturePlan(root);
  const injected = new Error('no space left');
  let spent = false;
  faults.hook = (op, path) => {
    if (op === 'rename' && path === config && !spent) {
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

test('a temp path that already exists, as a link to a file elsewhere, is never written through', async () => {
  const { root, one } = renameFixture();
  const plan = await fixturePlan(root);
  const outside = join(tmpDir(), 'outside.txt');
  writeFileSync(outside, 'keep me');
  const temp = `${one}.tmp-${process.pid}`;
  symlinkSync(outside, temp);
  expect(applyError(plan)).toMatchObject({ code: 'EEXIST' });
  expect(readFileSync(outside, 'utf8')).toBe('keep me');
  expect(lstatSync(temp).isSymbolicLink()).toBe(true);
  expect(readFileSync(one, 'utf8')).toContain('shared/ADR-0009');
});

/** A common log named `house` (already renamed), and a product `acme` whose own ADRs are given. */
function catchUpFiles(extra: Record<string, string> = {}): Record<string, string> {
  return { ...sharedFiles('house'), ...productFiles(extra) };
}

/** Three product ADRs that name the old workspace, so a catch-up writes three files. */
function catchUpFixture(): { root: string; two: string; config: string } {
  const root = tmpDir();
  writeFiles(
    root,
    catchUpFiles({
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
  );
  return {
    root,
    two: join(root, 'product/docs/adr/ADR-0002-use-two.md'),
    config: join(root, 'product', CONFIG_FILE),
  };
}

async function catchUpPlan(root: string) {
  const product = await ctxAt(join(root, 'product'));
  return planReferenceCatchUp({ logs: [product], from: 'shared', to: 'house' });
}

test('catch-up rewrites the related and exception_to entries that name the old name, and leaves the others', async () => {
  const root = tmpDir();
  writeFiles(
    root,
    catchUpFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({
        id: 'ADR-0002',
        title: 'Use it',
        related: ['shared/ADR-0009', 'other/ADR-0003', 'ADR-0001'],
        exception_to: ['shared/ADR-0009'],
      }),
    }),
  );
  const product = await ctxAt(join(root, 'product'));
  const before = snapshot(root);
  const plan = await planReferenceCatchUp({ logs: [product], from: 'shared', to: 'house' });
  expect(plan.config).toBeNull();
  applyWorkspaceRename(plan);
  const meta = await metaOf(product, 'ADR-0002');
  expect(meta?.related).toEqual(['house/ADR-0009', 'other/ADR-0003', 'ADR-0001']);
  expect(meta?.exception_to).toEqual(['house/ADR-0009']);
  const after = snapshot(root);
  expect(Object.keys(after).filter((rel) => after[rel] !== before[rel])).toEqual([
    'product/docs/adr/ADR-0002-use-it.md',
  ]);
});

test.each<[string, Record<string, string>, RegExp]>([
  [
    'has no common field',
    { ...sharedFiles('house'), 'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme' }) },
    /has no common field/,
  ],
  [
    'names a common log that is named otherwise',
    { ...sharedFiles('other'), ...productFiles() },
    /named "other", not "house"/,
  ],
  [
    'names a common log that is still named from',
    { ...sharedFiles('shared'), ...productFiles() },
    /still named "shared"/,
  ],
  [
    'names a common log that cannot be read',
    {
      ...sharedFiles('house'),
      'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: '../missing' }),
    },
    /cannot be read/,
  ],
  [
    'is itself named from',
    {
      ...sharedFiles('house'),
      'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'shared', common: '../shared' }),
    },
    /its own decisions/,
  ],
  [
    'is itself named to',
    {
      ...sharedFiles('house'),
      'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'house', common: '../shared' }),
    },
    /already named "house"/,
  ],
])('catch-up refuses a product whose log %s', async (_case, files, wording) => {
  const root = tmpDir();
  writeFiles(root, files);
  const product = await ctxAt(join(root, 'product'));
  await expect(planReferenceCatchUp({ logs: [product], from: 'shared', to: 'house' })).rejects.toThrow(wording);
});

test('catch-up refuses a new name that is not a valid workspace name, or is the old one', async () => {
  const root = tmpDir();
  writeFiles(root, catchUpFiles());
  const product = await ctxAt(join(root, 'product'));
  await expect(planReferenceCatchUp({ logs: [product], from: 'shared', to: 'Bad Name' })).rejects.toThrow(
    /not a valid/,
  );
  await expect(planReferenceCatchUp({ logs: [product], from: 'shared', to: 'shared' })).rejects.toThrow(/the old one/);
});

test('catch-up refuses a rewritten related entry that would name a local id, and writes nothing', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles('house'),
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
  await expect(catchUpPlan(root)).rejects.toThrow(/house\/0009.*local id/);
  expect(snapshot(root)).toEqual(before);
});

test('catch-up over several logs refuses all of them when one fails, and writes nothing', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...catchUpFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
    'bare/adrien.config.yaml': configYaml({ product: 'Bare', workspace: 'bare' }),
  });
  const product = await ctxAt(join(root, 'product'));
  const bare = await ctxAt(join(root, 'bare'));
  const before = snapshot(root);
  await expect(planReferenceCatchUp({ logs: [product, bare], from: 'shared', to: 'house' })).rejects.toThrow(
    /has no common field/,
  );
  expect(snapshot(root)).toEqual(before);
});

test('a catch-up apply writes the ADRs only', async () => {
  const { root } = catchUpFixture();
  const plan = await catchUpPlan(root);
  const before = snapshot(root);
  applyWorkspaceRename(plan);
  const after = snapshot(root);
  const changed = Object.keys(after).filter((rel) => after[rel] !== before[rel]);
  expect(changed).toHaveLength(3);
  expect(changed.every((rel) => rel.startsWith('product/docs/adr/'))).toBe(true);
});

test('a catch-up apply puts every ADR back when a write fails', async () => {
  const { root, two } = catchUpFixture();
  const plan = await catchUpPlan(root);
  const before = snapshot(root);
  const injected = new Error('disk full');
  failOnce('rename', two, injected);
  expect(applyError(plan)).toBe(injected);
  expect(snapshot(root)).toEqual(before);
  expect(tempFilesIn(root)).toEqual([]);
});

test('a catch-up apply refuses when a product config changed after the plan, and writes nothing', async () => {
  const { root, config } = catchUpFixture();
  const plan = await catchUpPlan(root);
  writeFileSync(config, `# edited\n${readFileSync(config, 'utf8')}`);
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

test('after a catch-up, check no longer reports the old name as unresolved and finds no broken link', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles(),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({
        id: 'ADR-0002',
        title: 'Use it',
        related: ['shared/ADR-0009'],
        exception_to: ['shared/ADR-0009'],
      }),
    }),
  });
  const env = { ADRIEN_HOME: tmpDir() };
  const productDir = join(root, 'product');
  // The common log was renamed elsewhere: the product still names it `shared`.
  writeFiles(root, { 'shared/adrien.config.yaml': configYaml({ product: 'Shared Co', workspace: 'house' }) });
  const before = await linkProblems(productDir, env);
  expect(before.some((line) => line.startsWith('unresolved-ref'))).toBe(true);
  const product = await ctxAt(productDir);
  applyWorkspaceRename(await planReferenceCatchUp({ logs: [product], from: 'shared', to: 'house' }));
  expect(await linkProblems(productDir, env)).toEqual([]);
});

test('a catch-up refusal for a path common still named like the old name has no clone advice', async () => {
  const root = tmpDir();
  writeFiles(root, { ...sharedFiles(), ...productFiles({}) });
  const product = await ctxAt(join(root, 'product'));
  const error = await planReferenceCatchUp({ logs: [product], from: 'shared', to: 'house' }).catch((e: Error) => e);
  expect((error as Error).message).toContain('merge that rename.');
  expect((error as Error).message).not.toContain('cached clone');
});

test('a catch-up refusal for a URL common still named like the old name names the clone to remove', async () => {
  const repo = tmpDir();
  writeFiles(repo, { [CONFIG_FILE]: configYaml({ product: 'Root Co', workspace: 'shared' }) });
  const { origin } = initRepo(repo, { origin: true });
  const root = tmpDir();
  writeFiles(root, {
    'product/adrien.config.yaml': configYaml({
      product: 'Acme',
      workspace: 'acme',
      common: pathToFileURL(origin ?? '').href,
    }),
  });
  const home = tmpDir();
  const product = await ctxAt(join(root, 'product'), { ADRIEN_HOME: home });
  const error = await planReferenceCatchUp({ logs: [product], from: 'shared', to: 'house' }).catch((e: Error) => e);
  expect((error as Error).message).toContain('cached clone');
  expect((error as Error).message).toContain(home);
});

test('a catch-up plan is refused when the common log was renamed again after the plan', async () => {
  const root = tmpDir();
  writeFiles(
    root,
    catchUpFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({
        id: 'ADR-0002',
        title: 'Use it',
        related: ['shared/ADR-0009'],
      }),
    }),
  );
  const plan = await catchUpPlan(root);
  writeFiles(root, { 'shared/adrien.config.yaml': configYaml({ product: 'Shared Co', workspace: 'castle' }) });
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

/** A log named `old` whose ADR folder is `adrDir`, with ADR-0002 referring to ADR-0001 by the old name. */
function movableLog(adrDir: string, name = 'old'): Record<string, string> {
  return {
    'log/adrien.config.yaml': configYaml({ product: 'Old', workspace: name, adr_dir: adrDir }),
    [`log/${adrDir}/ADR-0001-a.md`]: adrText({ id: 'ADR-0001', title: 'A' }),
    [`log/${adrDir}/ADR-0002-b.md`]: adrText({ id: 'ADR-0002', title: 'B', related: [`${name}/ADR-0001`] }),
  };
}

test('the ADR folder moves to the new name when its last segment is the old name, and adr_dir follows', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  expect(plan.move).toEqual({ logRoot: join(root, 'log'), from: 'adrien-docs/old', to: 'adrien-docs/new' });
  applyWorkspaceRename(plan);
  expect(existsSync(join(root, 'log/adrien-docs/old'))).toBe(false);
  expect(readFileSync(join(root, 'log/adrien-docs/new/ADR-0002-b.md'), 'utf8')).toContain('new/ADR-0001');
  const after = await ctxAt(join(root, 'log'));
  expect(after.config.adr_dir).toBe('adrien-docs/new');
  expect(readWorkingLog(after.logRoot, after.config).adrs.map((adr) => adr.meta.id)).toEqual(['ADR-0001', 'ADR-0002']);
});

test('an adr_dir that is only the old name becomes the new name', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('old'));
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  expect(plan.move).toEqual({ logRoot: join(root, 'log'), from: 'old', to: 'new' });
  applyWorkspaceRename(plan);
  expect(existsSync(join(root, 'log/new/ADR-0001-a.md'))).toBe(true);
  expect((await ctxAt(join(root, 'log'))).config.adr_dir).toBe('new');
});

test('an ADR folder whose last segment is not the old name is left where it is, with a note', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('docs/adr'));
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  expect(plan.move).toBeNull();
  expect(plan.notes).toContain('The ADR folder docs/adr is not named after the workspace, so it was left where it is.');
  applyWorkspaceRename(plan);
  expect(existsSync(join(root, 'log/docs/adr/ADR-0001-a.md'))).toBe(true);
  expect((await ctxAt(join(root, 'log'))).config.adr_dir).toBe('docs/adr');
});

test('a destination folder that already exists refuses the plan, and nothing is written', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...movableLog('adrien-docs/old'),
    'log/adrien-docs/new/ADR-0009-other.md': adrText({ id: 'ADR-0009', title: 'Other' }),
  });
  const target = await ctxAt(join(root, 'log'));
  const before = snapshot(root);
  await expect(planWorkspaceRename({ target, others: [], to: 'new' })).rejects.toMatchObject({
    code: 'INVALID_INPUT',
    message: expect.stringContaining('adrien-docs/new'),
  });
  expect(snapshot(root)).toEqual(before);
});

test('a destination folder that appears after the plan refuses the apply, and nothing is written', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  writeFiles(root, { 'log/adrien-docs/new/ADR-0009-other.md': adrText({ id: 'ADR-0009', title: 'Other' }) });
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

test('a config write that fails after the folder moved puts the folder and the ADR texts back', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  const before = snapshot(root);
  const injected = new Error('config locked');
  failOnce('rename', join(root, 'log', CONFIG_FILE), injected);
  expect(applyError(plan)).toBe(injected);
  expect(snapshot(root)).toEqual(before);
  expect(existsSync(join(root, 'log/adrien-docs/new'))).toBe(false);
  expect(tempFilesIn(root)).toEqual([]);
});

test('a product log reached by the rename keeps its ADR folder, even when it has the old name', async () => {
  const root = tmpDir();
  writeFiles(root, {
    'shared/adrien.config.yaml': configYaml({
      product: 'Shared Co',
      workspace: 'shared',
      adr_dir: 'adrien-docs/shared',
    }),
    'shared/adrien-docs/shared/ADR-0009-shared.md': adrText({
      id: 'ADR-0009',
      title: 'Shared rule',
      status: 'accepted',
      components: ['web'],
      review_rule: 'Shared rule applies.',
    }),
    'product/adrien.config.yaml': configYaml({
      product: 'Acme',
      workspace: 'acme',
      common: '../shared',
      adr_dir: 'adrien-docs/shared',
    }),
    'product/adrien-docs/shared/ADR-0002-use-it.md': adrText({
      id: 'ADR-0002',
      title: 'Use it',
      status: 'accepted',
      review_rule: 'Use it.',
      related: ['shared/ADR-0009'],
    }),
  });
  const shared = await ctxAt(join(root, 'shared'));
  const product = await ctxAt(join(root, 'product'));
  const plan = await planWorkspaceRename({ target: shared, others: [product], to: 'house' });
  expect(plan.move).toMatchObject({ from: 'adrien-docs/shared', to: 'adrien-docs/house' });
  applyWorkspaceRename(plan);
  expect(existsSync(join(root, 'shared/adrien-docs/house/ADR-0009-shared.md'))).toBe(true);
  expect(existsSync(join(root, 'product/adrien-docs/shared/ADR-0002-use-it.md'))).toBe(true);
  expect((await ctxAt(join(root, 'product'))).config.adr_dir).toBe('adrien-docs/shared');
  expect((await metaOf(product, 'ADR-0002'))?.related).toEqual(['house/ADR-0009']);
});

test('a catch-up never moves a folder and adds no note about one', async () => {
  const root = tmpDir();
  writeFiles(root, {
    ...sharedFiles('house'),
    ...productFiles({
      'product/docs/adr/ADR-0002-use-it.md': adrText({ id: 'ADR-0002', title: 'Use it', related: ['shared/ADR-0009'] }),
    }),
  });
  const product = await ctxAt(join(root, 'product'));
  const plan = await planReferenceCatchUp({ logs: [product], from: 'shared', to: 'house' });
  expect(plan.move).toBeNull();
  expect(plan.notes).toEqual([]);
});

test('after the folder moves, check finds every ADR of the log, with no link problems', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const target = await ctxAt(join(root, 'log'));
  applyWorkspaceRename(await planWorkspaceRename({ target, others: [], to: 'new' }));
  const after = await ctxAt(join(root, 'log'));
  const working = readWorkingLog(after.logRoot, after.config);
  expect(working.problems).toEqual([]);
  expect(working.adrs).toHaveLength(2);
  expect(await linkProblems(join(root, 'log'), { ADRIEN_HOME: tmpDir() })).toEqual([]);
});

test('an ADR folder that disappeared after the plan refuses the apply, and nothing is written', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  rmSync(join(root, 'log/adrien-docs/old'), { recursive: true });
  const before = snapshot(root);
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(snapshot(root)).toEqual(before);
});

test('an ADR created while the apply waits for the locks is not moved: the apply refuses, and nothing is changed', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  const before = snapshot(root);
  // The first lock file is written once the apply has read the ids: a decision created then is not locked.
  let spent = false;
  faults.hook = (op, path) => {
    if (op !== 'write' || spent || !path.includes(join('.adrien', 'locks'))) return;
    spent = true;
    writeFiles(root, { 'log/adrien-docs/old/ADR-0003-c.md': adrText({ id: 'ADR-0003', title: 'C' }) });
  };
  expect(applyError(plan)).toMatchObject({ code: 'ADR_CONFLICT' });
  expect(existsSync(join(root, 'log/adrien-docs/old'))).toBe(true);
  expect(existsSync(join(root, 'log/adrien-docs/new'))).toBe(false);
  expect((await ctxAt(join(root, 'log'))).config.adr_dir).toBe('adrien-docs/old');
  const after = snapshot(root);
  expect(Object.keys(after).filter((rel) => after[rel] !== before[rel])).toEqual(['log/adrien-docs/old/ADR-0003-c.md']);
});

/** The error a call throws, so a test can check its code. */
function errorOf(fn: () => unknown): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error('expected the call to throw');
}

test('a proposal from a context read before the folder moved is refused, and the old folder is not recreated', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const stale = await ctxAt(join(root, 'log'));
  const view = await loadLogView(stale.logRoot, stale.config);
  applyWorkspaceRename(await planWorkspaceRename({ target: stale, others: [], to: 'new' }));
  expect(errorOf(() => createAdr(stale, view, { title: 'Late proposal' }))).toMatchObject({
    code: 'ADR_CONFLICT',
    message: expect.stringContaining('run the command again'),
  });
  expect(existsSync(join(root, 'log/adrien-docs/old'))).toBe(false);
  expect(readdirSync(join(root, 'log/adrien-docs/new')).sort()).toEqual(['ADR-0001-a.md', 'ADR-0002-b.md']);
});

test('a proposal waits for a folder move in progress, and gives up after the lock timeout', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const ctx = await ctxAt(join(root, 'log'), { ...process.env, ADRIEN_LOCK_TIMEOUT_MS: '50' });
  const view = await loadLogView(ctx.logRoot, ctx.config);
  const error = withFolderLock(ctx.logRoot, () => errorOf(() => createAdr(ctx, view, { title: 'Waiting' })));
  expect(error).toMatchObject({ code: 'ADR_LOCKED' });
  expect(readdirSync(join(root, 'log/adrien-docs/old')).sort()).toEqual(['ADR-0001-a.md', 'ADR-0002-b.md']);
});

test('a rename that moves the folder waits for a proposal in progress', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const target = await ctxAt(join(root, 'log'));
  const plan = await planWorkspaceRename({ target, others: [], to: 'new' });
  const error = withFolderLock(target.logRoot, () =>
    errorOf(() => applyWorkspaceRename(plan, { ...process.env, ADRIEN_LOCK_TIMEOUT_MS: '50' })),
  );
  expect(error).toMatchObject({ code: 'ADR_LOCKED' });
  expect(existsSync(join(root, 'log/adrien-docs/old/ADR-0001-a.md'))).toBe(true);
  expect(existsSync(join(root, 'log/adrien-docs/new'))).toBe(false);
});

test('a proposal still works after a rename that left the folder where it was', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('docs/adr'));
  const stale = await ctxAt(join(root, 'log'));
  const view = await loadLogView(stale.logRoot, stale.config);
  applyWorkspaceRename(await planWorkspaceRename({ target: stale, others: [], to: 'new' }));
  expect(createAdr(stale, view, { title: 'Still fine' })).toMatchObject({ written: true });
});

test('a change to an existing ADR from a context read before the folder moved fails, and the old folder is not recreated', async () => {
  const root = tmpDir();
  writeFiles(root, movableLog('adrien-docs/old'));
  const stale = await ctxAt(join(root, 'log'));
  const view = await loadLogView(stale.logRoot, stale.config);
  applyWorkspaceRename(await planWorkspaceRename({ target: stale, others: [], to: 'new' }));
  expect(errorOf(() => updateAdr(stale, view, 'ADR-0001', { title: 'Renamed' }))).toMatchObject({
    code: 'ADR_NOT_FOUND',
  });
  expect(errorOf(() => acceptAdr(stale, view, 'ADR-0001'))).toMatchObject({ code: 'ADR_NOT_FOUND' });
  expect(existsSync(join(root, 'log/adrien-docs/old'))).toBe(false);
  expect(readFileSync(join(root, 'log/adrien-docs/new/ADR-0001-a.md'), 'utf8')).toContain('title: A');
});
