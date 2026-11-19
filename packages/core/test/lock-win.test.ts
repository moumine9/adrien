import { join } from 'node:path';
import { tmpDir } from './helpers/fixtures.ts';

// On Windows, creating a file that another process is deleting fails with EPERM, not EEXIST.
const hook = vi.hoisted(() => ({ failures: 0, code: 'EPERM', match: '.lock', skewMs: 0, rmFailures: 0 }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    writeFileSync: ((...args: Parameters<typeof real.writeFileSync>) => {
      if (hook.failures > 0 && String(args[0]).includes(hook.match)) {
        hook.failures--;
        if (hook.skewMs) vi.setSystemTime(Date.now() + hook.skewMs);
        throw Object.assign(new Error(`${hook.code}: operation not permitted, open`), { code: hook.code });
      }
      return real.writeFileSync(...args);
    }) as typeof real.writeFileSync,
    rmSync: ((...args: Parameters<typeof real.rmSync>) => {
      if (hook.rmFailures > 0 && String(args[0]).includes('.guard')) {
        hook.rmFailures--;
        throw Object.assign(new Error('EPERM: operation not permitted, unlink'), { code: 'EPERM' });
      }
      return real.rmSync(...args);
    }) as typeof real.rmSync,
  };
});

const { withAdrLocks } = await import('../src/lock.ts');
const { existsSync } = await import('node:fs');

function onPlatform(platform: string, fn: () => void): void {
  const original = Object.getOwnPropertyDescriptor(process, 'platform') as PropertyDescriptor;
  Object.defineProperty(process, 'platform', { value: platform });
  try {
    fn();
  } finally {
    Object.defineProperty(process, 'platform', original);
  }
}

test('on Windows a lock that is being deleted (EPERM on create) is waited for, then taken', () => {
  const root = tmpDir();
  Object.assign(hook, { failures: 2, code: 'EPERM', match: '.lock', skewMs: 0, rmFailures: 0 });
  let ran = false;
  onPlatform('win32', () => {
    withAdrLocks(root, ['ADR-0001'], () => {
      ran = true;
      expect(existsSync(join(root, '.adrien', 'locks', 'adr-0001.lock'))).toBe(true);
    });
  });
  expect(ran).toBe(true);
  expect(hook.failures).toBe(0);
});

test('elsewhere the same error is a real failure and is not retried', () => {
  const root = tmpDir();
  Object.assign(hook, { failures: 1, code: 'EPERM', match: '.lock', skewMs: 0, rmFailures: 0 });
  onPlatform('linux', () => {
    expect(() => withAdrLocks(root, ['ADR-0001'], () => undefined)).toThrow('EPERM');
  });
});

test('on Windows an unrelated error is still a real failure', () => {
  const root = tmpDir();
  Object.assign(hook, { failures: 1, code: 'ENOSPC', match: '.lock', skewMs: 0, rmFailures: 0 });
  onPlatform('win32', () => {
    expect(() => withAdrLocks(root, ['ADR-0001'], () => undefined)).toThrow('ENOSPC');
  });
});

test('on Windows a guard that cannot be created (EPERM on every try) gives up instead of hanging a release', () => {
  const root = tmpDir();
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    onPlatform('win32', () => {
      withAdrLocks(root, ['ADR-0001'], () => {
        // The lock is held; from now on every guard creation fails, as a persistent fault would.
        Object.assign(hook, { failures: 1000, code: 'EPERM', match: '.guard', skewMs: 5_000, rmFailures: 0 });
      });
    });
  } finally {
    vi.useRealTimers();
    hook.failures = 0;
  }
  expect(existsSync(join(root, '.adrien', 'locks', 'adr-0001.lock'))).toBe(true);
});

test('cleaning up old guard files is best effort: a failed removal never fails the work', () => {
  const root = tmpDir();
  let ran = 0;
  Object.assign(hook, { failures: 0, code: 'EPERM', match: '.lock', skewMs: 0, rmFailures: 2 });
  // Two locks in a row leave a second guard generation, so the second release has an older one to clean up.
  withAdrLocks(root, ['ADR-0001'], () => ran++);
  withAdrLocks(root, ['ADR-0001'], () => ran++);
  expect(ran).toBe(2);
  expect(hook.rmFailures).toBe(0);
});
