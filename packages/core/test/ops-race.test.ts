import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { readWorkingLog } from '../src/log.ts';
import { renumber } from '../src/ops.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { initRepo } from './helpers/git.ts';

// Another process publishes ADR-0003 between our scan and our reservation of that number.
const race = vi.hoisted(() => ({
  before: undefined as undefined | (() => void),
  locked: [] as string[][],
  atLock: undefined as undefined | (() => void),
}));
vi.mock('../src/log.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/log.ts')>();
  return {
    ...real,
    reserveId: (logRoot: string, start: number) => {
      const run = race.before;
      race.before = undefined;
      run?.();
      return real.reserveId(logRoot, start);
    },
  };
});

vi.mock('../src/lock.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lock.ts')>();
  return {
    ...real,
    withAdrLocks: (...args: Parameters<typeof real.withAdrLocks>) => {
      race.locked.push(args[1]);
      const run = race.atLock;
      race.atLock = undefined;
      run?.();
      return real.withAdrLocks(...args);
    },
  };
});

test('renumber moves on when the number it reserved was published in the meantime', async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0001-dup.md': adrText({ id: 'ADR-0001', title: 'Dup' }) });
  const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: tmpDir() } });
  const view = await loadLogView(root, ctx.config);
  race.before = () =>
    writeFileSync(join(root, 'docs/adr/ADR-0002-other.md'), adrText({ id: 'ADR-0002', title: 'Other' }));
  expect(renumber(ctx, view, 'ADR-0001').to).toBe('ADR-0003');
  expect(
    readWorkingLog(root, ctx.config)
      .adrs.map((a) => a.meta.id)
      .sort(),
  ).toEqual(['ADR-0001', 'ADR-0002', 'ADR-0003']);
});

test('renumber locks an ADR created while it waited, once that ADR refers to the one it moves', async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0001-dup.md': adrText({ id: 'ADR-0001', title: 'Dup' }) });
  const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: tmpDir() } });
  const view = await loadLogView(root, ctx.config);
  race.locked = [];
  // Created after the ids to lock were read, before the locks were taken.
  race.atLock = () =>
    writeFileSync(
      join(root, 'docs/adr/ADR-0002-late.md'),
      adrText({ id: 'ADR-0002', title: 'Late', related: ['ADR-0001'] }),
    );
  const moved = renumber(ctx, view, 'ADR-0001');
  expect(moved.to).toBe('ADR-0003');
  expect(race.locked).toHaveLength(2);
  expect(race.locked[1]).toContain('ADR-0002');
  expect(readWorkingLog(root, ctx.config).adrs.find((a) => a.meta.id === 'ADR-0002')?.meta.related).toEqual([
    'ADR-0003',
  ]);
});
