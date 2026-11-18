import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';

const script = fileURLToPath(new URL('../../../scripts/check-changelog.mjs', import.meta.url));

/** Runs the check in a repository whose published package is at `version` and whose changelog is `changelog`. */
function check(version: string, changelog: string | null) {
  const root = tmpDir();
  writeFiles(root, { 'packages/cli/package.json': JSON.stringify({ name: 'adrien', version }) });
  if (changelog !== null) writeFiles(root, { 'CHANGELOG.md': changelog });
  const run = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  return { code: run.status, stderr: run.stderr, stdout: run.stdout };
}

test('passes when the version has an entry, as the generated and the hand-written headings spell it', () => {
  const generated =
    '## [0.4.0](https://example.com/compare/v0.3.1...v0.4.0) (2026-11-18)\n\n### Features\n\n* a thing\n';
  expect(check('0.4.0', generated)).toMatchObject({ code: 0 });
  expect(check('0.3.1', '### 0.3.1\n\n- Core fixes.\n')).toMatchObject({ code: 0 });
  expect(check('0.4.1', '### [0.4.1](https://example.com) (2026-11-18)\n\n### Bug Fixes\n\n* a fix\n')).toMatchObject({
    code: 0,
  });
});

test('fails, saying what to run, when the version has no entry', () => {
  const result = check('0.5.0', '## [0.4.0](https://example.com) (2026-11-18)\n\n### Features\n\n* a thing\n');
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('no entry for version 0.5.0');
  expect(result.stderr).toContain('pnpm changelog');
});

test('0.3.1 is not satisfied by an entry for 0.3.10', () => {
  expect(check('0.3.1', '## 0.3.10 (2026-11-18)\n\n* a thing\n').code).toBe(1);
});

test('an entry with nothing under it does not count', () => {
  expect(check('0.4.0', '## 0.4.0 (2026-11-18)\n\n## 0.3.1 (2026-11-01)\n\n* a thing\n').code).toBe(1);
});

test('a missing CHANGELOG.md fails', () => {
  const result = check('0.4.0', null);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('CHANGELOG.md');
});
