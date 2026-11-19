import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { BACKUP_KEEP, createBackup, listBackups, restoreBackup, verifyBackup } from '../src/backup.ts';
import { CONFIG_FILE, loadLogConfig } from '../src/config.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';

const VERSION = '0.6.0';

afterEach(() => vi.useRealTimers());

function logRoot(): string {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/ADR-0001-storage.md': adrText({ id: 'ADR-0001', title: 'Storage' }),
  });
  return root;
}

const backupDirOf = (root: string, id: string) => join(root, '.adrien', 'backups', id);
const read = (root: string, rel: string) => readFileSync(join(root, rel), 'utf8');

test('createBackup copies the ADR files and the config into a named folder with a manifest', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'before-update-0.6.0', VERSION);

  expect(made.id).toMatch(/^\d{8}-\d{6}-before-update-0-6-0$/);
  expect(made.path).toBe(backupDirOf(root, made.id));
  expect(made.fileCount).toBe(2);
  expect(made.reason).toBe('before-update-0-6-0');

  const dir = backupDirOf(root, made.id);
  expect(readFileSync(join(dir, 'files', 'docs/adr/ADR-0001-storage.md'), 'utf8')).toBe(
    read(root, 'docs/adr/ADR-0001-storage.md'),
  );
  expect(readFileSync(join(dir, 'files', CONFIG_FILE), 'utf8')).toBe(read(root, CONFIG_FILE));
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({ adrienVersion: VERSION, reason: 'before-update-0-6-0' });
  expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(manifest.files.map((f: { path: string }) => f.path).sort()).toEqual([
    'adrien.config.yaml',
    'docs/adr/ADR-0001-storage.md',
  ]);
});

test('an empty reason is named backup, and two backups in the same second never share a folder', () => {
  vi.setSystemTime(new Date('2026-01-02T03:04:05Z'));
  const root = logRoot();
  const config = loadLogConfig(root);
  const first = createBackup(root, config, '  ', VERSION);
  const second = createBackup(root, config, '  ', VERSION);
  expect(first.reason).toBe('backup');
  expect(first.id).toBe('20260102-030405-backup');
  expect(second.id).toBe('20260102-030405-backup-2');
  expect(existsSync(join(second.path, 'manifest.json'))).toBe(true);
});

test('ADRs in sub-folders of the ADR directory are backed up too', () => {
  const root = logRoot();
  writeFiles(root, { 'docs/adr/team/ADR-0002-nested.md': adrText({ id: 'ADR-0002', title: 'Nested' }) });
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(made.fileCount).toBe(3);
  expect(existsSync(join(made.path, 'files', 'docs/adr/team/ADR-0002-nested.md'))).toBe(true);
});

test('a log with no ADR folder yet backs up its config alone', () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml() });
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(made.fileCount).toBe(1);
});

test('backups never sit inside the ADR directory, and an ADR directory that holds the backups is refused', () => {
  const root = logRoot();
  createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(readdirSync(join(root, 'docs/adr'))).toEqual(['ADR-0001-storage.md']);

  writeFiles(root, { [CONFIG_FILE]: configYaml({ adr_dir: '.' }) });
  expect(() => createBackup(root, loadLogConfig(root), 'x', VERSION)).toThrow(
    expect.objectContaining({ code: 'INVALID_INPUT' }),
  );
});

test('an ADR directory outside the log is refused', () => {
  const root = logRoot();
  writeFiles(root, { [CONFIG_FILE]: configYaml({ adr_dir: '../elsewhere' }) });
  expect(() => createBackup(root, loadLogConfig(root), 'x', VERSION)).toThrow('leaves the log');
});

test('listBackups returns the newest first and skips folders without a readable manifest', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const older = createBackup(root, config, 'first', VERSION);
  const newer = createBackup(root, config, 'second', VERSION);
  writeFiles(root, { '.adrien/backups/stray/readme.txt': 'not a backup' });
  writeFiles(root, { '.adrien/backups/broken/manifest.json': '{not json' });

  const listed = listBackups(root);
  expect(listed.map((b) => b.id)).toEqual([newer.id, older.id]);
  expect(listed[0]).toEqual({ id: newer.id, createdAt: expect.any(String), reason: 'second', fileCount: 2 });
});

test('listBackups is empty when no backup was ever made', () => {
  expect(listBackups(logRoot())).toEqual([]);
});

