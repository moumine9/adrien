import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { BACKUP_KEEP, createBackup, listBackups, restoreBackup, verifyBackup } from '../src/backup.ts';
import { CONFIG_FILE, loadLogConfig } from '../src/config.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { git, initRepo } from './helpers/git.ts';

// Records the lock sets every backup or restore takes, and can change the log just before the first lock is taken.
const lockSpy = vi.hoisted(() => ({
  calls: [] as string[][],
  beforeLock: undefined as undefined | (() => void),
}));
vi.mock('../src/lock.ts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/lock.ts')>();
  return {
    ...real,
    withAdrLocks: (...args: Parameters<typeof real.withAdrLocks>) => {
      lockSpy.calls.push([...args[1]]);
      const hook = lockSpy.beforeLock;
      lockSpy.beforeLock = undefined;
      hook?.();
      return real.withAdrLocks(...args);
    },
  };
});

const VERSION = '0.6.0';
const POSIX = process.platform !== 'win32';

afterEach(() => {
  vi.useRealTimers();
  lockSpy.calls = [];
  lockSpy.beforeLock = undefined;
});

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
const idsOf = (root: string) => listBackups(root).map((b) => b.id);

test('createBackup copies the ADR files and the config into a named folder with a manifest', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'before-update-0.6.0', VERSION);

  expect(made.id).toMatch(/^\d{8}-\d{6}-before-update-0-6-0$/);
  expect(made.path).toBe(backupDirOf(root, made.id));
  expect(made.fileCount).toBe(2);
  expect(made.skipped).toEqual([]);
  expect(made.reason).toBe('before-update-0-6-0');

  const dir = backupDirOf(root, made.id);
  expect(readFileSync(join(dir, 'files', 'docs/adr/ADR-0001-storage.md'), 'utf8')).toBe(
    read(root, 'docs/adr/ADR-0001-storage.md'),
  );
  expect(readFileSync(join(dir, 'files', CONFIG_FILE), 'utf8')).toBe(read(root, CONFIG_FILE));
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({ adrienVersion: VERSION, reason: 'before-update-0-6-0', skipped: [] });
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

