import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach } from 'vitest';
import { BACKUP_KEEP, createBackup, findBackupRoot, listBackups, restoreBackup, verifyBackup } from '../src/backup.ts';
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

test.skipIf(!POSIX)('an ADR directory that is itself a link is skipped, never followed', () => {
  const root = logRoot();
  const outside = tmpDir();
  writeFileSync(join(outside, 'ADR-0009-outside.md'), adrText({ id: 'ADR-0009', title: 'Outside' }));
  rmSync(join(root, 'docs/adr'), { recursive: true });
  symlinkSync(outside, join(root, 'docs/adr'));
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(made.skipped).toEqual(['docs/adr']);
  expect(made.fileCount).toBe(1);
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

// File modes are not enforced on Windows, and root reads anything: the copy only fails where chmod 000 is honoured.
test.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
  'a backup that fails while copying leaves no folder behind',
  () => {
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
  },
);

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

    // A path that climbs or reaches .git is damaged before any restore logic; a plain path outside the ADR dir is refused.
    expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow(/damaged|never writes/);
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

/** Adds an entry to a backup's manifest, with its bytes in files/: the shape of a backup a restore would write through a link. */
function addEntry(backupPath: string, rel: string, text: string): void {
  const dest = join(backupPath, 'files', ...rel.split('/'));
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, text);
  const manifestFile = join(backupPath, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.files.push({ path: rel, sha256: createHash('sha256').update(text).digest('hex') });
  writeFileSync(manifestFile, JSON.stringify(manifest));
}

test.skipIf(!POSIX)('restore refuses a path that goes through a link into .git, and writes nothing', () => {
  const root = logRoot();
  mkdirSync(join(root, '.git', 'hooks'), { recursive: true });
  writeFileSync(join(root, '.git', 'config'), 'original config');
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  addEntry(made.path, 'docs/adr/sub/hooks/pre-commit', 'evil hook');
  symlinkSync('../../.git', join(root, 'docs/adr/sub'));

  expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow('through a link');
  expect(existsSync(join(root, '.git/hooks/pre-commit'))).toBe(false);
  expect(read(root, '.git/config')).toBe('original config');
});

test.skipIf(!POSIX)('restore refuses an ADR file that is a link to a file outside the log', () => {
  const root = logRoot();
  mkdirSync(join(root, '.git'));
  writeFileSync(join(root, '.git/config'), 'original config');
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  rmSync(join(root, 'docs/adr/ADR-0001-storage.md'));
  symlinkSync('../../.git/config', join(root, 'docs/adr/ADR-0001-storage.md'));

  expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow('through a link');
  expect(read(root, '.git/config')).toBe('original config');
});

test.skipIf(!POSIX)('restore refuses an adrien.config.yaml that is a link, and changes no decision file', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  writeFileSync(join(root, 'real-config.yaml'), 'changed elsewhere');
  writeFileSync(join(root, 'docs/adr/ADR-0001-storage.md'), 'edited');
  rmSync(join(root, CONFIG_FILE));
  symlinkSync('real-config.yaml', join(root, CONFIG_FILE));

  expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow('through a link');
  expect(read(root, 'real-config.yaml')).toBe('changed elsewhere');
  expect(read(root, 'docs/adr/ADR-0001-storage.md')).toBe('edited');
});

test.skipIf(!POSIX)('create copies nothing through a linked parent of the ADR directory', () => {
  const root = logRoot();
  const outside = tmpDir();
  mkdirSync(join(outside, 'adr'), { recursive: true });
  writeFileSync(join(outside, 'adr', 'ADR-0009-outside.md'), adrText({ id: 'ADR-0009', title: 'Outside' }));
  rmSync(join(root, 'docs'), { recursive: true });
  symlinkSync(outside, join(root, 'docs'));

  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  expect(made.skipped).toEqual(['docs/adr']);
  const manifest = JSON.parse(readFileSync(join(made.path, 'manifest.json'), 'utf8'));
  expect(manifest.files.map((f: { path: string }) => f.path)).toEqual([CONFIG_FILE]);
});

test.skipIf(!POSIX)('a backups folder that is a link is refused before anything is written', () => {
  const root = logRoot();
  const outside = tmpDir();
  symlinkSync(outside, join(root, '.adrien'));
  expect(() => createBackup(root, loadLogConfig(root), 'x', VERSION)).toThrow('through a link');
  expect(readdirSync(outside)).toEqual([]);
});

