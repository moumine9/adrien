import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE, findUp, loadLogConfig, writeLogConfig } from '../src/config.ts';
import { tmpDir, writeFiles } from './helpers/fixtures.ts';

test('loadLogConfig applies defaults', () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: 'product: acme\n' });
  expect(loadLogConfig(root)).toEqual({
    product: 'acme',
    adr_dir: 'docs/adr',
    id_format: 'ADR-{n:4}',
    template: 'standard',
    tags: [],
    components: {},
  });
});

test('rejects a component id containing ":" with CONFIG_INVALID naming it', () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: 'product: acme\ncomponents:\n  "billing:x": {}\n' });
  expect(() => loadLogConfig(root)).toThrow(
    expect.objectContaining({ code: 'CONFIG_INVALID', message: expect.stringContaining('billing:x') }),
  );
});

test('missing config → CONFIG_NOT_FOUND', () => {
  expect(() => loadLogConfig(tmpDir())).toThrow(expect.objectContaining({ code: 'CONFIG_NOT_FOUND' }));
});

test('writeLogConfig refuses to overwrite → CONFIG_EXISTS', () => {
  const root = tmpDir();
  const config = {
    product: 'acme',
    adr_dir: 'docs/adr',
    id_format: 'ADR-{n:4}',
    template: 'standard' as const,
    tags: [],
    components: {},
  };
  writeLogConfig(root, config);
  expect(loadLogConfig(root)).toEqual(config);
  expect(() => writeLogConfig(root, config)).toThrow(expect.objectContaining({ code: 'CONFIG_EXISTS' }));
});

test('findUp finds the config from a nested dir and returns null when absent', () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: 'product: acme\n' });
  const nested = join(root, 'a', 'b');
  mkdirSync(nested, { recursive: true });
  expect(findUp(nested, CONFIG_FILE)).toBe(root);
  expect(findUp(nested, 'no-such-file.yaml')).toBeNull();
});

test('template defaults to standard and rejects an unknown name', () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: 'product: acme\n' });
  expect(loadLogConfig(root).template).toBe('standard');
  writeFiles(root, { [CONFIG_FILE]: 'product: acme\ntemplate: madr\n' });
  expect(loadLogConfig(root).template).toBe('madr');
  writeFiles(root, { [CONFIG_FILE]: 'product: acme\ntemplate: fancy\n' });
  expect(() => loadLogConfig(root)).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
});
