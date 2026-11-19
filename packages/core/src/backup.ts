import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { z } from 'zod';
import { CONFIG_FILE, type LogConfig, loadLogConfig } from './config.ts';
import { AdrienError } from './errors.ts';
import { withAdrLocks } from './lock.ts';
import { assertInsideLog, parseLogFiles, toPosix } from './log.ts';
import { slugify } from './slug.ts';

/** How many backups a log keeps; the oldest are deleted once a new one is made. */
export const BACKUP_KEEP = 10;

const FILES = 'files';
const MANIFEST = 'manifest.json';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface BackupSummary {
  id: string;
  status: 'ok';
  createdAt: string;
  reason: string;
  fileCount: number;
}

/** A folder under `.adrien/backups` whose manifest cannot be read. It is listed, never used, and never blocks the others. */
export interface DamagedBackup {
  id: string;
  status: 'damaged';
}

export type BackupEntry = BackupSummary | DamagedBackup;

export interface BackupCreated {
  id: string;
  path: string;
  createdAt: string;
  reason: string;
  fileCount: number;
  /** Entries of the log that are not regular files (links, FIFOs, sockets). They are never followed or copied. */
  skipped: string[];
}

export interface BackupVerification {
  changed: string[];
  missing: string[];
  added: string[];
}

export interface RestoreResult {
  id: string;
  /** The backup of the state the restore replaced, so the restore itself can be undone. */
  preRestore: string;
  restored: string[];
  /** Decision files that are not in the backup. They are left in place, never deleted. */
  leftover: string[];
}

const manifestSchema = z.object({
  createdAt: z.iso.datetime(),
  adrienVersion: z.string(),
  reason: z.string(),
  files: z.array(z.object({ path: z.string(), sha256: z.string() })),
  skipped: z.array(z.string()).default([]),
});
type Manifest = z.infer<typeof manifestSchema>;

const backupsRoot = (root: string): string => join(root, '.adrien', 'backups');
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const toFile = (root: string, rel: string): string => join(root, ...rel.split('/'));
const adrRelOf = (config: LogConfig): string => posix.normalize(toPosix(config.adr_dir));

/** Why the ADR directory cannot be backed up, or null when it can. Pure: it only looks at the config. */
export function adrDirProblem(config: LogConfig): string | null {
  const rel = adrRelOf(config);
  if (rel === '.') {
    return `The ADR directory ${config.adr_dir} is the log root, so its backups would copy themselves. Choose a sub-folder.`;
  }
  if (rel === '..' || rel.startsWith('../') || posix.isAbsolute(rel)) {
    return `The ADR directory ${config.adr_dir} leaves the log.`;
  }
  if (rel === '.adrien' || rel.startsWith('.adrien/')) {
    return `The ADR directory ${config.adr_dir} holds the backups. Choose another one.`;
  }
  return null;
}

/** The file's path inside the log, refused when it leads anywhere else (a `..` segment or a symlinked folder). */
function logPath(root: string, rel: string): string {
  const file = toFile(root, rel);
  assertInsideLog(root, file, rel);
  return file;
}

/** A restore writes only the ADR directory and the config, never `.adrien/`, `.git/` or anything else. */
function restoreTarget(root: string, config: LogConfig, rel: string): string {
  const inAdrDir =
    rel.startsWith(`${adrRelOf(config)}/`) && !rel.split('/').some((part) => part === '.adrien' || part === '.git');
  if (rel !== CONFIG_FILE && !inAdrDir) {
    throw new AdrienError(
      'INVALID_INPUT',
      `The backup lists ${rel}, which a restore never writes (only the ADR directory and ${CONFIG_FILE}).`,
    );
  }
  return logPath(root, rel);
}

/** Collects regular files only: `lstat` never follows a link, and a FIFO or socket is never opened. */
function walk(dir: string, rel: string, files: string[], skipped: string[]): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const childRel = posix.join(rel, name);
    const st = lstatSync(full);
    if (st.isDirectory()) walk(full, childRel, files, skipped);
    else if (st.isFile()) files.push(childRel);
    else skipped.push(childRel);
  }
}

interface LogFiles {
  files: string[];
  skipped: string[];
}

