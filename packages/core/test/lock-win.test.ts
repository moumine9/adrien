import { join } from 'node:path';
import { tmpDir } from './helpers/fixtures.ts';

// On Windows, creating a file that another process is deleting fails with EPERM, not EEXIST.
const hook = vi.hoisted(() => ({ failures: 0, code: 'EPERM' }));
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    writeFileSync: ((...args: Parameters<typeof real.writeFileSync>) => {
      if (hook.failures > 0 && String(args[0]).endsWith('.lock')) {
        hook.failures--;
        throw Object.assign(new Error(`${hook.code}: operation not permitted, open`), { code: hook.code });
      }
      return real.writeFileSync(...args);
    }) as typeof real.writeFileSync,
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
  hook.failures = 2;
  hook.code = 'EPERM';
  let ran = false;
  onPlatform('win32', () => {
    withAdrLocks(root, ['ADR-0001'], () => {
      ran = true;
      expect(existsSync(join(root, '.adrien', 'locks', 'adr-0001.lock'))).toBe(true);
    });
  });
  expect(ran).toBe(true);
});

test('elsewhere the same error is a real failure and is not retried', () => {
  const root = tmpDir();
  hook.failures = 1;
  hook.code = 'EPERM';
  onPlatform('linux', () => {
    expect(() => withAdrLocks(root, ['ADR-0001'], () => undefined)).toThrow('EPERM');
  });
});

test('on Windows an unrelated error is still a real failure', () => {
  const root = tmpDir();
  hook.failures = 1;
  hook.code = 'ENOSPC';
  onPlatform('win32', () => {
    expect(() => withAdrLocks(root, ['ADR-0001'], () => undefined)).toThrow('ENOSPC');
  });
});
