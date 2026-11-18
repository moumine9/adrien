import { CODE_CONFIG_FILE, loadCodeRepoConfig, parseLogConfigText } from '../src/config.ts';
import { tmpDir, writeFiles } from './helpers/fixtures.ts';

test('a component declared without settings has an empty definition', () => {
  expect(parseLogConfigText('product: acme\ncomponents:\n  web:\n', 'log').components).toEqual({ web: {} });
});

test.each([
  ['product: [', 'invalid YAML'],
  ['', 'product:'],
  ['[]', 'config:'],
])('reports the label and validation problem for %j', (text, problem) => {
  expect(() => parseLogConfigText(text, 'log')).toThrow(`log: ${problem}`);
});

test('an absent code config is optional, while empty and malformed files report distinct errors', () => {
  const dir = tmpDir();
  expect(loadCodeRepoConfig(dir)).toBeNull();
  writeFiles(dir, { [CODE_CONFIG_FILE]: '' });
  expect(() => loadCodeRepoConfig(dir)).toThrow(`${CODE_CONFIG_FILE}: log:`);
  writeFiles(dir, { [CODE_CONFIG_FILE]: 'log: [' });
  expect(() => loadCodeRepoConfig(dir)).toThrow(`${CODE_CONFIG_FILE}: invalid YAML`);
});