test('the backups folder is git-ignored and creating one leaves the working tree clean', () => {
  const root = logRoot();
  initRepo(root);
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(() => git(root, 'check-ignore', '-q', join('.adrien', 'backups', made.id, 'manifest.json'))).not.toThrow();
  expect(git(root, 'status', '--porcelain')).toBe('');
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

test('the ADR directory must be a sub-folder of the log that is not the backups folder', () => {
  const root = logRoot();
  const config = (adr_dir: string) => {
    writeFiles(root, { [CONFIG_FILE]: configYaml({ adr_dir }) });
    return loadLogConfig(root);
  };
  expect(() => createBackup(root, config('.'), 'x', VERSION)).toThrow('is the log root');
  expect(() => createBackup(root, config('../elsewhere'), 'x', VERSION)).toThrow('leaves the log');
  expect(() => createBackup(root, config('.adrien/adrs'), 'x', VERSION)).toThrow('holds the backups');
  expect(() => createBackup(root, config('/tmp/elsewhere'), 'x', VERSION)).toThrow('leaves the log');
  expect(readdirSync(join(root, 'docs/adr'))).toEqual(['ADR-0001-storage.md']);
});

test('an ADR directory that is a file backs up the config alone', () => {
  const root = logRoot();
  writeFiles(root, { [CONFIG_FILE]: configYaml({ adr_dir: 'docs/adr/ADR-0001-storage.md' }) });
  expect(createBackup(root, loadLogConfig(root), 'x', VERSION).fileCount).toBe(1);
});

test.skipIf(!POSIX)('a config that is a link is skipped, and the backup still has the ADRs', () => {
  const root = logRoot();
  writeFileSync(join(root, 'real-config.yaml'), configYaml());
  rmSync(join(root, CONFIG_FILE));
  symlinkSync(join(root, 'real-config.yaml'), join(root, CONFIG_FILE));
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(made.skipped).toEqual([CONFIG_FILE]);
  expect(made.fileCount).toBe(1);
});

test('an ADR directory that is itself a link is refused, never followed', () => {
  const root = logRoot();
  const outside = tmpDir();
  rmSync(join(root, 'docs/adr'), { recursive: true });
  symlinkSync(outside, join(root, 'docs/adr'));
  expect(() => createBackup(root, loadLogConfig(root), 'x', VERSION)).toThrow('is a symbolic link');
});

test('listBackups returns the newest first and reports damaged folders instead of hiding them', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const older = createBackup(root, config, 'first', VERSION);
  const newer = createBackup(root, config, 'second', VERSION);
  writeFiles(root, { '.adrien/backups/stray/readme.txt': 'not a backup' });
  writeFiles(root, { '.adrien/backups/broken/manifest.json': '{not json' });
  writeFiles(root, { '.adrien/backups/.DS_Store': 'a file, not a backup' });

  const listed = listBackups(root);
  expect(listed.slice(0, 2)).toEqual([
    { id: newer.id, status: 'ok', createdAt: expect.any(String), reason: 'second', fileCount: 2 },
    { id: older.id, status: 'ok', createdAt: expect.any(String), reason: 'first', fileCount: 2 },
  ]);
  expect(
    listed
      .slice(2)
      .map((b) => b.id)
      .sort(),
  ).toEqual(['broken', 'stray']);
  expect(listed.slice(2).every((b) => b.status === 'damaged')).toBe(true);
});

test('a manifest with a createdAt that is not a date is damaged, and other backups keep working', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const good = createBackup(root, config, 'good', VERSION);
  writeFiles(root, {
    '.adrien/backups/bad/manifest.json': JSON.stringify({
      createdAt: 'yesterday',
      adrienVersion: VERSION,
      reason: 'bad',
      files: [],
    }),
  });
  expect(listBackups(root)).toContainEqual({ id: 'bad', status: 'damaged' });
  expect(() => verifyBackup(root, 'bad')).toThrow('is damaged');
  expect(() => createBackup(root, config, 'after', VERSION)).not.toThrow();
  expect(restoreBackup(root, config, good.id, VERSION).restored).toHaveLength(2);
});

test('listBackups is empty when no backup was ever made', () => {
  expect(listBackups(logRoot())).toEqual([]);
});

test('retention keeps only the newest backups and deletes the oldest', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made: string[] = [];
  for (let i = 0; i < BACKUP_KEEP + 2; i++) made.push(createBackup(root, config, `run-${i}`, VERSION).id);

  const kept = idsOf(root);
  expect(kept).toHaveLength(BACKUP_KEEP);
  expect(kept).toEqual(made.slice(-BACKUP_KEEP).reverse());
  expect(existsSync(backupDirOf(root, made[0] as string))).toBe(false);
});

test('restoring a backup that retention would delete keeps it, along with the pre-restore snapshot', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const oldest = createBackup(root, config, 'oldest', VERSION);
  // Ten backups in all: the snapshot taken by the restore is the eleventh, and retention would delete the oldest.
  for (let i = 0; i < BACKUP_KEEP - 1; i++) createBackup(root, config, `run-${i}`, VERSION);

  const result = restoreBackup(root, config, oldest.id, VERSION);
  expect(idsOf(root)).toContain(oldest.id);
  expect(idsOf(root)).toContain(result.preRestore);
});

test('a backup that fails while copying leaves no folder behind', () => {
  const root = logRoot();
  // Not an ADR, so the ids are read fine and the failure happens inside the copy, after the folder is made.
  writeFiles(root, { 'docs/adr/notes.txt': 'unreadable' });
  const file = join(root, 'docs/adr/notes.txt');
  chmodSync(file, 0o000);
  try {
    expect(() => createBackup(root, loadLogConfig(root), 'x', VERSION)).toThrow(
      expect.objectContaining({ code: 'EACCES' }),
    );
  } finally {
    chmodSync(file, 0o644);
  }
  expect(listBackups(root)).toEqual([]);
});

