import { execFile } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CONFIG_FILE, loadLogConfig } from '../src/config.ts';
import { readWorkingLog } from '../src/log.ts';
import { configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';

test('concurrent processes create both ADRs with distinct ids', async () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml() });
  const worker = fileURLToPath(new URL('./helpers/create-concurrently.mjs', import.meta.url));
  const create = (title: string, peer: string) =>
    promisify(execFile)(process.execPath, ['--experimental-strip-types', worker, root, title, peer]);
  await Promise.all([create('Caching', 'Rendering'), create('Rendering', 'Caching')]);
  const { adrs } = readWorkingLog(root, loadLogConfig(root));
  expect(adrs.map((adr) => adr.meta.title).sort()).toEqual(['Caching', 'Rendering']);
  expect(adrs.map((adr) => adr.meta.id).sort()).toEqual(['ADR-0001', 'ADR-0002']);
  // Every id reservation and the folder lock are released. The folder lock's guard folder stays, by design (lock.ts).
  expect(readdirSync(join(root, '.adrien')).sort()).toEqual(['.gitignore', 'folder.lock.guard']);
});
