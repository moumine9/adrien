import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdrienError } from '../src/errors.ts';
import { withAdrLocks } from '../src/lock.ts';
import { tmpDir } from './helpers/fixtures.ts';

const holder = fileURLToPath(new URL('./helpers/hold-lock.mjs', import.meta.url));
const lockFile = (root: string, name: string) => join(root, '.adrien', 'locks', `${name}.lock`);
const owner = (pid: number, at: number, host = hostname()) => JSON.stringify({ pid, host, at });

/** Plants a lock as another process would have left it. */
function plant(root: string, name: string, content: string): string {
  mkdirSync(join(root, '.adrien', 'locks'), { recursive: true });
  const file = lockFile(root, name);
  writeFileSync(file, content);
  return file;
}

/** The pid of a process that has already exited. */
const deadPid = (): number => {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid;
};

test('runs the function and returns its value, and leaves no lock behind', () => {
  const root = tmpDir();
  expect(withAdrLocks(root, ['ADR-0001'], () => 42)).toBe(42);
  expect(readdirSync(join(root, '.adrien', 'locks'))).toEqual([]);
});

test('releases the lock when the function throws, and rethrows', () => {
  const root = tmpDir();
  expect(() =>
    withAdrLocks(root, ['ADR-0001'], () => {
      throw new Error('boom');
    }),
  ).toThrow('boom');
  expect(existsSync(lockFile(root, 'ADR-0001'))).toBe(false);
});

test('several ids are locked together, once each, and all released', () => {
  const root = tmpDir();
  withAdrLocks(root, ['ADR-0002', 'ADR-0001', 'ADR-0002'], () => {
    expect(readdirSync(join(root, '.adrien', 'locks')).sort()).toEqual(['ADR-0001.lock', 'ADR-0002.lock']);
  });
  expect(readdirSync(join(root, '.adrien', 'locks'))).toEqual([]);
});

test('the lock folder is ignored by git, like the rest of .adrien', () => {
  const root = tmpDir();
  withAdrLocks(root, ['ADR-0001'], () => undefined);
  withAdrLocks(root, ['ADR-0001'], () => undefined);
  expect(readFileSync(join(root, '.adrien', '.gitignore'), 'utf8')).toBe('*\n');
});

test('another process holding the lock is waited for, never overlapped', async () => {
  const root = tmpDir();
  const out = join(tmpDir(), 'times.txt');
  const child = spawn(process.execPath, ['--experimental-strip-types', holder, root, 'ADR-0001', '400', out], {
    stdio: 'ignore',
  });
  const exited = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  // Wait until the child really holds the lock.
  for (let i = 0; i < 200 && !(existsSync(out) && readFileSync(out, 'utf8').includes('enter')); i++) {
    await new Promise((r) => setTimeout(r, 25));
  }
  const entered = withAdrLocks(root, ['ADR-0001'], () => Date.now());
  await exited;
  const exit = Number(/exit (\d+)/.exec(readFileSync(out, 'utf8'))?.[1]);
  expect(entered).toBeGreaterThanOrEqual(exit);
}, 20_000);

test('a live holder that does not let go makes a waiter fail with ADR_LOCKED, naming the ADR and the holder', () => {
  const root = tmpDir();
  plant(root, 'ADR-0001', owner(process.pid, Date.now()));
  const attempt = () => withAdrLocks(root, ['ADR-0001'], () => 1, { timeoutMs: 120 });
  expect(attempt).toThrow(AdrienError);
  expect(attempt).toThrow(/ADR-0001 is being changed by another Adrien process \(pid \d+\)/);
  try {
    attempt();
  } catch (e) {
    expect((e as AdrienError).code).toBe('ADR_LOCKED');
  }
});

test('a lock held by a process that no longer exists is taken over at once', () => {
  const root = tmpDir();
  plant(root, 'ADR-0001', owner(deadPid(), Date.now()));
  expect(withAdrLocks(root, ['ADR-0001'], () => 'taken', { timeoutMs: 100 })).toBe('taken');
});

test('a lock that is older than staleMs is taken over even if its pid is alive', () => {
  const root = tmpDir();
  plant(root, 'ADR-0001', owner(process.pid, Date.now() - 60_000));
  expect(withAdrLocks(root, ['ADR-0001'], () => 'taken', { timeoutMs: 100, staleMs: 30_000 })).toBe('taken');
});

test('a lock from another machine is never judged by its pid, only by its age', () => {
  const root = tmpDir();
  plant(root, 'ADR-0001', owner(deadPid(), Date.now(), 'some-other-host'));
  expect(() => withAdrLocks(root, ['ADR-0001'], () => 1, { timeoutMs: 80 })).toThrow(/ADR_LOCKED|being changed/);
  plant(root, 'ADR-0002', owner(deadPid(), Date.now() - 60_000, 'some-other-host'));
  expect(withAdrLocks(root, ['ADR-0002'], () => 'taken', { timeoutMs: 80 })).toBe('taken');
});

test('a lock with no readable owner is left alone while it is young and taken over once it has waited staleMs', () => {
  const root = tmpDir();
  plant(root, 'ADR-0001', '');
  expect(() => withAdrLocks(root, ['ADR-0001'], () => 1, { timeoutMs: 80, staleMs: 10_000 })).toThrow(/being changed/);
  plant(root, 'ADR-0002', 'not json');
  expect(withAdrLocks(root, ['ADR-0002'], () => 'taken', { timeoutMs: 400, staleMs: 100 })).toBe('taken');
  plant(root, 'ADR-0003', '{}');
  expect(withAdrLocks(root, ['ADR-0003'], () => 'taken', { timeoutMs: 400, staleMs: 100 })).toBe('taken');
});

test('a pid that exists but belongs to another user is treated as alive', () => {
  const root = tmpDir();
  plant(root, 'ADR-0001', owner(deadPid(), Date.now()));
  const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
    throw Object.assign(new Error('not permitted'), { code: 'EPERM' });
  });
  try {
    expect(() => withAdrLocks(root, ['ADR-0001'], () => 1, { timeoutMs: 80 })).toThrow(/being changed/);
  } finally {
    kill.mockRestore();
  }
});

test('an id with characters that are unsafe in a file name gets a safe lock name', () => {
  const root = tmpDir();
  withAdrLocks(root, ['ADR/..\\x:1'], () => {
    const names = readdirSync(join(root, '.adrien', 'locks'));
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[A-Za-z0-9._~-]+\.lock$/);
  });
});
