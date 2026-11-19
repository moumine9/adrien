import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AdrienError } from '../src/errors.ts';
import { ageOfFile, staleAfter, takeOver, withAdrLocks } from '../src/lock.ts';
import { tmpDir } from './helpers/fixtures.ts';

const holder = fileURLToPath(new URL('./helpers/hold-lock.mjs', import.meta.url));
const racer = fileURLToPath(new URL('./helpers/race-lock.mjs', import.meta.url));
const lockFile = (root: string, name: string) => join(root, '.adrien', 'locks', `${name.toLowerCase()}.lock`);
/** The locks held in a log (the guard files of finished takeovers and releases stay behind, and are not locks). */
const heldLocks = (root: string) =>
  readdirSync(join(root, '.adrien', 'locks'))
    .filter((n) => n.endsWith('.lock'))
    .sort();
const owner = (pid: number, at: number, host = hostname()) => JSON.stringify({ pid, host, at });

/** Plants a lock as another process would have left it. */
function plant(root: string, name: string, content: string): string {
  mkdirSync(join(root, '.adrien', 'locks'), { recursive: true });
  const file = lockFile(root, name);
  writeFileSync(file, content);
  return file;
}

/** Plants a guard file as another process would have left it. */
function plantGuard(lock: string, name: string, content: string): void {
  mkdirSync(`${lock}.guard`, { recursive: true });
  writeFileSync(`${lock}.guard/${name}`, content);
}

/** The pid of a process that has already exited. */
const deadPid = (): number => {
  const child = spawnSync(process.execPath, ['-e', '']);
  return child.pid;
};

test('runs the function and returns its value, and leaves no lock behind', () => {
  const root = tmpDir();
  expect(withAdrLocks(root, ['ADR-0001'], () => 42)).toBe(42);
  expect(heldLocks(root)).toEqual([]);
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
    expect(heldLocks(root)).toEqual(['adr-0001.lock', 'adr-0002.lock']);
  });
  expect(heldLocks(root)).toEqual([]);
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
  // The child really holds the lock before we ask for it (otherwise this test would prove nothing).
  expect(readFileSync(out, 'utf8')).toContain('enter');
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

/** Sets a planted file's modification time to `ageMs` ago. */
const age = (file: string, ageMs: number) =>
  utimesSync(file, new Date(Date.now() - ageMs), new Date(Date.now() - ageMs));

test('a lock with no readable owner is left alone while its file is young, and taken over once it is older than staleMs, with the default options', () => {
  const root = tmpDir();
  const young = plant(root, 'ADR-0001', '');
  expect(() => withAdrLocks(root, ['ADR-0001'], () => 1, { timeoutMs: 80 })).toThrow(/being changed/);
  // An empty file is what a writer that crashed between creating the lock and writing its owner leaves behind.
  age(young, 60_000);
  expect(withAdrLocks(root, ['ADR-0001'], () => 'taken', { timeoutMs: 80 })).toBe('taken');
  for (const [name, content] of [
    ['ADR-0002', 'not json'],
    ['ADR-0003', '{}'],
  ] as const) {
    age(plant(root, name, content), 60_000);
    expect(withAdrLocks(root, [name], () => 'taken', { timeoutMs: 80 })).toBe('taken');
  }
});

test('the time a lock may be held grows with how long a waiter is willing to wait, so a waiter never creates a lock that is already stale', () => {
  expect(staleAfter(5_000)).toBe(30_000);
  expect(staleAfter(20_000)).toBe(40_000);
  expect(staleAfter(120_000)).toBe(240_000);
});

test('ageOfFile is the age of a file, and zero for one that is gone', () => {
  const root = tmpDir();
  const file = plant(root, 'ADR-0001', '');
  age(file, 5_000);
  expect(ageOfFile(file)).toBeGreaterThanOrEqual(5_000);
  expect(ageOfFile(join(root, 'nothing'))).toBe(0);
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
    const names = heldLocks(root);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^[A-Za-z0-9._~-]+\.lock$/);
  });
});

