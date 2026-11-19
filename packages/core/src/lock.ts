import { mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { AdrienError } from './errors.ts';
import { assertInsideLog, tryWriteFile } from './log.ts';

export interface LockOptions {
  /** How long to wait for another process to let go before failing with ADR_LOCKED. */
  timeoutMs?: number;
  /** A lock held this long, or by a process that no longer exists, is taken over. */
  staleMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_STALE_MS = 30_000;
const POLL_MS = 25;

interface Owner {
  pid: number;
  host: string;
  at: number;
}

/** Sleeps without spinning, so the synchronous operations that need a lock can wait for it. */
const pause = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * A safe file name for an id: whatever it holds, it cannot reach another folder. Case is folded, since on a case-insensitive
 * file system two ids that differ only by case are one file. Two ids may share a name; that only serialises them.
 */
const lockName = (id: string): string => `${encodeURIComponent(id).replaceAll('%', '~').toLowerCase()}.lock`;

function readOwner(file: string): Owner | null {
  try {
    const owner = JSON.parse(readFileSync(file, 'utf8')) as Partial<Owner>;
    const valid = typeof owner.pid === 'number' && typeof owner.at === 'number' && typeof owner.host === 'string';
    return valid ? (owner as Owner) : null;
  } catch {
    return null;
  }
}

/** A pid that exists but is not ours (EPERM) is alive; only "no such process" means gone. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== 'ESRCH';
  }
}

/** How long a takeover may hold its guard: it takes microseconds, so a guard this old belongs to a taker that crashed. */
const GUARD_MS = 10_000;

/** A lock may be held longer than the default when a waiter is willing to wait longer, so a waiter's own lock is never already stale. */
export const staleAfter = (timeoutMs: number): number => Math.max(DEFAULT_STALE_MS, 2 * timeoutMs);

/** How long ago a file was last written, in milliseconds; zero when it is gone. */
export function ageOfFile(file: string): number {
  try {
    return Date.now() - statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Whether a lock can be taken over: it has been held longer than `staleMs`, or its holder ran on this machine and is
 * gone. A lock with no readable owner (an empty file, left by a writer that crashed between creating it and writing its
 * owner) is judged by the age of its file. A pid from another machine says nothing, so only age counts there.
 */
function isStale(owner: Owner | null, file: string, staleMs: number): boolean {
  if (owner === null) return ageOfFile(file) > staleMs;
  if (Date.now() - owner.at > staleMs) return true;
  return owner.host === hostname() && !alive(owner.pid);
}

/**
 * Removes a stale lock, one process at a time. Removing it on a judgement made earlier could delete a lock that another
 * process has taken in the meantime, so a takeover first takes a guard file, and judges the lock again under it. A guard
 * left by a crashed taker is removed once it is old. Returns whether the lock was removed.
 */
export function takeOver(file: string, staleMs: number): boolean {
  const guard = `${file}.takeover`;
  if (!tryWriteFile(guard, String(process.pid), 'wx')) {
    if (ageOfFile(guard) > GUARD_MS) rmSync(guard, { force: true });
    return false;
  }
  try {
    if (!isStale(readOwner(file), file, staleMs)) return false;
    rmSync(file, { force: true });
    return true;
  } finally {
    rmSync(guard, { force: true });
  }
}

/** Takes the lock, and returns the content that identifies it as ours. */
function acquire(file: string, id: string, timeoutMs: number, staleMs: number): string {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Stamped on every attempt: a long wait must not leave us holding a lock that is already stale.
    const mine = JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() } satisfies Owner);
    // Creating the file with its owner in it is one atomic step: exactly one process gets it.
    if (tryWriteFile(file, mine, 'wx')) return mine;
    const owner = readOwner(file);
    if (isStale(owner, file, staleMs) && takeOver(file, staleMs)) continue;
    if (Date.now() >= deadline) {
      const who = owner ? `pid ${owner.pid}` : 'owner unknown';
      throw new AdrienError(
        'ADR_LOCKED',
        `${id} is being changed by another Adrien process (${who}). Try again in a moment.`,
      );
    }
    pause(POLL_MS);
  }
}

/** Removes a lock only if it is still ours: after a takeover it belongs to someone else, and a failure must not stop the other releases. */
function release(file: string, mine: string): void {
  try {
    if (readFileSync(file, 'utf8') === mine) rmSync(file, { force: true });
  } catch {
    // Already gone, or not a file we can read: nothing of ours is left to remove.
  }
}

/**
 * Runs `fn` while holding the lock of every ADR in `ids`, so two processes (the CLI and an MCP server, say) never change
 * the same ADR at once and one never overwrites the other's edit. Locks are files under `.adrien/locks` (ignored by git),
 * taken in sorted order of file name so two callers locking the same ADRs cannot deadlock, and released even if `fn`
 * throws. Not re-entrant: do not lock an id you already hold.
 */
export function withAdrLocks<T>(logRoot: string, ids: string[], fn: () => T, opts: LockOptions = {}): T {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const staleMs = opts.staleMs ?? staleAfter(timeoutMs);
  const dir = join(logRoot, '.adrien', 'locks');
  assertInsideLog(logRoot, dir, '.adrien/locks');
  mkdirSync(dir, { recursive: true });
  tryWriteFile(join(logRoot, '.adrien', '.gitignore'), '*\n', 'wx');
  const names = new Map<string, string>();
  for (const id of ids) names.set(lockName(id), names.get(lockName(id)) ?? id);
  const held: Array<{ file: string; mine: string }> = [];
  try {
    for (const name of [...names.keys()].sort()) {
      const file = join(dir, name);
      held.push({ file, mine: acquire(file, names.get(name) as string, timeoutMs, staleMs) });
    }
    return fn();
  } finally {
    for (const { file, mine } of held.reverse()) release(file, mine);
  }
}
