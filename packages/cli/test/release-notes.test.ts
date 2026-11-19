import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';

const script = fileURLToPath(new URL('../../../scripts/release-notes.mjs', import.meta.url));

/** Runs the script for `version` in a repository whose CHANGELOG.md is `changelog` (null: no file). */
function notes(version: string | null, changelog: string | null) {
  const root = tmpDir();
  if (changelog !== null) writeFiles(root, { 'CHANGELOG.md': changelog });
  const args = version === null ? [script] : [script, version];
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
  return { code: run.status, stderr: run.stderr, stdout: run.stdout };
}

const GENERATED = [
  '## [0.4.0](https://example.com/compare/v0.3.1...v0.4.0) (2026-11-18)',
  '',
  '### Features',
  '',
  '* **web:** add a read-only Board view ([cdea139](https://example.com/commit/cdea139))',
  '',
  '## Earlier releases',
  '',
  '### 0.3.1',
  '',
  '- Core fixes.',
  '',
].join('\n');

test('prints a generated entry with its sub-sections, and stops at the next level 2 heading', () => {
  expect(notes('0.4.0', GENERATED)).toEqual({
    code: 0,
    stderr: '',
    stdout: '### Features\n\n* **web:** add a read-only Board view ([cdea139](https://example.com/commit/cdea139))\n',
  });
});

test('prints a hand-written entry, and stops at the next version heading', () => {
  expect(notes('0.3.1', '### 0.3.1\n\n- Core fixes.\n\n### 0.3.0\n\n- Self-hosting.\n')).toMatchObject({
    code: 0,
    stdout: '- Core fixes.\n',
  });
});

test('0.3.1 is not satisfied by an entry for 0.3.10, and its entry ends before 0.3.10', () => {
  const newer = '### 0.3.10\n\n- Newer.\n';
  expect(notes('0.3.1', newer)).toMatchObject({ code: 1 });
  expect(notes('0.3.1', newer).stderr).toContain('no entry for version 0.3.1');
  expect(notes('0.3.1', `${newer}\n### 0.3.1\n\n- Core fixes.\n`).stdout).toBe('- Core fixes.\n');
  expect(notes('0.3.1', '### 0.3.1\n\n- Core fixes.\n\n### 0.3.10\n\n- Newer.\n').stdout).toBe('- Core fixes.\n');
});

test('an empty entry fails and prints nothing', () => {
  const result = notes('0.4.0', '## 0.4.0 (2026-11-18)\n\n## 0.3.1 (2026-11-01)\n\n* a thing\n');
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('is empty');
  expect(result.stdout).toBe('');
});

test('a missing CHANGELOG.md fails', () => {
  const result = notes('0.4.0', null);
  expect(result.code).toBe(1);
  expect(result.stderr).toContain('CHANGELOG.md is missing');
});

test('fails, saying what to run, when the version has no entry', () => {
  const result = notes('0.5.0', GENERATED);
  expect(result).toMatchObject({ code: 1, stdout: '' });
  expect(result.stderr).toContain('no entry for version 0.5.0');
});

test('needs a version argument', () => {
  const result = notes(null, GENERATED);
  expect(result).toMatchObject({ code: 1, stdout: '' });
  expect(result.stderr).toContain('usage');
});

test('the heading line is not in the output, for either heading style', () => {
  const generated = notes('0.4.0', GENERATED).stdout;
  expect(generated).toContain('### Features');
  expect(generated).not.toContain('[0.4.0]');
  expect(generated).not.toContain('(2026-11-18)');
  const handWritten = notes('0.3.1', '### 0.3.1\n\n- Core fixes.\n').stdout;
  expect(handWritten).toBe('- Core fixes.\n');
});

test('keeps the sub-sections of a patch entry, whose ### heading does not end it', () => {
  const patch = [
    '### [0.4.1](https://example.com/compare/v0.4.0...v0.4.1) (2026-11-20)',
    '',
    '### Bug Fixes',
    '',
    '* a fix',
    '',
    '## Earlier releases',
    '',
    '### 0.4.0',
    '',
    '- x',
    '',
  ].join('\n');
  expect(notes('0.4.1', patch).stdout).toBe('### Bug Fixes\n\n* a fix\n');
});
