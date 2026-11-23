import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { commonCloneDir, commonUnreadableNote, forFilesWithCommon, readCommon, resolveCommon } from '../src/common.ts';
import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { git, initRepo } from './helpers/git.ts';

/** A product log whose config names `common` (or none); returns its root. */
function productLog(common?: string): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: `product: acme\n${common === undefined ? '' : `common: ${common}\n`}` });
  return root;
}

/** A common log with the given product name and one accepted ADR; returns its root. */
function commonLog(product: string, extra: Record<string, string> = {}): string {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: `product: "${product}"\n`,
    'docs/adr/a.md': adrText({ id: 'ADR-0001', title: 'Shared', status: 'accepted' }),
    ...extra,
  });
  return root;
}

test('resolveCommon returns null when the product names no common log', async () => {
  const ctx = await resolveContext({ cwd: productLog(), env: {} });
  expect(await resolveCommon(ctx, {})).toBeNull();
});

test('a relative common path resolves against the product log root and names the common log', async () => {
  const parent = tmpDir();
  const product = join(parent, 'product');
  const common = join(parent, 'common');
  writeFiles(product, { [CONFIG_FILE]: 'product: acme\ncommon: ../common\n' });
  writeFiles(common, {
    [CONFIG_FILE]: 'product: Shared Co\n',
    'docs/adr/a.md': adrText({ id: 'ADR-0001', title: 'Shared', status: 'accepted' }),
  });
  const ctx = await resolveContext({ cwd: product, env: {} });
  const resolved = await resolveCommon(ctx);
  expect(resolved?.name).toBe('shared-co');
  expect(resolved?.ctx.logRoot).toBe(common);
  expect(resolved?.view.base.map((a) => a.meta.id)).toEqual(['ADR-0001']);
});

test('a common path that is not a log is a CONFIG_NOT_FOUND error naming the common field', async () => {
  const ctx = await resolveContext({ cwd: productLog('./missing-log'), env: {} });
  await expect(resolveCommon(ctx, {})).rejects.toThrow(
    expect.objectContaining({ code: 'CONFIG_NOT_FOUND', message: expect.stringContaining('common') }),
  );
});

test('a common log with no usable workspace name is unreadable: its name must be set', async () => {
  const root = productLog(commonLog('!!!'));
  const ctx = await resolveContext({ cwd: root, env: {} });
  const result = await readCommon(ctx, {});
  expect(result).toEqual({ unreadable: expect.objectContaining({ message: expect.stringContaining('workspace') }) });
  await expect(resolveCommon(ctx, {})).rejects.toThrow(
    expect.objectContaining({ code: 'CONFIG_NOT_FOUND', message: expect.stringContaining('workspace') }),
  );
});

test('a common field that points at the product log itself is unreadable, not counted twice', async () => {
  const ctx = await resolveContext({ cwd: productLog('.'), env: {} });
  const result = await readCommon(ctx, {});
  expect(result).toEqual({ unreadable: expect.objectContaining({ message: expect.stringContaining('itself') }) });
});

test('readCommon reports an unreadable common log instead of throwing, with its location', async () => {
  const ctx = await resolveContext({ cwd: productLog('./missing-log'), env: {} });
  const result = await readCommon(ctx, {});
  expect(result).toEqual({
    unreadable: { kind: 'unreachable', location: './missing-log', message: expect.any(String) },
  });
  expect(commonUnreadableNote(result)).toContain('./missing-log');
  expect(commonUnreadableNote(result)).toContain('not shown');
});

test('readCommon returns null without a common field, and no note is due for a readable or absent common log', async () => {
  const absent = await resolveContext({ cwd: productLog(), env: {} });
  expect(await readCommon(absent, {})).toBeNull();
  expect(commonUnreadableNote(null)).toBeNull();
  const ok = await readCommon(await resolveContext({ cwd: productLog(commonLog('Shared')), env: {} }), {});
  expect(commonUnreadableNote(ok)).toBeNull();
});

test('the common log own common field is ignored: no chaining', async () => {
  const third = commonLog('Third');
  const middle = commonLog('Middle', { [CONFIG_FILE]: `product: Middle\ncommon: ${third}\n` });
  const ctx = await resolveContext({ cwd: productLog(middle), env: {} });
  const resolved = await resolveCommon(ctx, {});
  expect(resolved?.name).toBe('middle');
  expect(resolved?.view.base.map((a) => a.meta.id)).toEqual(['ADR-0001']);
});

