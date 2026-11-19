import { mkdirSync, readFileSync, rmSync } from 'node:fs';
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

/** A safe file name for an id: whatever it holds, it cannot reach another folder. Two ids may share a name; that only serialises them. */
const lockName = (id: string): string => `${encodeURIComponent(id).replaceAll('%', '~')}.lock`;

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

/**
 * Whether a lock can be taken over: it has been held longer than `staleMs`, or its holder ran on this machine and is
 * gone. A lock with no readable owner is judged by how long we have been waiting for it. A pid from another machine
 * says nothing, so only age counts there.
 */
function isStale(owner: Owner | null, waitingSince: number, staleMs: number): boolean {
  if (owner === null) return Date.now() - waitingSince > staleMs;
  if (Date.now() - owner.at > staleMs) return true;
  return owner.host === hostname() && !alive(owner.pid);
}

function acquire(file: string, id: string, timeoutMs: number, staleMs: number): void {
  const waitingSince = Date.now();
  const deadline = waitingSince + timeoutMs;
  const mine = JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() } satisfies Owner);
  for (;;) {
    // Creating the file with its owner in it is one atomic step: exactly one process gets it.
    if (tryWriteFile(file, mine, 'wx')) return;
    const owner = readOwner(file);
    if (isStale(owner, waitingSince, staleMs)) {
      rmSync(file, { force: true });
      continue;
    }
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

/**
 * Runs `fn` while holding the lock of every ADR in `ids`, so two processes (the CLI and an MCP server, say) never change
 * the same ADR at once and one never overwrites the other's edit. Locks are files under `.adrien/locks` (ignored by git),
 * taken in sorted order so two callers locking the same ADRs cannot deadlock, and released even if `fn` throws. Not
 * re-entrant: do not lock an id you already hold.
 */
export function withAdrLocks<T>(logRoot: string, ids: string[], fn: () => T, opts: LockOptions = {}): T {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, staleMs = DEFAULT_STALE_MS } = opts;
  const dir = join(logRoot, '.adrien', 'locks');
  assertInsideLog(logRoot, dir, '.adrien/locks');
  mkdirSync(dir, { recursive: true });
  tryWriteFile(join(logRoot, '.adrien', '.gitignore'), '*\n', 'wx');
  const held: string[] = [];
  try {
    for (const id of [...new Set(ids)].sort()) {
      const file = join(dir, lockName(id));
      acquire(file, id, timeoutMs, staleMs);
      held.push(file);
    }
    return fn();
  } finally {
    for (const file of held.reverse()) rmSync(file, { force: true });
  }
}