test('the wait for an ADR lock honours ADRIEN_LOCK_TIMEOUT_MS', () => {
  const root = logRoot();
  mkdirSync(join(root, '.adrien', 'locks'), { recursive: true });
  // A live owner (this process) holds the lock of ADR-0001: the backup must give up after the configured wait.
  writeFileSync(
    join(root, '.adrien', 'locks', 'adr-0001.lock'),
    JSON.stringify({ pid: process.pid, host: hostname(), at: Date.now() }),
  );
  const started = Date.now();
  expect(() => createBackup(root, loadLogConfig(root), 'x', VERSION, { ADRIEN_LOCK_TIMEOUT_MS: '50' })).toThrow(
    expect.objectContaining({ code: 'ADR_LOCKED' }),
  );
  expect(Date.now() - started).toBeLessThan(5000);
});

/** Rewrites a backup's manifest directly, the way a crafted or tampered backup would look. */
function rewriteManifest(backupPath: string, change: (manifest: { files: unknown[] }) => void): void {
  const manifestFile = join(backupPath, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  change(manifest);
  writeFileSync(manifestFile, JSON.stringify(manifest));
}

test('restore writes nothing for a crafted manifest that climbs out of the ADR directory', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  addEntry(made.path, 'docs/adr/../../pwned.txt', 'pwned');
  addEntry(made.path, 'docs/adr/../../.GIT/hooks/pre-commit', 'pwned hook');

  expect(listBackups(root)).toContainEqual({ id: made.id, status: 'damaged' });
  expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow('damaged');
  expect(existsSync(join(root, 'pwned.txt'))).toBe(false);
  expect(existsSync(join(root, '.GIT'))).toBe(false);
});

test.each([
  ['docs/adr/.GIT/config', 'a reserved name in another case'],
  ['docs/adr/x\\..\\y.md', 'a backslash'],
  ['/etc/passwd', 'an absolute path'],
  ['C:/x.md', 'a drive letter'],
  ['docs//adr/x.md', 'an empty segment'],
  ['./docs/adr/x.md', 'a `.` segment'],
  ['docs/adr/x\u0000.md', 'a NUL byte'],
  ['', 'an empty path'],
])('a manifest listing %j (%s) is damaged and restores nothing', (path) => {
  const root = logRoot();
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'x', VERSION);
  rewriteManifest(made.path, (m) => m.files.push({ path, sha256: 'whatever' }));

  expect(listBackups(root)).toContainEqual({ id: made.id, status: 'damaged' });
  expect(() => restoreBackup(root, config, made.id, VERSION)).toThrow('damaged');
  expect(read(root, 'docs/adr/ADR-0001-storage.md')).toBe(adrText({ id: 'ADR-0001', title: 'Storage' }));
});

test('a restore validates the backed-up files against the backed-up ADR directory, even when the live config moved it', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'before', VERSION);
  // The live config now points elsewhere; the backup still holds docs/adr and the config that says so.
  writeFileSync(join(root, CONFIG_FILE), configYaml({ adr_dir: 'decisions' }));
  rmSync(join(root, 'docs'), { recursive: true });

  const result = restoreBackup(root, loadLogConfig(root), made.id, VERSION);

  expect(read(root, CONFIG_FILE)).toBe(configYaml());
  expect(existsSync(join(root, 'docs/adr/ADR-0001-storage.md'))).toBe(true);
  expect(result.restored.sort()).toEqual([CONFIG_FILE, 'docs/adr/ADR-0001-storage.md']);
});

test('a restore with no live config reads the ADR directory from the backed-up config', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'before', VERSION);
  rmSync(join(root, CONFIG_FILE));
  rmSync(join(root, 'docs'), { recursive: true });

  const result = restoreBackup(root, null, made.id, VERSION);

  expect(read(root, CONFIG_FILE)).toBe(configYaml());
  expect(existsSync(join(root, 'docs/adr/ADR-0001-storage.md'))).toBe(true);
  expect(result.leftover).toEqual([]);
  expect(listBackups(root).some((b) => b.id === result.preRestore)).toBe(true);
});

