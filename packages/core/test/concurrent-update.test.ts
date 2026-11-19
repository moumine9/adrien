import { execFile } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CONFIG_FILE } from '../src/config.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';

const worker = fileURLToPath(new URL('./helpers/update-notes.mjs', import.meta.url));

test('two processes changing the same ADR at once lose none of their changes', async () => {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', review_rule: 'A rule.' }),
  });
  const run = (label: string) =>
    promisify(execFile)(process.execPath, ['--experimental-strip-types', worker, root, 'ADR-0001', label, '25']);
  await Promise.all([run('A'), run('B')]);

  const notes = readFileSync(join(root, 'docs/adr/ADR-0001-a.md'), 'utf8').match(
    /Proposed change \(agent, [^)]*\): ([AB]\d+)/g,
  );
  // Every one of the 50 read-change-write cycles survived: nobody overwrote anybody.
  expect(notes).toHaveLength(50);
  expect(new Set(notes).size).toBe(50);
  expect(readdirSync(join(root, '.adrien', 'locks')).filter((n) => n.endsWith('.lock'))).toEqual([]);
}, 60_000);