test('a common git URL is cloned into ADRIEN_HOME and read like a --log entry', async () => {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: 'product: Shared Co\n',
    'docs/adr/a.md': adrText({ id: 'ADR-0001', title: 'Shared', status: 'accepted' }),
  });
  const { origin } = initRepo(root, { origin: true });
  const url = pathToFileURL(origin ?? '').href;
  const env = { ADRIEN_HOME: tmpDir() };
  const ctx = await resolveContext({ cwd: productLog(url), env: {} });
  const resolved = await resolveCommon(ctx, env);
  expect(resolved?.name).toBe('shared-co');
  expect(resolved?.view.base.map((a) => a.meta.id)).toEqual(['ADR-0001']);
});

test('commonCloneDir names the cached clone of a common git URL, and nothing for a path or no common log', async () => {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: 'product: Shared Co\n',
    'docs/adr/a.md': adrText({ id: 'ADR-0001', title: 'Shared', status: 'accepted' }),
  });
  const { origin } = initRepo(root, { origin: true });
  const url = pathToFileURL(origin ?? '').href;
  const env = { ADRIEN_HOME: tmpDir() };
  const byUrl = await resolveContext({ cwd: productLog(url), env: {} });
  const resolved = await resolveCommon(byUrl, env);
  expect(await commonCloneDir(byUrl, env)).toBe(resolved?.ctx.logRoot);
  const own = await resolveContext({ cwd: productLog(url), env });
  expect(await commonCloneDir(own)).toBe(resolved?.ctx.logRoot);
  expect(await commonCloneDir(await resolveContext({ cwd: productLog('./somewhere'), env: {} }), env)).toBeNull();
  expect(await commonCloneDir(await resolveContext({ cwd: productLog(), env: {} }), env)).toBeNull();
});

describe('forFilesWithCommon', () => {
  /** A product that owns component billing-service (its whole log root), naming `common`; returns its root. */
  function productWithComponent(common: string): string {
    const root = tmpDir();
    writeFiles(root, {
      [CONFIG_FILE]: `product: acme\ncomponents:\n  billing-service:\n    repo: .\ncommon: ${common}\n`,
    });
    return root;
  }

  /** A common log with one accepted decision on billing-service, named Shared Co; returns its root. */
  function sharedWithBilling(): string {
    return commonLog('Shared Co', {
      'docs/adr/b.md': adrText({
        id: 'ADR-0009',
        title: 'Billing',
        status: 'accepted',
        components: ['billing-service'],
      }),
    });
  }

  test('shows the common decision with its workspace, and no notes when the log is readable', async () => {
    const root = productWithComponent(sharedWithBilling());
    const ctx = await resolveContext({ cwd: root, env: {} });
    const view = await loadLogView(root, ctx.config);
    const result = await forFilesWithCommon(ctx, view, ['src/a.ts']);
    expect(result.notes).toEqual([]);
    expect(result.files[0]?.decisions.map((d) => [d.id, d.workspace, d.binding])).toEqual([
      ['ADR-0009', 'shared-co', true],
    ]);
  });

  test('a common log with no default branch adds a note naming it, as an own log does', async () => {
    const common = sharedWithBilling();
    initRepo(common);
    git(common, 'branch', '-m', 'trunk');
    const root = productWithComponent(common);
    const ctx = await resolveContext({ cwd: root, env: {} });
    const view = await loadLogView(root, ctx.config);
    const result = await forFilesWithCommon(ctx, view, ['src/a.ts']);
    expect(result.notes).toEqual([]);
    expect(result.commonNotes).toHaveLength(1);
    expect(result.commonNotes[0]).toContain('In the common log "shared-co": ');
    expect(result.commonNotes[0]).toContain('No default branch');
  });

  test('an unreadable common log keeps the own decisions and adds a note', async () => {
    const root = productWithComponent('./missing-log');
    writeFiles(root, {
      'docs/adr/a.md': adrText({ id: 'ADR-0001', title: 'Own', status: 'accepted', components: ['billing-service'] }),
    });
    const ctx = await resolveContext({ cwd: root, env: {} });
    const view = await loadLogView(root, ctx.config);
    const result = await forFilesWithCommon(ctx, view, ['src/a.ts']);
    expect(result.files[0]?.decisions.map((d) => [d.id, d.workspace])).toEqual([['ADR-0001', null]]);
    expect(result.notes).toEqual([]);
    expect(result.commonNotes).toHaveLength(1);
    expect(result.commonNotes[0]).toContain('./missing-log');
  });

  test('a product without a common field is unchanged, with no common decisions', async () => {
    const plain = tmpDir();
    writeFiles(plain, { [CONFIG_FILE]: 'product: acme\ncomponents:\n  billing-service:\n    repo: .\n' });
    const ctx = await resolveContext({ cwd: plain, env: {} });
    const view = await loadLogView(plain, ctx.config);
    expect(await forFilesWithCommon(ctx, view, ['src/a.ts'])).toEqual({
      files: [{ file: 'src/a.ts', component: 'billing-service', decisions: [] }],
      notes: [],
      commonNotes: [],
    });
  });
});
