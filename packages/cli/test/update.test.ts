import { join } from 'node:path';
import { tmpDir } from '../../core/test/helpers/fixtures.ts';
import { compareVersions, detectInstall } from '../src/commands/update.ts';
import { runCli } from '../src/program.ts';

const GLOBAL_PATH = '/usr/local/lib/node_modules/adrien/dist/index.js';
const PROJECT_PATH = '/work/app/node_modules/adrien/dist/index.js';
const globalRoot = () => '/usr/local/lib/node_modules';
const NPX_PATH = '/Users/me/.npm/_npx/abc123/node_modules/adrien/dist/index.js';

function latestFetch(version: string | (() => Promise<Response>)) {
  const calls: Array<{ url: string; signal: AbortSignal | null | undefined }> = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), signal: init?.signal });
    if (typeof version === 'function') return version();
    return new Response(JSON.stringify({ version }), { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

function installer(code = 0) {
  const calls: Array<{ command: string; args: string[] }> = [];
  const fn = async (command: string, args: string[]) => {
    calls.push({ command, args });
    return code;
  };
  return { fn, calls };
}

function run(argv: string[], deps: Parameters<typeof runCli>[1]['update']) {
  return runCli(argv, { cwd: tmpDir(), env: { ADRIEN_HOME: join(tmpDir(), '.home') }, update: deps });
}

test('compareVersions orders numeric parts and treats a prerelease as older than its release', () => {
  expect(compareVersions('0.10.0', '0.9.0')).toBeGreaterThan(0);
  expect(compareVersions('1.0.0', '0.99.9')).toBeGreaterThan(0);
  expect(compareVersions('0.6.0', '0.6.0')).toBe(0);
  expect(compareVersions('0.6.0', '0.6.1')).toBeLessThan(0);
  expect(compareVersions('0.6.0-rc.1', '0.6.0')).toBeLessThan(0);
  expect(compareVersions('0.6.0-rc.2', '0.6.0-rc.10')).toBeLessThan(0);
});

test('update --check prints current and latest and exits 0 when an update exists', async () => {
  const { fn, calls } = latestFetch('0.7.0');
  const result = await run(['update', '--check'], {
    current: '0.6.0',
    fetch: fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(result).toMatchObject({ code: 0, stderr: '' });
  expect(result.stdout).toContain('Current: 0.6.0');
  expect(result.stdout).toContain('Latest:  0.7.0');
  expect(result.stdout).toContain('Update available');
  expect(calls[0]?.url).toBe('https://registry.npmjs.org/adrien/latest');
  expect(calls[0]?.signal).toBeDefined();
});

test('update --check says so when already on the latest version', async () => {
  const { fn } = latestFetch('0.6.0');
  const result = await run(['update', '--check'], {
    current: '0.6.0',
    fetch: fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(result).toMatchObject({ code: 0 });
  expect(result.stdout).toContain('up to date');
});

test('--json with update --check prints current, latest and updateAvailable', async () => {
  const { fn } = latestFetch('0.7.0');
  const result = await run(['--json', 'update', '--check'], {
    current: '0.6.0',
    fetch: fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ current: '0.6.0', latest: '0.7.0', updateAvailable: true });
});

test('a prerelease latest is ignored', async () => {
  const { fn } = latestFetch('0.7.0-beta.1');
  const result = await run(['--json', 'update', '--check'], {
    current: '0.6.0',
    fetch: fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(JSON.parse(result.stdout)).toMatchObject({ updateAvailable: false });
});

test('update when already latest says so and runs nothing', async () => {
  const { fn } = latestFetch('0.6.0');
  const install = installer();
  const result = await run(['update'], {
    current: '0.6.0',
    fetch: fn,
    install: install.fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(result).toMatchObject({ code: 0 });
  expect(result.stdout).toContain('the latest version');
  expect(install.calls).toEqual([]);
});

test('update from a global install runs npm install -g adrien@latest and reports the result', async () => {
  const { fn } = latestFetch('0.7.0');
  const install = installer(0);
  const result = await run(['update'], {
    current: '0.6.0',
    fetch: fn,
    install: install.fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(install.calls).toEqual([{ command: 'npm', args: ['install', '-g', 'adrien@latest'] }]);
  expect(result).toMatchObject({ code: 0 });
  expect(result.stdout).toContain('0.6.0 -> 0.7.0');
});

test('update reports a failed global install with exit 1', async () => {
  const { fn } = latestFetch('0.7.0');
  const install = installer(1);
  const result = await run(['update'], {
    current: '0.6.0',
    fetch: fn,
    install: install.fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('npm install -g adrien@latest failed');
});

test('update under npx prints the npx command and runs nothing', async () => {
  const { fn } = latestFetch('0.7.0');
  const install = installer();
  const result = await run(['update'], {
    current: '0.6.0',
    fetch: fn,
    install: install.fn,
    installPath: NPX_PATH,
    globalRoot,
  });
  expect(result).toMatchObject({ code: 0 });
  expect(result.stdout).toContain('npx adrien@latest');
  expect(install.calls).toEqual([]);
});

test('update as a project dependency prints the npm install command and runs nothing', async () => {
  const { fn } = latestFetch('0.7.0');
  const install = installer();
  const result = await run(['update'], {
    current: '0.6.0',
    fetch: fn,
    install: install.fn,
    installPath: PROJECT_PATH,
    globalRoot,
  });
  expect(result).toMatchObject({ code: 0 });
  expect(result.stdout).toContain('npm install adrien@latest');
  expect(install.calls).toEqual([]);
});

test('a network failure exits non-zero with the NETWORK error and runs nothing', async () => {
  const fn = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;
  const install = installer();
  const result = await run(['update'], {
    current: '0.6.0',
    fetch: fn,
    install: install.fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('npm registry');
  expect(install.calls).toEqual([]);
});

test('a registry answer without a usable version is a network error too', async () => {
  const { fn } = latestFetch(() => Promise.resolve(new Response('{}', { status: 503 })));
  const result = await run(['update', '--check'], {
    current: '0.6.0',
    fetch: fn,
    installPath: GLOBAL_PATH,
    globalRoot,
  });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('npm registry');
});

test("detectInstall only calls a copy global when it sits under npm's own global root", () => {
  const root = '/usr/local/lib/node_modules';
  expect(detectInstall(GLOBAL_PATH, root)).toBe('global');
  expect(detectInstall('/home/me/code/lib/node_modules/adrien/dist/index.js', root)).toBe('project');
  expect(detectInstall(GLOBAL_PATH, null)).toBe('project');
  expect(
    detectInstall('/home/me/Library/pnpm/global/5/node_modules/.pnpm/adrien@1/node_modules/adrien/dist/i.js', root),
  ).toBe('pnpm');
  expect(detectInstall('/home/me/.config/yarn/global/node_modules/adrien/dist/i.js', root)).toBe('yarn');
  expect(detectInstall('/home/me/.bun/install/global/node_modules/adrien/dist/i.js', root)).toBe('bun');
  expect(detectInstall('/opt/adrien/dist/i.js', root)).toBe('unknown');
  expect(detectInstall(NPX_PATH, root)).toBe('npx');
});

test('a pnpm global copy prints the pnpm command and never runs npm', async () => {
  const { fn } = latestFetch('0.7.0');
  const install = installer();
  const path = '/home/me/Library/pnpm/global/5/node_modules/.pnpm/adrien@0.6.0/node_modules/adrien/dist/index.js';
  const result = await run(['update'], {
    current: '0.6.0',
    fetch: fn,
    install: install.fn,
    installPath: path,
    globalRoot,
  });
  expect(result.stdout).toContain('pnpm add -g adrien@latest');
  expect(install.calls).toEqual([]);
});

test('a copy that cannot be placed prints the global command and runs nothing', async () => {
  const { fn } = latestFetch('0.7.0');
  const install = installer();
  const result = await run(['update'], {
    current: '0.6.0',
    fetch: fn,
    install: install.fn,
    installPath: '/opt/adrien/dist/index.js',
    globalRoot,
  });
  expect(result.stdout).toContain('npm install -g adrien@latest');
  expect(install.calls).toEqual([]);
});

describe('starting npm', () => {
  const calls: Array<{ command: string; args: unknown; shell: unknown }> = [];

  beforeEach(() => {
    calls.length = 0;
    vi.resetModules();
    vi.doMock('node:child_process', async (importOriginal) => ({
      ...(await importOriginal<typeof import('node:child_process')>()),
      execFileSync: (command: string, second?: unknown, third?: { shell?: unknown }) => {
        const options = Array.isArray(second) ? third : (second as { shell?: unknown });
        calls.push({ command, args: Array.isArray(second) ? second : undefined, shell: options?.shell });
        return `${process.cwd()}\n`;
      },
      spawn: (command: string, second?: unknown, third?: { shell?: unknown }) => {
        const options = Array.isArray(second) ? third : (second as { shell?: unknown });
        calls.push({ command, args: Array.isArray(second) ? second : undefined, shell: options?.shell });
        return { on: (event: string, cb: (code?: number) => void) => event === 'exit' && cb(0) };
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('node:child_process');
    vi.restoreAllMocks();
  });

  test('on Windows the lookup is one command string run by a shell, never a shell with an argument list', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    const { npmGlobalRoot } = await import('../src/commands/update.ts');
    expect(npmGlobalRoot()).toBeTruthy();
    expect(calls).toEqual([{ command: 'npm root -g', args: undefined, shell: true }]);
  });

  test('elsewhere the lookup is npm with an argument list and no shell', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const { npmGlobalRoot } = await import('../src/commands/update.ts');
    expect(npmGlobalRoot()).toBeTruthy();
    expect(calls).toEqual([{ command: 'npm', args: ['root', '-g'], shell: undefined }]);
  });

  test.each([
    ['win32', { command: 'npm install -g adrien@latest', args: undefined, shell: true }],
    ['linux', { command: 'npm', args: ['install', '-g', 'adrien@latest'], shell: undefined }],
  ])('the installer on %s is started the same way', async (platform, expected) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const { spawnInstaller } = await import('../src/commands/update.ts');
    await expect(spawnInstaller('npm', ['install', '-g', 'adrien@latest'])).resolves.toBe(0);
    expect(calls).toEqual([expected]);
  });
});

test('the real npm lookup finds a folder and raises no deprecation warning', async () => {
  vi.resetModules();
  const warn = vi.spyOn(process, 'emitWarning');
  const { npmGlobalRoot } = await import('../src/commands/update.ts');
  expect(npmGlobalRoot()).toBeTruthy();
  expect(warn).not.toHaveBeenCalled();
  warn.mockRestore();
});