/** Every entry a backup holds, relative to the log: the ADR directory recursively, and the config. */
function logFiles(root: string, config: LogConfig): LogFiles {
  const problem = adrDirProblem(config);
  if (problem) throw new AdrienError('INVALID_INPUT', problem);
  const adrRel = adrRelOf(config);
  const adrDir = join(root, adrRel);
  const link = lstatSync(adrDir, { throwIfNoEntry: false });
  if (link?.isSymbolicLink()) {
    throw new AdrienError(
      'INVALID_INPUT',
      `The ADR directory ${config.adr_dir} is a symbolic link. Backups never follow links.`,
    );
  }
  const files: string[] = [];
  const skipped: string[] = [];
  if (link?.isDirectory()) walk(adrDir, adrRel, files, skipped);
  const configEntry = lstatSync(join(root, CONFIG_FILE), { throwIfNoEntry: false });
  if (configEntry?.isFile()) files.push(CONFIG_FILE);
  else if (configEntry) skipped.push(CONFIG_FILE);
  return { files: files.sort(), skipped: skipped.sort() };
}

/**
 * The ids of the ADRs as they are now. It reads only the regular files `logFiles` collected: reading a FIFO named like an
 * ADR would block forever, so the log's own reader is not used here.
 */
function currentIds(root: string, config: LogConfig): string[] {
  const texts = logFiles(root, config)
    .files.filter((path) => path.endsWith('.md'))
    .map((path) => ({ path, text: readFileSync(toFile(root, path), 'utf8') }));
  return parseLogFiles(texts, config).adrs.map((a) => a.meta.id);
}

/** `YYYYMMDD-HHMMSS` in UTC: the start of every backup's folder name. */
const stampOf = (at: Date): string => at.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');

/** Creates the backup folder under a free name: a second backup in the same second gets `-2`, `-3`, and so on. */
function claimFolder(root: string, base: string): string {
  mkdirSync(backupsRoot(root), { recursive: true });
  let id = base;
  for (let n = 2; existsSync(join(backupsRoot(root), id)); n++) id = `${base}-${n}`;
  mkdirSync(join(backupsRoot(root), id));
  return id;
}

/** The manifest of a backup folder, or null when the folder holds no readable, valid one. */
function loadManifest(folder: string): Manifest | null {
  try {
    return manifestSchema.parse(JSON.parse(readFileSync(join(folder, MANIFEST), 'utf8')));
  } catch {
    return null;
  }
}

