import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '@adrien/api';
import { CONFIG_FILE } from '@adrien/core';
import { configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { runCli, VERSION } from '../src/program.ts';

const dist = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function log(): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml() });
  return root;
}

function run(cwd: string, ...argv: string[]) {
  return runCli(argv, { cwd, env: { ADRIEN_HOME: join(cwd, '.home') } });
}

test.each(['--port=abc', '--port=-1', '--port=65536', '--port=1.5', '--port='])('serve %s exits 2', async (arg) => {
  const result = await run(log(), 'serve', arg);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('0 to 65535');
  expect(result.stdout).toBe('');
});

test('serve without a log exits 2 before listening', async () => {
  const result = await run(tmpDir(), 'serve', '--port', '0');
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('No Adrien log found');
});

test('serve on a port already in use exits 2 and names it', async () => {
  const root = log();
  const taken = await startServer({ cwd: root, env: { ADRIEN_HOME: tmpDir() }, port: 0 });
  onTestFinished(() => taken.close());
  const result = await run(root, 'serve', '--port', String(taken.port));
  expect(result.code).toBe(2);
  expect(result.stderr).toContain(`127.0.0.1:${taken.port}`);
});

// `pretest` builds the bundle; a bare `vitest run` without a build skips this instead of failing on it.
describe.runIf(existsSync(dist))('adrien serve from the bundle', () => {
  test('prints its URL once listening, answers until it is stopped', async () => {
    const root = log();
    const child = spawn(process.execPath, [dist, 'serve', '--port', '0'], {
      cwd: root,
      env: { ...process.env, ADRIEN_HOME: tmpDir() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    onTestFinished(async () => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    });

    let output = '';
    const url = await new Promise<string>((resolve, reject) => {
      const read = (chunk: Buffer) => {
        output += chunk.toString();
        const line = /^Adrien serving acme at (http:\/\/127\.0\.0\.1:\d+)$/m.exec(output);
        if (line?.[1]) resolve(line[1]);
      };
      child.stdout.on('data', read);
      child.stderr.on('data', read);
      child.on('exit', (code) => reject(new Error(`serve exited with ${code}:\n${output}`)));
    });

    const meta = await fetch(`${url}/api/meta`);
    expect(meta.status).toBe(200);
    expect(await meta.json()).toMatchObject({ product: 'acme', version: VERSION });

    // The web app is looked up next to the bundle, in dist/web, which exists only once packages/web is built.
    const page = await fetch(`${url}/`);
    expect(page.status).toBe(existsSync(join(dirname(dist), 'web', 'index.html')) ? 200 : 404);
    expect(child.exitCode).toBeNull();
  });
});