describe('taking over a stale lock', () => {
  const staleOwner = () => owner(deadPid(), Date.now());

  test('a lock that was replaced by a live one after it was judged stale is not removed', () => {
    const root = tmpDir();
    // B judged this lock stale; before B acts, A removed it and took the lock with a live owner.
    const file = plant(root, 'ADR-0001', staleOwner());
    const judgedStale = readFileSync(file, 'utf8');
    expect(judgedStale).toContain('"pid"');
    writeFileSync(file, owner(process.pid, Date.now()));
    expect(takeOver(file, 30_000)).toBe(false);
    expect(readFileSync(file, 'utf8')).toContain(`"pid":${process.pid}`);
    expect(existsSync(`${file}.takeover`)).toBe(false);
  });

  test('a lock that is still stale under the guard is removed, and the guard is released', () => {
    const root = tmpDir();
    const file = plant(root, 'ADR-0001', staleOwner());
    expect(takeOver(file, 30_000)).toBe(true);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(`${file}.guard/g1.done`)).toBe(true); // the guard was let go
  });

  test('while another process holds the guard nothing is removed', () => {
    const root = tmpDir();
    const file = plant(root, 'ADR-0001', staleOwner());
    plantGuard(file, 'g1', '1');
    expect(takeOver(file, 30_000)).toBe(false);
    expect(existsSync(file)).toBe(true);
  });

  test('a guard left behind by a crashed taker is passed over once it is old, without being deleted', () => {
    const root = tmpDir();
    const file = plant(root, 'ADR-0001', staleOwner());
    plantGuard(file, 'g1', '1');
    age(`${file}.guard/g1`, 60_000);
    expect(takeOver(file, 30_000)).toBe(true);
    expect(existsSync(file)).toBe(false);
    // The next generation took its place and the old one was cleaned up by it.
    expect(existsSync(`${file}.guard/g2.done`)).toBe(true);
    expect(existsSync(`${file}.guard/g1`)).toBe(false);
  });

  test('guard files of other locks, and odd names next to them, are not mistaken for generations', () => {
    const root = tmpDir();
    const file = plant(root, 'ADR-0001', staleOwner());
    const other = plant(root, 'ADR-0002', staleOwner());
    plantGuard(other, 'g5', '1');
    plantGuard(file, 'gx', '1');
    expect(takeOver(file, 30_000)).toBe(true);
    expect(existsSync(`${file}.guard/g1.done`)).toBe(true);
  });

  test('a release waits for a guard that is not let go, so it never removes a lock a takeover is judging', () => {
    const root = tmpDir();
    const started = Date.now();
    withAdrLocks(root, ['ADR-0001'], () => {
      const lock = lockFile(root, 'ADR-0001');
      plantGuard(lock, 'g1', '1');
      age(`${lock}.guard/g1`, 9_700); // the guard counts as abandoned in about 300 ms
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(200);
    expect(existsSync(lockFile(root, 'ADR-0001'))).toBe(false);
  });

  test('several processes racing for a lock left by a dead process never hold it together', async () => {
    for (let round = 0; round < 3; round++) {
      const root = tmpDir();
      const out = join(tmpDir(), 'times.txt');
      plant(root, 'ADR-0001', staleOwner());
      await Promise.all(
        Array.from(
          { length: 8 },
          () =>
            new Promise<void>((resolve) => {
              const child = spawn(process.execPath, ['--experimental-strip-types', racer, root, 'ADR-0001', out], {
                stdio: 'ignore',
              });
              child.on('exit', () => resolve());
            }),
        ),
      );
      const events = readFileSync(out, 'utf8')
        .trim()
        .split('\n')
        .map((line) => {
          const [pid, what] = line.split(' ');
          return { pid, what };
        });
      // Appends happen inside the lock, so the file is in the real order (each process has its own clock, so timestamps
      // from different processes cannot be compared). Every enter must be followed by the same process's exit.

      expect(events).toHaveLength(16);
      for (let i = 0; i < events.length; i += 2) {
        expect(events[i]?.what).toBe('enter');
        expect(events[i + 1]).toMatchObject({ what: 'exit', pid: events[i]?.pid });
      }
    }
  }, 60_000);
});

test('a lock that was taken from us while we held it is left alone on release, and a vanished or odd one does not stop the other locks being released', () => {
  const root = tmpDir();
  withAdrLocks(root, ['ADR-0001', 'ADR-0002', 'ADR-0003'], () => {
    // ADR-0001: someone else took the lock after a takeover. ADR-0002: it vanished. ADR-0003 stays ours.
    rmSync(lockFile(root, 'ADR-0001'));
    writeFileSync(lockFile(root, 'ADR-0001'), owner(process.pid + 1, Date.now()));
    rmSync(lockFile(root, 'ADR-0002'));
  });
  expect(heldLocks(root)).toEqual(['adr-0001.lock']);
  expect(readFileSync(lockFile(root, 'ADR-0001'), 'utf8')).toContain(`"pid":${process.pid + 1}`);
});

test('ids that differ only by letter case share a lock, so a process never waits on itself', () => {
  const root = tmpDir();
  expect(withAdrLocks(root, ['ADR-0001', 'adr-0001'], () => 'ok', { timeoutMs: 100 })).toBe('ok');
});