/** The backup with this id. An unknown id is refused; one whose manifest is unreadable is refused as damaged. */
function openBackup(root: string, id: string): { dir: string; manifest: Manifest } {
  const dir = join(backupsRoot(root), id);
  if (!ID.test(id) || !existsSync(dir)) {
    throw new AdrienError('INVALID_INPUT', `No backup "${id}". Run \`adrien backup list\` to see the backups.`);
  }
  const manifest = loadManifest(dir);
  if (!manifest) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Backup "${id}" is damaged: its manifest cannot be read. Nothing was changed.`,
    );
  }
  return { dir, manifest };
}

const okBackups = (root: string): BackupSummary[] =>
  listBackups(root).filter((b): b is BackupSummary => b.status === 'ok');

/** Deletes the oldest backups beyond `BACKUP_KEEP`, except the protected ones. Damaged folders are left alone. */
function prune(root: string, protect: string[]): void {
  for (const old of okBackups(root).slice(BACKUP_KEEP)) {
    if (!protect.includes(old.id)) rmSync(join(backupsRoot(root), old.id), { recursive: true, force: true });
  }
}

/**
 * Copies the log into a new backup folder. It takes no lock itself: callers hold the locks of the whole log (see
 * `underLocks`). If the copy fails midway, the new folder is removed, so no half-made backup is ever listed.
 */
function snapshot(
  root: string,
  config: LogConfig,
  reason: string,
  adrienVersion: string,
  protect: string[],
): BackupCreated {
  const { files, skipped } = logFiles(root, config);
  // Strictly later than the newest backup, so the newest-first order never depends on a tie.
  const newest = okBackups(root)[0];
  const createdAt = new Date(Math.max(Date.now(), newest ? Date.parse(newest.createdAt) + 1 : 0));
  const slug = slugify(reason) || 'backup';
  const id = claimFolder(root, `${stampOf(createdAt)}-${slug}`);
  const dir = join(backupsRoot(root), id);
  try {
    const entries = files.map((rel) => {
      const bytes = readFileSync(toFile(root, rel));
      const dest = join(dir, FILES, ...rel.split('/'));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      return { path: rel, sha256: sha256(bytes) };
    });
    const manifest: Manifest = {
      createdAt: createdAt.toISOString(),
      adrienVersion,
      reason: slug,
      files: entries,
      skipped,
    };
    const tmp = join(dir, `${MANIFEST}.tmp`);
    writeFileSync(tmp, `${JSON.stringify(manifest, null, 2)}\n`);
    renameSync(tmp, join(dir, MANIFEST));
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  prune(root, [id, ...protect]);
  return { id, path: dir, createdAt: createdAt.toISOString(), reason: slug, fileCount: files.length, skipped };
}

type Attempt<T> = { unlocked: string[] } | { value: T };

/**
 * Runs `fn` while holding the lock of every ADR in the log, plus `extra` ids. An ADR that appears while the locks are
 * being taken is locked too, and the attempt is repeated, so `fn` always runs with the whole working set locked.
 */
function underLocks<T>(root: string, config: LogConfig, extra: string[], fn: () => T): T {
  let ids = [...new Set([...currentIds(root, config), ...extra])];
  for (;;) {
    const outcome = withAdrLocks<Attempt<T>>(root, ids, () => {
      const unlocked = [...new Set(currentIds(root, config).filter((id) => !ids.includes(id)))];
      return unlocked.length > 0 ? { unlocked } : { value: fn() };
    });
    if ('value' in outcome) return outcome.value;
    ids = [...ids, ...outcome.unlocked];
  }
}

/**
 * Copies the ADR directory (every regular file, recursively) and the config into a new folder under `.adrien/backups`,
 * with a manifest of the SHA-256 of each file. Links and other non-files are listed as `skipped`, never followed.
 * The copy holds the lock of every ADR, so no write is half-copied. Only the newest `BACKUP_KEEP` are kept.
 */
export function createBackup(root: string, config: LogConfig, reason: string, adrienVersion: string): BackupCreated {
  return underLocks(root, config, [], () => snapshot(root, config, reason, adrienVersion, []));
}

/** The backups of a log, newest first; folders whose manifest cannot be read come last, marked damaged. */
export function listBackups(root: string): BackupEntry[] {
  const dir = backupsRoot(root);
  if (!existsSync(dir)) return [];
  const found: BackupEntry[] = [];
  for (const id of readdirSync(dir)) {
    if (!lstatSync(join(dir, id)).isDirectory()) continue;
    const manifest = loadManifest(join(dir, id));
    found.push(
      manifest
        ? { id, status: 'ok', createdAt: manifest.createdAt, reason: manifest.reason, fileCount: manifest.files.length }
        : { id, status: 'damaged' },
    );
  }
  const key = (b: BackupEntry) => (b.status === 'ok' ? b.createdAt : '');
  return found.sort((a, b) => key(b).localeCompare(key(a)) || a.id.localeCompare(b.id));
}

/** Compares the log's decision files with a backup: changed (content differs), missing (gone) and added (not in it). */
export function verifyBackup(root: string, id: string): BackupVerification {
  const { manifest } = openBackup(root, id);
  const current = new Set(logFiles(root, loadLogConfig(root)).files);
  const listed = new Map(manifest.files.map((f) => [f.path, f.sha256]));
  const changed: string[] = [];
  const missing: string[] = [];
  const added: string[] = [];
  for (const [path, hash] of listed) {
    if (!current.has(path)) missing.push(path);
    else if (sha256(readFileSync(toFile(root, path))) !== hash) changed.push(path);
  }
  for (const path of current) if (!listed.has(path)) added.push(path);
  return { changed, missing, added };
}

/**
 * Puts the decision files of a backup back. Every file is checked against its manifest before anything is written.
 * The state being replaced is backed up (`pre-restore`) and the restore writes under the same locks as that backup,
 * so nothing can change between the snapshot and the writes. Files the backup does not hold are reported as `leftover`
 * and never deleted.
 */
export function restoreBackup(root: string, config: LogConfig, id: string, adrienVersion: string): RestoreResult {
  const { dir, manifest } = openBackup(root, id);
  const staged = manifest.files.map(({ path, sha256: expected }) => {
    const target = restoreTarget(root, config, path);
    const bytes = readFileSync(join(dir, FILES, ...path.split('/')));
    if (sha256(bytes) !== expected) {
      throw new AdrienError(
        'INVALID_INPUT',
        `Backup ${id} is damaged: ${path} no longer matches its manifest. Nothing was restored.`,
      );
    }
    return { path, target, bytes };
  });
  const backedIds = parseLogFiles(
    staged.map((s) => ({ path: s.path, text: s.bytes.toString('utf8') })),
    config,
  ).adrs.map((a) => a.meta.id);
  return underLocks(root, config, backedIds, () => {
    const snap = snapshot(root, config, 'pre-restore', adrienVersion, [id]);
    for (const s of staged) {
      mkdirSync(dirname(s.target), { recursive: true });
      writeFileSync(s.target, s.bytes);
    }
    const listed = new Set(manifest.files.map((f) => f.path));
    return {
      id,
      preRestore: snap.id,
      restored: staged.map((s) => s.path),
      leftover: logFiles(root, config).files.filter((p) => !listed.has(p)),
    };
  });
}
