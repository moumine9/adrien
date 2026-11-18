import type { LogConfig } from '../src/config.ts';
import { adrFilePath, readWorkingLog, writeAdr } from '../src/log.ts';
import { adrText, tmpDir, writeFiles } from './helpers/fixtures.ts';

const config: LogConfig = { product: 'acme', adr_dir: 'docs/adr', id_format: 'ADR-{n:4}', tags: [], components: {} };

test('reads ADRs in subfolders and skips index.md', () => {
  const root = tmpDir();
  writeFiles(root, {
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }),
    'docs/adr/backend/billing/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B' }),
    'docs/adr/index.md': '# Index\n\n- [ADR-0001](ADR-0001-a.md)\n',
  });
  const log = readWorkingLog(root, config);
  expect(log.adrs.map((a) => a.meta.id)).toEqual(['ADR-0001', 'ADR-0002']);
  expect(log.adrs[1]?.path).toBe('docs/adr/backend/billing/ADR-0002-b.md');
  expect(log.problems).toEqual([]);
});

test('one malformed file becomes a problem; the other ADRs still load', () => {
  const root = tmpDir();
  writeFiles(root, {
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }),
    'docs/adr/ADR-0002-b.md': adrText({ id: 'ADR-0002', title: 'B' }),
    'docs/adr/bad.md': '---\nid: ADR-0003\ntitle: [unclosed\n---\n',
  });
  const log = readWorkingLog(root, config);
  expect(log.adrs).toHaveLength(2);
  expect(log.problems).toHaveLength(1);
  expect(log.problems[0]?.path).toBe('docs/adr/bad.md');
});

test('paths never contain a backslash', () => {
  const root = tmpDir();
  writeFiles(root, { 'docs/adr/x/y/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  for (const adr of readWorkingLog(root, config).adrs) expect(adr.path).not.toContain('\\');
});

test('a missing adr_dir is an empty log, not an error', () => {
  expect(readWorkingLog(tmpDir(), config)).toEqual({ adrs: [], problems: [] });
});

test('adrFilePath builds <adr_dir>/<subdir>/<id>-<slug>.md', () => {
  expect(adrFilePath(config, 'ADR-0003', 'Use Postgres')).toBe('docs/adr/ADR-0003-use-postgres.md');
  expect(adrFilePath(config, 'ADR-0003', 'Use Postgres', 'backend')).toBe('docs/adr/backend/ADR-0003-use-postgres.md');
});

test('writeAdr creates subdirs and round-trips through readWorkingLog', () => {
  const root = tmpDir();
  const [adr] = readWorkingLog(writeFixture(), config).adrs;
  if (!adr) throw new Error('fixture missing');
  const moved = { ...adr, path: 'docs/adr/new/dir/ADR-0001-a.md' };
  writeAdr(root, moved);
  expect(readWorkingLog(root, config).adrs).toEqual([moved]);
});

function writeFixture(): string {
  const root = tmpDir();
  writeFiles(root, { 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', tags: ['backend'] }) });
  return root;
}