test.skipIf(!POSIX)('links are never followed: a linked file or folder outside the log copies nothing', () => {
  const root = logRoot();
  const outside = tmpDir();
  writeFileSync(join(outside, 'secret.md'), 'outside the log');
  symlinkSync(join(outside, 'secret.md'), join(root, 'docs/adr/ADR-0009-link.md'));
  symlinkSync(outside, join(root, 'docs/adr/linked-dir'));

  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'links', VERSION);
  expect(made.fileCount).toBe(2);
  expect(made.skipped).toEqual(['docs/adr/ADR-0009-link.md', 'docs/adr/linked-dir']);
  expect(readdirSync(join(made.path, 'files', 'docs/adr'))).toEqual(['ADR-0001-storage.md']);
  expect(JSON.parse(readFileSync(join(made.path, 'manifest.json'), 'utf8')).skipped).toEqual(made.skipped);
  expect(verifyBackup(root, made.id)).toEqual({ changed: [], missing: [], added: [] });
});

test.skipIf(!POSIX)('a FIFO in the ADR directory is skipped rather than read', () => {
  const root = logRoot();
  execFileSync('mkfifo', [join(root, 'docs/adr/ADR-0005-pipe.md')]);
  const made = createBackup(root, loadLogConfig(root), 'fifo', VERSION);
  expect(made.skipped).toEqual(['docs/adr/ADR-0005-pipe.md']);
  expect(made.fileCount).toBe(2);
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

test('verifyBackup refuses an unknown id, an id that is not a folder name, and a damaged backup', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(() => verifyBackup(root, 'nope')).toThrow('No backup "nope"');
  expect(() => verifyBackup(root, '../docs')).toThrow('No backup "../docs"');
  writeFiles(root, { [`.adrien/backups/${made.id}/manifest.json`]: '{"files": 3}' });
  expect(() => verifyBackup(root, made.id)).toThrow(expect.objectContaining({ code: 'INVALID_INPUT' }));
  expect(() => verifyBackup(root, made.id)).toThrow('is damaged');
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
  expect(listBackups(root).find((b) => b.id === result.preRestore)).toMatchObject({ reason: 'pre-restore' });
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
  expect(listBackups(root).map((b) => b.id)).toEqual([made.id]);
});

test.each(['../escaped.md', '.git/config', '.adrien/locks/x.lock', 'docs/other/ADR-9.md', 'docs/adr/.git/config'])(
  'restoreBackup never writes %s, a path outside the ADR directory and the config',
  (path) => {
    const root = logRoot();
    const config = loadLogConfig(root);
    const made = createBackup(root, config, 'x', VERSION);
    const manifestFile = join(made.path, 'manifest.json');
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
    manifest.files.push({ path, sha256: 'whatever' });
    writeFileSync(manifestFile, JSON.stringify(manifest));

    expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow('never writes');
    expect(existsSync(join(root, '..', 'escaped.md'))).toBe(false);
  },
);

test('restore snapshots and writes under one lock that covers the backed-up ids as well as the current ones', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  rmSync(join(root, 'docs/adr/ADR-0001-storage.md'));
  lockSpy.calls = [];

  restoreBackup(root, config, made.id, VERSION);
  expect(lockSpy.calls).toEqual([['ADR-0001']]);
});

test('an ADR that appears while the locks are being taken is locked too, and the snapshot covers it', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  lockSpy.calls = [];
  lockSpy.beforeLock = () =>
    writeFiles(root, { 'docs/adr/ADR-0003-late.md': adrText({ id: 'ADR-0003', title: 'Late' }) });

  const result = restoreBackup(root, config, made.id, VERSION);
  expect(lockSpy.calls).toHaveLength(2);
  expect(lockSpy.calls[1]).toEqual(expect.arrayContaining(['ADR-0001', 'ADR-0003']));
  const snapshot = JSON.parse(readFileSync(join(backupDirOf(root, result.preRestore), 'manifest.json'), 'utf8'));
  expect(snapshot.files.map((f: { path: string }) => f.path)).toContain('docs/adr/ADR-0003-late.md');
});