test('retention keeps only the newest backups and deletes the oldest', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made: string[] = [];
  for (let i = 0; i < BACKUP_KEEP + 2; i++) made.push(createBackup(root, config, `run-${i}`, VERSION).id);

  const kept = listBackups(root).map((b) => b.id);
  expect(kept).toHaveLength(BACKUP_KEEP);
  expect(kept).toEqual(made.slice(-BACKUP_KEEP).reverse());
  expect(existsSync(backupDirOf(root, made[0] as string))).toBe(false);
});

test('verifyBackup reports nothing when the files match the backup', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(verifyBackup(root, made.id)).toEqual({ changed: [], missing: [], added: [] });
});

test('verifyBackup lists changed, missing and added decision files', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  writeFileSync(join(root, 'docs/adr/ADR-0001-storage.md'), 'edited');
  writeFiles(root, { 'docs/adr/ADR-0002-new.md': adrText({ id: 'ADR-0002', title: 'New' }) });
  expect(verifyBackup(root, made.id)).toEqual({
    changed: ['docs/adr/ADR-0001-storage.md'],
    missing: [],
    added: ['docs/adr/ADR-0002-new.md'],
  });

  rmSync(join(root, 'docs/adr/ADR-0001-storage.md'));
  expect(verifyBackup(root, made.id).missing).toEqual(['docs/adr/ADR-0001-storage.md']);
});

test('verifyBackup refuses an unknown id, an id that is not a folder name, and a broken manifest', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(() => verifyBackup(root, 'nope')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  expect(() => verifyBackup(root, '../docs')).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  writeFiles(root, { [`.adrien/backups/${made.id}/manifest.json`]: '{"files": 3}' });
  expect(() => verifyBackup(root, made.id)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
});

test('restoreBackup takes a pre-restore backup, restores changed and missing files, and leaves extra files alone', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'before-update-0.5.0', VERSION);
  const original = read(root, 'docs/adr/ADR-0001-storage.md');
  writeFileSync(join(root, 'docs/adr/ADR-0001-storage.md'), 'damaged by a bad upgrade');
  rmSync(join(root, CONFIG_FILE));
  writeFiles(root, { 'docs/adr/ADR-0002-extra.md': adrText({ id: 'ADR-0002', title: 'Extra' }) });

  const result = restoreBackup(root, config, made.id, VERSION);

  expect(read(root, 'docs/adr/ADR-0001-storage.md')).toBe(original);
  expect(read(root, CONFIG_FILE)).toBe(configYaml());
  expect(existsSync(join(root, 'docs/adr/ADR-0002-extra.md'))).toBe(true);
  expect(result.restored.sort()).toEqual(['adrien.config.yaml', 'docs/adr/ADR-0001-storage.md']);
  expect(result.leftover).toEqual(['docs/adr/ADR-0002-extra.md']);
  expect(listBackups(root).find((b) => b.id === result.preRestore)?.reason).toBe('pre-restore');
  // The pre-restore backup holds the damaged state: the restored file differs from it, and the restored config is new.
  expect(verifyBackup(root, result.preRestore)).toEqual({
    changed: ['docs/adr/ADR-0001-storage.md'],
    missing: [],
    added: [CONFIG_FILE],
  });
});

test('restoreBackup refuses an unknown id and writes nothing', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  expect(() => restoreBackup(root, config, 'missing', VERSION)).toThrow(
    expect.objectContaining({ code: 'INVALID_INPUT' }),
  );
  expect(listBackups(root)).toEqual([]);
});

test('restoreBackup refuses a backup whose files no longer match their manifest, before changing anything', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  writeFileSync(join(made.path, 'files', 'docs/adr/ADR-0001-storage.md'), 'tampered');
  writeFileSync(join(root, 'docs/adr/ADR-0001-storage.md'), 'current');

  expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow('damaged');
  expect(read(root, 'docs/adr/ADR-0001-storage.md')).toBe('current');
  expect(listBackups(root).map((b) => b.reason)).toEqual(['x']);
});

test('restoreBackup refuses a manifest path that leads outside the log', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  const manifestFile = join(made.path, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.files.push({ path: '../escaped.md', sha256: 'whatever' });
  writeFileSync(manifestFile, JSON.stringify(manifest));

  expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow('resolves outside the log');
  expect(existsSync(join(root, '..', 'escaped.md'))).toBe(false);
});