test('a restore with no live config and no config in the backup is refused', () => {
  const root = logRoot();
  const config = loadLogConfig(root);
  rmSync(join(root, CONFIG_FILE));
  const made = createBackup(root, config, 'noconfig', VERSION);
  expect(() => restoreBackup(root, null, made.id, VERSION)).toThrow(/usable configuration/i);
});

test('a backed-up config whose ADR directory cannot be used is refused before any write', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  const evil = configYaml({ adr_dir: '.adrien/backups' });
  const bytes = Buffer.from(evil);
  const file = join(made.path, 'files', CONFIG_FILE);
  writeFileSync(file, bytes);
  const manifestFile = join(made.path, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  for (const f of manifest.files) {
    if (f.path === CONFIG_FILE) f.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  writeFileSync(manifestFile, JSON.stringify(manifest));
  expect(() => restoreBackup(root, loadLogConfig(root), made.id, VERSION)).toThrow(/holds the backups/);
});

test('a nested checkout or a name the manifest cannot hold is skipped, and the backup stays readable and restorable', () => {
  const root = logRoot();
  writeFiles(root, { 'docs/adr/sub/.git/config': 'nested', 'docs/adr/sub/ADR-0002-x.md': 'x' });
  const made = createBackup(root, loadLogConfig(root), 'nested', VERSION);
  expect(made.skipped).toContain('docs/adr/sub/.git');
  expect(listBackups(root).find((b) => b.id === made.id)).toMatchObject({ status: 'ok' });
  expect(() => restoreBackup(root, loadLogConfig(root), made.id, VERSION)).not.toThrow();
});

test.skipIf(!POSIX)('a file whose name holds a backslash is skipped on POSIX instead of poisoning the backup', () => {
  const root = logRoot();
  writeFileSync(join(root, 'docs/adr/odd\\name.md'), 'x');
  const made = createBackup(root, loadLogConfig(root), 'odd', VERSION);
  expect(made.skipped).toContain('docs/adr/odd\\name.md');
  expect(made.fileCount).toBe(2);
  expect(listBackups(root).find((b) => b.id === made.id)).toMatchObject({ status: 'ok' });
});

test('findBackupRoot takes the folder --log names, never a remote, else the nearest folder holding backups', () => {
  const root = logRoot();
  createBackup(root, loadLogConfig(root), 'x', VERSION);
  mkdirSync(join(root, 'docs', 'deep'), { recursive: true });
  expect(findBackupRoot(join(root, 'docs', 'deep'))).toBe(root);
  expect(findBackupRoot(tmpDir(), root)).toBe(root);
  expect(findBackupRoot(root, 'https://example.com/acme/log.git')).toBeNull();
  expect(findBackupRoot(tmpDir())).toBeNull();
});

test('a backed-up config that no longer matches its manifest is damaged, and nothing is restored', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  writeFileSync(join(made.path, 'files', CONFIG_FILE), 'tampered');
  writeFileSync(join(root, 'docs/adr/ADR-0001-storage.md'), 'changed since');
  expect(() => restoreBackup(root, loadLogConfig(root), made.id, VERSION)).toThrow(/damaged.*Nothing was restored/);
  expect(read(root, 'docs/adr/ADR-0001-storage.md')).toBe('changed since');
});

test('a backed-up config that cannot be read falls back to the live one for where the ADRs go', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  const bytes = Buffer.from('product: [broken');
  writeFileSync(join(made.path, 'files', CONFIG_FILE), bytes);
  const manifestFile = join(made.path, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  for (const f of manifest.files) {
    if (f.path === CONFIG_FILE) f.sha256 = createHash('sha256').update(bytes).digest('hex');
  }
  writeFileSync(manifestFile, JSON.stringify(manifest));
  writeFileSync(join(root, 'docs/adr/ADR-0001-storage.md'), 'changed since');
  restoreBackup(root, loadLogConfig(root), made.id, VERSION);
  expect(read(root, 'docs/adr/ADR-0001-storage.md')).toContain('Storage');
});

test('an ADR directory with a name a backup cannot hold is refused', () => {
  const root = logRoot();
  const config = { ...loadLogConfig(root), adr_dir: 'docs/.git/adr' };
  expect(() => createBackup(root, config, 'x', VERSION)).toThrow(/a name a backup cannot hold/);
});

