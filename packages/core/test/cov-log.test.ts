import { mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parseLogConfigText } from '../src/config.ts';
import { parseAdr } from '../src/frontmatter.ts';
import { parseLogFiles, writeAdr } from '../src/log.ts';
import { configYaml, tmpDir } from './helpers/fixtures.ts';

const adr = parseAdr('# Storage', '1-storage.md', { idFormat: 'ADR-{n}' });

test('invalid id formats propagate through log parsing', () => {
  const config = parseLogConfigText(configYaml(), 'config');
  expect(() => parseLogFiles([{ path: adr.path, text: '# Storage' }], { ...config, id_format: 'bad' })).toThrow(
    expect.objectContaining({ code: 'CONFIG_INVALID' }),
  );
});

test('refuses a parent traversal and propagates filesystem write errors', () => {
  const root = tmpDir();
  expect(() => writeAdr(root, { ...adr, path: '../outside.md' })).toThrow('resolves outside the log');
  mkdirSync(join(root, adr.path));
  expect(() => writeAdr(root, adr)).toThrow(
    expect.objectContaining({ code: expect.stringMatching(/^(EISDIR|EPERM|EACCES)$/) }),
  );
});

test.skipIf(process.platform === 'win32')(
  'writes through an internal file link and refuses an external directory link',
  () => {
    const root = tmpDir();
    writeAdr(root, adr);
    symlinkSync(adr.path, join(root, 'alias.md'));
    writeAdr(root, { ...adr, path: 'alias.md', body: 'updated' });
    expect(readFileSync(join(root, adr.path), 'utf8')).toContain('updated');
    symlinkSync(tmpDir(), join(root, 'elsewhere'));
    expect(() => writeAdr(root, { ...adr, path: 'elsewhere/new/record.md' })).toThrow('resolves outside the log');
  },
);
