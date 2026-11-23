import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE } from '@adrien/core';
import { configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { runCli } from '../src/program.ts';

const dist = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function logAt(product = 'acme'): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml({ product }) });
  return root;
}

/** Starts the bundled `adrien serve` and resolves with its URL and its whole startup line once it listens. */
function serve(cwd: string, args: string[], env: Record<string, string> = {}) {
  const child = spawn(process.execPath, [dist, 'serve', '--port', '0', ...args], {
    cwd,
    env: { ...process.env, ADRIEN_HOME: tmpDir(), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  onTestFinished(async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  });
  let output = '';
  return new Promise<{ url: string; startup: string }>((resolve, reject) => {
    const read = (chunk: Buffer) => {
      output += chunk.toString();
      const line = /^(Adrien serving .* at (http:\/\/127\.0\.0\.1:\d+))$/m.exec(output);
      if (line?.[1] && line[2]) resolve({ url: line[2], startup: line[1] });
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('exit', (code) => reject(new Error(`serve exited with ${code}:\n${output}`)));
  });
}

describe.runIf(existsSync(dist))('adrien serve with several workspaces', () => {
  test('serves each log under its name, one token covers them all, and names them at startup', async () => {
    const { url, startup } = await serve(tmpDir(), ['--log', `a=${logAt('Alpha')}`, '--log', `b=${logAt('Beta')}`], {
      ADRIEN_TOKEN: 's3cret',
    });
    expect(startup).toMatch(/^Adrien serving 2 workspaces \(a, b\) at /);

    const get = (path: string, token?: string) =>
      fetch(`${url}${path}`, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    expect((await get('/api/w/a/meta')).status).toBe(401);

    const listed = await get('/api/workspaces', 's3cret');
    expect(listed.status).toBe(200);
    const { workspaces } = (await listed.json()) as { workspaces: { name: string; product: string }[] };
    expect(workspaces.map((w) => [w.name, w.product])).toEqual([
      ['a', 'Alpha'],
      ['b', 'Beta'],
    ]);

    for (const [name, product] of [
      ['a', 'Alpha'],
      ['b', 'Beta'],
    ] as const) {
      const meta = await get(`/api/w/${name}/meta`, 's3cret');
      expect(meta.status).toBe(200);
      expect(await meta.json()).toMatchObject({ product });
    }

    const flat = await get('/api/meta', 's3cret');
    expect(flat.status).toBe(404);
    expect(await flat.text()).toContain('WORKSPACE_REQUIRED');
  });

  test('a single log keeps the startup line it has always had', async () => {
    const { startup } = await serve(tmpDir(), ['--log', `alpha=${logAt('Alpha')}`]);
    expect(startup).toMatch(/^Adrien serving Alpha at /);
  });
});

describe('serve resolves its workspaces before listening', () => {
  test('two logs with the same name fail fast with a usage error', async () => {
    const result = await runCli(['serve', '--port', '0', '--log', `a=${logAt()}`, '--log', `a=${logAt('Beta')}`], {
      cwd: tmpDir(),
      env: { ADRIEN_HOME: tmpDir() },
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('Two workspaces are named "a"');
    expect(result.stdout).toBe('');
  });

  test('a log that cannot name itself is refused when several are served', async () => {
    const result = await runCli(['serve', '--port', '0', '--log', logAt('東京'), '--log', `b=${logAt('Beta')}`], {
      cwd: tmpDir(),
      env: { ADRIEN_HOME: tmpDir() },
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('has no usable workspace name');
    expect(result.stdout).toBe('');
  });

  test('the same log listed twice is refused', async () => {
    const root = logAt();
    const result = await runCli(['serve', '--port', '0', '--log', `a=${root}`, '--log', `b=${root}`], {
      cwd: tmpDir(),
      env: { ADRIEN_HOME: tmpDir() },
    });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('is listed twice');
  });
});
