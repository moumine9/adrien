import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CONFIG_FILE } from '@adrien/core';
import { configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { initRepo } from '../../core/test/helpers/git.ts';
import { assertSafeToExpose, scheduleSync } from '../src/commands/serve.ts';
import { runCli } from '../src/program.ts';

const dist = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe('assertSafeToExpose', () => {
  test.each(['127.0.0.1', 'localhost', '::1', '[::1]'])('%s needs no token', (host) => {
    expect(() => assertSafeToExpose(host, false, false)).not.toThrow();
  });

  test.each(['0.0.0.0', '::', '192.168.1.20', 'adr.example.com'])(
    '%s without a token or --no-auth is refused',
    (host) => {
      expect(() => assertSafeToExpose(host, false, false)).toThrow(/ADRIEN_TOKEN.*--no-auth/s);
    },
  );

  test('a token, or an explicit --no-auth, allows it', () => {
    expect(() => assertSafeToExpose('0.0.0.0', true, false)).not.toThrow();
    expect(() => assertSafeToExpose('0.0.0.0', false, true)).not.toThrow();
  });

  test('a token together with --no-auth is a contradiction', () => {
    expect(() => assertSafeToExpose('127.0.0.1', true, true)).toThrow(/either/);
  });
});

test('serve --host 0.0.0.0 without a token exits 2 before listening', async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml() });
  const result = await runCli(['serve', '--host', '0.0.0.0', '--port', '0'], {
    cwd: root,
    env: { ADRIEN_HOME: tmpDir() },
  });
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('ADRIEN_TOKEN');
});

test('scheduleSync syncs on every interval, reports a failure and keeps going, and stops when asked', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const calls: string[] = [];
  const warnings: string[] = [];
  const stop = scheduleSync(
    '/cache/log',
    60,
    async (dir) => {
      calls.push(dir);
      if (calls.length === 2) throw new Error('network down');
    },
    (message) => warnings.push(message),
  );
  await vi.advanceTimersByTimeAsync(180_000);
  expect(calls).toEqual(['/cache/log', '/cache/log', '/cache/log']);
  expect(warnings).toHaveLength(1);
  expect(warnings[0]).toContain('network down');
  stop();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(calls).toHaveLength(3);
});

describe.runIf(existsSync(dist))('adrien serve with a token, from the bundle', () => {
  test('asks for the token, and serves a host named with --allowed-host', async () => {
    const root = tmpDir();
    writeFiles(root, { [CONFIG_FILE]: configYaml() });
    const child = spawn(process.execPath, [dist, 'serve', '--port', '0', '--allowed-host', 'adr.example.com'], {
      cwd: root,
      env: { ...process.env, ADRIEN_HOME: tmpDir(), ADRIEN_TOKEN: 's3cret' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onTestFinished(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });
    let output = '';
    const port = await new Promise<number>((resolve, reject) => {
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        const line = /http:\/\/127\.0\.0\.1:(\d+)/.exec(output);
        if (line?.[1]) resolve(Number(line[1]));
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('exit', (code) => reject(new Error(`serve exited with ${code}:\n${output}`)));
    });

    const status = (headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        request({ host: '127.0.0.1', port, path: '/api/meta', headers }, (res) => {
          res.resume();
          resolve(res.statusCode ?? 0);
        })
          .on('error', reject)
          .end();
      });

    expect(await status({})).toBe(401);
    expect(await status({ Authorization: 'Bearer wrong' })).toBe(401);
    expect(await status({ Authorization: 'Bearer s3cret' })).toBe(200);
    expect(await status({ Authorization: 'Bearer s3cret', Host: 'adr.example.com' })).toBe(200);
    expect(await status({ Authorization: 'Bearer s3cret', Host: 'other.example.com' })).toBe(403);
    expect(output).not.toContain('s3cret');
  });
});

describe.runIf(existsSync(dist))('ADRIEN_LOG', () => {
  test('names the log when the working directory is not inside one', async () => {
    const root = tmpDir();
    writeFiles(root, { [CONFIG_FILE]: configYaml() });
    const child = spawn(process.execPath, [dist, 'serve', '--port', '0'], {
      cwd: tmpDir(),
      env: { ...process.env, ADRIEN_HOME: tmpDir(), ADRIEN_LOG: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onTestFinished(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });
    let output = '';
    await new Promise<void>((resolve, reject) => {
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        if (/^Adrien serving acme at /m.test(output)) resolve();
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('exit', (code) => reject(new Error(`serve exited with ${code}:\n${output}`)));
    });
  });
});

describe.runIf(existsSync(dist))('a log that follows a git URL', () => {
  test('says on stderr, while running, that it can no longer refresh', async () => {
    const decisions = tmpDir();
    writeFiles(decisions, { [CONFIG_FILE]: configYaml() });
    const { origin } = initRepo(decisions, { origin: true });
    const child = spawn(process.execPath, [dist, 'serve', '--port', '0', '--sync-every', '1'], {
      cwd: tmpDir(),
      env: { ...process.env, ADRIEN_HOME: tmpDir(), ADRIEN_LOG: pathToFileURL(origin ?? '').href },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onTestFinished(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });
    let output = '';
    let listening = false;
    const refused = new Promise<void>((resolve, reject) => {
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        if (!listening && /^Adrien serving /m.test(output)) {
          listening = true;
          rmSync(origin ?? '', { recursive: true, force: true });
        }
        if (/Could not refresh the log: .*Could not fetch/.test(output)) resolve();
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('exit', (code) => reject(new Error(`serve exited with ${code}:\n${output}`)));
    });
    await refused;
    expect(child.exitCode).toBeNull();
  }, 30_000);
});
