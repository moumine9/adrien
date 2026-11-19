import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { z } from 'zod';
import { CONFIG_FILE, type LogConfig, loadLogConfig } from './config.ts';
import { AdrienError } from './errors.ts';
import { withAdrLocks } from './lock.ts';
import { assertInsideLog, parseLogFiles, readWorkingLog, toPosix } from './log.ts';
import { isInside } from './paths.ts';
import { slugify } from './slug.ts';

/** How many backups a log keeps; the oldest are deleted once a new one is made. */
export const BACKUP_KEEP = 10;

const FILES = 'files';
const MANIFEST = 'manifest.json';
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface BackupSummary {
  id: string;
  createdAt: string;
  reason: string;
  fileCount: number;
}

export interface BackupCreated extends BackupSummary {
  path: string;
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
  createdAt: z.string(),
  adrienVersion: z.string(),
  reason: z.string(),
  files: z.array(z.object({ path: z.string(), sha256: z.string() })),
});
type Manifest = z.infer<typeof manifestSchema>;

const backupsRoot = (root: string): string => join(root, '.adrien', 'backups');
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const toFile = (root: string, rel: string): string => join(root, ...rel.split('/'));

/** The file's path inside the log, refused when it leads anywhere else (a `..` segment or a symlinked folder). */
function logPath(root: string, rel: string): string {
  const file = toFile(root, rel);
  assertInsideLog(root, file, rel);
  return file;
}

function walk(dir: string, rel: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const childRel = posix.join(rel, entry.name);
    if (entry.isDirectory()) walk(join(dir, entry.name), childRel, out);
    else out.push(childRel);
  }
}

/** Every file a backup holds, as paths relative to the log: the ADR directory recursively, and the config. */
function logFiles(root: string, config: LogConfig): string[] {
  const adrRel = posix.normalize(toPosix(config.adr_dir));
  const adrDir = join(root, adrRel);
  if (!isInside(adrDir, root)) throw new AdrienError('INVALID_INPUT', `The ADR directory ${config.adr_dir} leaves the log.`);
  if (isInside(backupsRoot(root), adrDir)) {
    throw new AdrienError('INVALID_INPUT', `The ADR directory ${config.adr_dir} holds the backups. Choose another one.`);
  }
  const out: string[] = [];
  if (existsSync(adrDir)) walk(adrDir, adrRel, out);
  if (existsSync(join(root, CONFIG_FILE))) out.push(CONFIG_FILE);
  return out.sort();
}

const currentIds = (root: string, config: LogConfig): string[] =>
  readWorkingLog(root, config).adrs.map((a) => a.meta.id);

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

/** The manifest of a backup folder, or null when the folder holds no readable one. */
function loadManifest(folder: string): Manifest | null {
  try {
    return manifestSchema.parse(JSON.parse(readFileSync(join(folder, MANIFEST), 'utf8')));
  } catch {
    return null;
  }
}

/** The backup with this id; an unknown id, or one whose manifest cannot be read, is refused. */
function openBackup(root: string, id: string): { dir: string; manifest: Manifest } {
  const dir = join(backupsRoot(root), id);
  const manifest = ID.test(id) ? loadManifest(dir) : null;
  if (!manifest) {
    throw new AdrienError('INVALID_INPUT', `No backup "${id}". Run \`adrien backup list\` to see the backups.`);
  }
  return { dir, manifest };
}

/**
 * Copies the ADR directory (every file, recursively) and the config into a new folder under `.adrien/backups`, with a
 * manifest of the SHA-256 of each file. The copy runs while holding the lock of every ADR, so no write is half-copied.
 * Only the newest `BACKUP_KEEP` backups are kept.
 */
export function createBackup(root: string, config: LogConfig, reason: string, adrienVersion: string): BackupCreated {
  return withAdrLocks(root, currentIds(root, config), () => {
    const files = logFiles(root, config);
    // Strictly later than the newest backup, so the newest-first order never depends on a tie.
    const last = listBackups(root)[0];
    const createdAt = new Date(Math.max(Date.now(), last ? Date.parse(last.createdAt) + 1 : 0));
    const slug = slugify(reason) || 'backup';
    const id = claimFolder(root, `${stampOf(createdAt)}-${slug}`);
    const dir = join(backupsRoot(root), id);
    const entries = files.map((rel) => {
      const bytes = readFileSync(toFile(root, rel));
      const dest = join(dir, FILES, ...rel.split('/'));
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, bytes);
      return { path: rel, sha256: sha256(bytes) };
    });
    const manifest: Manifest = { createdAt: createdAt.toISOString(), adrienVersion, reason: slug, files: entries };
    writeFileSync(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const old of listBackups(root).slice(BACKUP_KEEP)) {
      rmSync(join(backupsRoot(root), old.id), { recursive: true, force: true });
    }
    return { id, createdAt: manifest.createdAt, reason: slug, fileCount: entries.length, path: dir };
  });
}

/** The backups of a log, newest first. A folder without a readable manifest is not a backup and is skipped. */
export function listBackups(root: string): BackupSummary[] {
  const dir = backupsRoot(root);
  if (!existsSync(dir)) return [];
  const found: BackupSummary[] = [];
  for (const id of readdirSync(dir)) {
    const manifest = loadManifest(join(dir, id));
    if (manifest) {
      found.push({ id, createdAt: manifest.createdAt, reason: manifest.reason, fileCount: manifest.files.length });
    }
  }
  return found.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Compares the log's decision files with a backup: changed (content differs), missing (gone) and added (not in it). */
export function verifyBackup(root: string, id: string): BackupVerification {
  const { manifest } = openBackup(root, id);
  const current = new Set(logFiles(root, loadLogConfig(root)));
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
 * Puts the decision files of a backup back. Every file is checked against its manifest before anything is written, and
 * the state being replaced is backed up first (`pre-restore`). Files the backup does not hold are reported as `leftover`
 * and never deleted.
 */
export function restoreBackup(root: string, config: LogConfig, id: string, adrienVersion: string): RestoreResult {
  const { dir, manifest } = openBackup(root, id);
  const staged = manifest.files.map(({ path, sha256: expected }) => {
    const target = logPath(root, path);
    const bytes = readFileSync(join(dir, FILES, ...path.split('/')));
    if (sha256(bytes) !== expected) {
      throw new AdrienError('INVALID_INPUT', `Backup ${id} is damaged: ${path} no longer matches its manifest. Nothing was restored.`);
    }
    return { path, target, bytes };
  });
  const backedIds = parseLogFiles(
    staged.map((s) => ({ path: s.path, text: s.bytes.toString('utf8') })),
    config,
  ).adrs.map((a) => a.meta.id);
  const preRestore = createBackup(root, config, 'pre-restore', adrienVersion);
  const ids = [...new Set([...currentIds(root, config), ...backedIds])];
  return withAdrLocks(root, ids, () => {
    for (const s of staged) {
      mkdirSync(dirname(s.target), { recursive: true });
      writeFileSync(s.target, s.bytes);
    }
    const listed = new Set(manifest.files.map((f) => f.path));
    return {
      id,
      preRestore: preRestore.id,
      restored: staged.map((s) => s.path),
      leftover: logFiles(root, config).filter((p) => !listed.has(p)),
    };
  });
}
