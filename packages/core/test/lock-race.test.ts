import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpDir } from './helpers/fixtures.ts';

// Another process takes the guard while we are judging an abandoned one.
const hook = vi.hoisted(() => ({ run: undefined as undefined | (() => void) }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    statSync: ((...args: Parameters<typeof real.statSync>) => {
      const stat = real.statSync(...args);
      const run = hook.run;
      hook.run = undefined;
      run?.();
      return stat;
    }) as typeof real.statSync,
  };
});

const { takeOver } = await import('../src/lock.ts');
const { utimesSync, mkdirSync, rmSync } = await import('node:fs');

/** Plants a guard file as another process would have left it. */
function plantGuard(lock: string, name: string, content: string): void {
  mkdirSync(`${lock}.guard`, { recursive: true });
  writeFileSync(`${lock}.guard/${name}`, content);
}

function plantStale(): string {
  const root = tmpDir();
  mkdirSync(join(root, '.adrien', 'locks'), { recursive: true });
  const file = join(root, '.adrien', 'locks', 'adr-0001.lock');
  writeFileSync(file, JSON.stringify({ pid: 2 ** 22 + 1, host: 'elsewhere', at: 1 }));
  return file;
}

test('a guard judged abandoned is never deleted, so a contender that took the next one keeps it and the lock stays', () => {
  const file = plantStale();
  plantGuard(file, 'g1', '1');
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${file}.guard/g1`, old, old);
  hook.run = () => plantGuard(file, 'g2', '2'); // taken by another process right after we looked at g1
  expect(takeOver(file, 30_000)).toBe(false);
  expect(existsSync(`${file}.guard/g2`)).toBe(true);
  expect(existsSync(file)).toBe(true);
});

test('a number that was cleaned up and is created again from an older view is not a guard, and is let go at once', () => {
  const file = plantStale();
  plantGuard(file, 'g1', '1');
  const old = new Date(Date.now() - 60_000);
  utimesSync(`${file}.guard/g1`, old, old);
  hook.run = () => {
    // Others went on to generation 3 and cleaned up 2 while we were still looking at generation 1.
    plantGuard(file, 'g3', '3');
    rmSync(`${file}.guard/g1`);
  };
  expect(takeOver(file, 30_000)).toBe(false);
  expect(existsSync(`${file}.guard/g2.done`)).toBe(true);
  expect(existsSync(`${file}.guard/g3`)).toBe(true);
  expect(existsSync(file)).toBe(true);
});
