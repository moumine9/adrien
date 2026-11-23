import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AdrienError, CONFIG_FILE } from '@adrien/core';
import { configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { logSpecs, singleLog } from '../src/cli.ts';
import { runCli } from '../src/program.ts';

const SEVERAL = 'Several logs were given: only `adrien serve` serves more than one. Pass a single --log.';

function logAt(product = 'acme'): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml({ product }) });
  return root;
}

function run(cwd: string, ...argv: string[]) {
  return runCli(argv, { cwd, env: { ADRIEN_HOME: join(cwd, '.home') } });
}

describe('logSpecs and singleLog', () => {
  test('no log means no specs and no single log', () => {
    expect(logSpecs(undefined)).toEqual([]);
    expect(singleLog(undefined)).toBeUndefined();
  });

  test('a plain log is kept as it is, a URL with a query too', () => {
    expect(singleLog('/x/log')).toBe('/x/log');
    expect(singleLog('https://example.com/acme/log.git?ref=main')).toBe('https://example.com/acme/log.git?ref=main');
  });

  test('a named single log gives its path or URL', () => {
    expect(singleLog('acme=/x/log')).toBe('/x/log');
    expect(singleLog('acme=https://example.com/acme/log.git?ref=main')).toBe(
      'https://example.com/acme/log.git?ref=main',
    );
  });

  test('several logs, separated by ;, are refused by singleLog', () => {
    expect(() => singleLog('a=/x;b=/y')).toThrow(AdrienError);
    expect(() => singleLog('a=/x;b=/y')).toThrow(SEVERAL);
  });

  test('logSpecs names each entry', () => {
    expect(logSpecs('a=/x;b=/y')).toEqual([
      { name: 'a', log: '/x' },
      { name: 'b', log: '/y' },
    ]);
  });
});

describe('a command other than serve takes one log', () => {
  test.each([['list'], ['check'], ['mcp'], ['update', '--check'], ['init', '--code-repo']])(
    '%s refuses two --log flags',
    async (...argv) => {
      const result = await runCli(['--log', `a=${logAt()}`, '--log', `b=${logAt('Beta')}`, ...argv], {
        cwd: tmpDir(),
        env: { ADRIEN_HOME: tmpDir() },
      });
      expect(result.code).toBe(2);
      expect(result.stderr).toContain(SEVERAL);
      expect(result.stdout).toBe('');
    },
  );

  test('list refuses ADRIEN_LOG with two logs', async () => {
    vi.stubEnv('ADRIEN_LOG', `a=${logAt()};b=${logAt('Beta')}`);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const result = await run(tmpDir(), 'list');
    expect(result.code).toBe(2);
    expect(result.stderr).toContain(SEVERAL);
  });

  test('ADRIEN_LOG with one named log works for list', async () => {
    const root = logAt();
    vi.stubEnv('ADRIEN_LOG', `acme=${root}`);
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });
    const result = await run(tmpDir(), 'list');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
  });

  test('init --code-repo writes the single log, without its name', async () => {
    const root = logAt();
    const codeRepo = tmpDir();
    const result = await run(codeRepo, '--log', `acme=${root}`, 'init', '--code-repo');
    expect(result.code).toBe(0);
    const written = readFileSync(join(codeRepo, '.adrien.yaml'), 'utf8');
    expect(written).toContain(root);
    expect(written).not.toContain('acme=');
  });
});