test('the pre-restore backup holds every existing file the restore overwrites, even under another ADR directory', () => {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml({ adr_dir: 'docs' }), 'docs/guide.md': 'old guide' });
  const made = createBackup(root, loadLogConfig(root), 'before', VERSION);
  writeFileSync(join(root, CONFIG_FILE), configYaml({ adr_dir: 'docs/adr' }));
  writeFileSync(join(root, 'docs/guide.md'), 'edited since');

  const result = restoreBackup(root, loadLogConfig(root), made.id, VERSION);

  expect(read(root, 'docs/guide.md')).toBe('old guide');
  const pre = JSON.parse(readFileSync(join(backupDirOf(root, result.preRestore), 'manifest.json'), 'utf8'));
  expect(pre.files.map((f: { path: string }) => f.path)).toContain('docs/guide.md');
  expect(readFileSync(join(backupDirOf(root, result.preRestore), 'files', 'docs', 'guide.md'), 'utf8')).toBe(
    'edited since',
  );
  // The undo works: restoring the pre-restore backup brings the edit back.
  // Verifying the pre-restore backup looks in every directory it covers, not only the live config's.
  expect(verifyBackup(root, result.preRestore)).toMatchObject({ missing: [] });
  const undone = restoreBackup(root, null, result.preRestore, VERSION);
  expect(read(root, 'docs/guide.md')).toBe('edited since');
  // Undoing the undo is possible too: its snapshot holds what the undo overwrote.
  expect(readFileSync(join(backupDirOf(root, undone.preRestore), 'files', 'docs', 'guide.md'), 'utf8')).toBe(
    'old guide',
  );
});

test('an ADR directory written with a trailing slash backs up and restores', () => {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml({ adr_dir: 'docs/adr/' }),
    'docs/adr/ADR-0001-storage.md': adrText({ id: 'ADR-0001', title: 'Storage' }),
  });
  const config = loadLogConfig(root);
  const made = createBackup(root, config, 'slash', VERSION);
  writeFileSync(join(root, 'docs/adr/ADR-0001-storage.md'), 'damaged');
  restoreBackup(root, config, made.id, VERSION);
  expect(read(root, 'docs/adr/ADR-0001-storage.md')).toContain('Storage');
});

test('a manifest that lists an unusable extra ADR directory is refused before any write', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  const manifestFile = join(made.path, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  manifest.adrDirs = ['.adrien/backups'];
  writeFileSync(manifestFile, JSON.stringify(manifest));
  expect(() => restoreBackup(root, loadLogConfig(root), made.id, VERSION)).toThrow(/holds the backups/);
});

test('verifyBackup works when the live config is missing or unreadable, and says it is gone', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  rmSync(join(root, CONFIG_FILE));
  expect(verifyBackup(root, made.id)).toEqual({ changed: [], missing: [CONFIG_FILE], added: [] });
  writeFileSync(join(root, CONFIG_FILE), 'product: [broken');
  expect(verifyBackup(root, made.id)).toEqual({ changed: [CONFIG_FILE], missing: [], added: [] });
});

test('verify ignores the backup copy of the config while the live one is fine, and a lost copy is reported as damaged', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  rmSync(join(made.path, 'files', CONFIG_FILE));
  expect(verifyBackup(root, made.id)).toEqual({ changed: [], missing: [], added: [] });
  expect(() => restoreBackup(root, loadLogConfig(root), made.id, VERSION)).toThrow(/damaged.*cannot be read/);
  rmSync(join(root, CONFIG_FILE));
  expect(() => verifyBackup(root, made.id)).toThrow(/damaged.*cannot be read/);
});

test('a restore works when the live config names an ADR directory that cannot be backed up, and keeps its bytes', () => {
  const root = logRoot();
  const made = createBackup(root, loadLogConfig(root), 'x', VERSION);
  writeFileSync(join(root, CONFIG_FILE), configYaml({ adr_dir: '.' }));
  const result = restoreBackup(root, loadLogConfig(root), made.id, VERSION);
  expect(read(root, CONFIG_FILE)).toBe(configYaml());
  expect(readFileSync(join(backupDirOf(root, result.preRestore), 'files', CONFIG_FILE), 'utf8')).toBe(
    configYaml({ adr_dir: '.' }),
  );
});
