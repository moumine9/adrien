import { createHash, randomBytes } from 'node:crypto';
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
import { dirname, join, posix, resolve } from 'node:path';
import { z } from 'zod';
import { CONFIG_FILE, findUp, type LogConfig, loadLogConfig, parseLogConfigText } from './config.ts';
import { AdrienError } from './errors.ts';
import { type LockOptions, withAdrLocks } from './lock.ts';
import { assertInsideLog, parseLogFiles, toPosix } from './log.ts';
import { canonicalPath } from './paths.ts';
import { isGitUrl } from './repo-url.ts';
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

const RESERVED = new Set(['.git', '.adrien']);
const DRIVE = /^[A-Za-z]:/;

/**
 * Whether a path from a manifest is a plain relative path that cannot climb or reach a reserved folder: no empty, `.` or
 * `..` segment, no absolute or drive-letter form, no backslash or NUL, and no `.git` or `.adrien` segment in any case.
 * A manifest with a path that fails this is damaged. The check is on the raw text, before any normalisation.
 */
function safeRelPath(rel: string): boolean {
  if (rel.length === 0 || rel.startsWith('/') || DRIVE.test(rel)) return false;
  if (rel.includes('\\') || rel.includes('\0')) return false;
  return rel
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..' && !RESERVED.has(part.toLowerCase()));
}

const manifestSchema = z.object({
  createdAt: z.iso.datetime(),
  adrienVersion: z.string(),
  reason: z.string(),
  files: z.array(z.object({ path: z.string().refine(safeRelPath), sha256: z.string() })),
  // Informational only: these names are shown, never used as paths, so they need not be plain.
  skipped: z.array(z.string()).default([]),
  /** The ADR directories this backup covers: its config's, and any other a pre-restore snapshot had to hold. */
  adrDirs: z.array(z.string()).default([]),
});
type Manifest = z.infer<typeof manifestSchema>;

const backupsRoot = (root: string): string => join(root, '.adrien', 'backups');
const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');
const toFile = (root: string, rel: string): string => join(root, ...rel.split('/'));

/**
 * The first segment of `rel`, from the log root down, that is a link or is not the right kind of entry: a folder for every
 * segment above the last, and for the last one a file (`last: 'file'`) or a folder (`last: 'dir'`). Absent segments are
 * fine. Every link is refused here, never followed: `lstat` only inspects the final segment, so each one is checked.
 */
function unsafeOn(root: string, rel: string, last: 'file' | 'dir'): string | null {
  const parts = rel.split('/');
  for (let i = 1; i <= parts.length; i++) {
    const at = parts.slice(0, i).join('/');
    const st = lstatSync(join(root, at), { throwIfNoEntry: false });
    if (!st) return null;
    const wanted = i === parts.length ? last : 'dir';
    const plain = wanted === 'file' ? st.isFile() : st.isDirectory();
    if (st.isSymbolicLink() || !plain) return at;
  }
  return null;
}

/** Refuses a restore that would write through a link (or a non-file) before a single byte is written. */
function refuseLinked(root: string, paths: string[]): void {
  const linked = paths.filter((p) => unsafeOn(root, p, 'file') !== null);
  if (linked.length > 0) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Restore refused: these paths go through a link or are not plain files, so nothing was written: ${linked.join(', ')}`,
    );
  }
}

/** The backups folder itself must be plain: a link there would send backups and locks outside the log. */
function refuseLinkedBackups(root: string): void {
  const bad = unsafeOn(root, '.adrien/backups', 'dir');
  if (bad) {
    throw new AdrienError(
      'INVALID_INPUT',
      `The backups folder goes through a link or is not a folder (${bad}). Nothing was written.`,
    );
  }
}

/** Writes through a temp file in the same folder and renames it into place: an existing file is replaced, never opened in place. */
function writeAtomic(file: string, bytes: Buffer | string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, bytes, { flag: 'wx' });
  renameSync(tmp, file);
}

/** `ADRIEN_LOCK_TIMEOUT_MS` sets how long a backup waits for another process to let go of an ADR, as in `ops.ts`. */
function lockOptionsOf(env: NodeJS.ProcessEnv): LockOptions {
  const timeoutMs = Number(env.ADRIEN_LOCK_TIMEOUT_MS);
  return Number.isInteger(timeoutMs) && timeoutMs > 0 ? { timeoutMs } : {};
}
const adrRelOf = (config: LogConfig): string => posix.normalize(toPosix(config.adr_dir)).replace(/(.)\/+$/, '$1');

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
  if (!safeRelPath(rel)) return `The ADR directory ${config.adr_dir} has a name a backup cannot hold.`;
  return null;
}

/** The file's path inside the log, refused when it leads anywhere else (a `..` segment or a symlinked folder). */
function logPath(root: string, rel: string): string {
  const file = toFile(root, rel);
  assertInsideLog(root, file, rel);
  return file;
}

/**
 * A restore writes only the config and paths under the ADR directory. `rel` has already passed `safeRelPath` (manifests
 * are validated when read), so the prefix test on its text is exact.
 */
function restoreTarget(root: string, scopes: string[], rel: string): string {
  if (rel !== CONFIG_FILE && !scopes.some((dir) => rel.startsWith(`${dir}/`))) {
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
    // A name the manifest could not hold (a nested `.git`, a backslash) would make the whole backup unreadable.
    if (!safeRelPath(childRel)) {
      skipped.push(childRel);
      continue;
    }
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
  const files: string[] = [];
  const skipped: string[] = [];
  // A link anywhere on the way to the ADR directory (or the directory itself) is skipped whole: nothing beneath it is read.
  if (unsafeOn(root, adrRel, 'dir')) skipped.push(adrRel);
  else if (lstatSync(join(root, adrRel), { throwIfNoEntry: false })?.isDirectory()) {
    walk(join(root, adrRel), adrRel, files, skipped);
  }
  if (unsafeOn(root, CONFIG_FILE, 'file')) skipped.push(CONFIG_FILE);
  else if (existsSync(join(root, CONFIG_FILE))) files.push(CONFIG_FILE);
  return { files: files.sort(), skipped: skipped.sort() };
}

const inDir = (config: LogConfig, adr_dir: string): LogConfig => ({ ...config, adr_dir });

/** The files of the config's ADR directory and of `dirs` together: a restore may replace files under any of them. */
function unionFiles(root: string, config: LogConfig, dirs: string[]): LogFiles {
  const all = [logFiles(root, config), ...dirs.map((d) => logFiles(root, inDir(config, d)))];
  const merge = (lists: string[][]) => [...new Set(lists.flat())].sort();
  return { files: merge(all.map((a) => a.files)), skipped: merge(all.map((a) => a.skipped)) };
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
  dirs: string[] = [],
): BackupCreated {
  const { files, skipped } = unionFiles(root, config, dirs);
  // Strictly later than the newest backup, so the newest-first order never depends on a tie.
  const newest = okBackups(root)[0];
  const createdAt = new Date(Math.max(Date.now(), newest ? Date.parse(newest.createdAt) + 1 : 0));
  const slug = slugify(reason) || 'backup';
  const id = claimFolder(root, `${stampOf(createdAt)}-${slug}`);
  const dir = join(backupsRoot(root), id);
  try {
    const entries = files.map((rel) => {
      const bytes = readFileSync(toFile(root, rel));
      writeAtomic(join(dir, FILES, ...rel.split('/')), bytes);
      return { path: rel, sha256: sha256(bytes) };
    });
    const manifest: Manifest = {
      createdAt: createdAt.toISOString(),
      adrienVersion,
      reason: slug,
      files: entries,
      skipped,
      adrDirs: [...new Set([adrRelOf(config), ...dirs])],
    };
    writeAtomic(join(dir, MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
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
function underLocks<T>(root: string, config: LogConfig, extra: string[], env: NodeJS.ProcessEnv, fn: () => T): T {
  let ids = [...new Set([...currentIds(root, config), ...extra])];
  for (;;) {
    const outcome = withAdrLocks<Attempt<T>>(
      root,
      ids,
      () => {
        const unlocked = [...new Set(currentIds(root, config).filter((id) => !ids.includes(id)))];
        return unlocked.length > 0 ? { unlocked } : { value: fn() };
      },
      lockOptionsOf(env),
    );
    if ('value' in outcome) return outcome.value;
    ids = [...ids, ...outcome.unlocked];
  }
}

/**
 * Copies the ADR directory (every regular file, recursively) and the config into a new folder under `.adrien/backups`,
 * with a manifest of the SHA-256 of each file. Links and other non-files are listed as `skipped`, never followed.
 * The copy holds the lock of every ADR, so no write is half-copied. Only the newest `BACKUP_KEEP` are kept.
 */
export function createBackup(
  root: string,
  config: LogConfig,
  reason: string,
  adrienVersion: string,
  env: NodeJS.ProcessEnv = process.env,
): BackupCreated {
  refuseLinkedBackups(root);
  return underLocks(root, config, [], env, () => snapshot(root, config, reason, adrienVersion, []));
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
  const { dir, manifest } = openBackup(root, id);
  // The live config may be gone or unreadable (that is what a backup is for): then the backed-up one says where to look.
  let live: LogConfig | null = null;
  try {
    live = loadLogConfig(root);
  } catch {
    live = null;
  }
  // A live config whose ADR directory cannot be backed up (`.`, say) cannot say where to look either; its bytes are still compared.
  if (live && adrDirProblem(live)) live = null;
  // The backup's own copy of the config is only opened when the live one cannot say where to look.
  const base = live ?? backedUpConfig(dir, manifest, null, id);
  const current = new Set(unionFiles(root, base, scopesOf(base, manifest)).files);
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

/** Every directory a backup covers: its config's, and any a pre-restore snapshot recorded. Each must be usable. */
function scopesOf(backed: LogConfig, manifest: Manifest): string[] {
  const scopes = [...new Set([adrRelOf(backed), ...manifest.adrDirs.map((d) => adrRelOf(inDir(backed, d)))])];
  for (const dir of scopes) {
    const problem = adrDirProblem(inDir(backed, dir));
    if (problem) throw new AdrienError('INVALID_INPUT', problem);
  }
  return scopes;
}

/**
 * The config a restore works to: the one the backup holds (after its checksum), else the live one. A backed-up config that
 * cannot be read falls back to the live one, and a restore with neither is refused. Its ADR directory must be usable.
 */
function backedUpConfig(dir: string, manifest: Manifest, live: LogConfig | null, id: string): LogConfig {
  const entry = manifest.files.find((f) => f.path === CONFIG_FILE);
  let found: LogConfig | null = null;
  if (entry) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(dir, FILES, CONFIG_FILE));
    } catch {
      throw new AdrienError('INVALID_INPUT', `Backup ${id} is damaged: its copy of ${CONFIG_FILE} cannot be read.`);
    }
    if (sha256(bytes) !== entry.sha256) {
      throw new AdrienError(
        'INVALID_INPUT',
        `Backup ${id} is damaged: ${CONFIG_FILE} no longer matches its manifest. Nothing was restored.`,
      );
    }
    try {
      found = parseLogConfigText(bytes.toString('utf8'), `${id}/${CONFIG_FILE}`);
    } catch {
      found = null;
    }
  }
  const config = found ?? live;
  if (!config) {
    throw new AdrienError(
      'INVALID_INPUT',
      `Neither the log nor backup ${id} holds a usable configuration (${CONFIG_FILE}), so a restore cannot tell where the ADRs go.`,
    );
  }
  const problem = adrDirProblem(config);
  if (problem) throw new AdrienError('INVALID_INPUT', problem);
  return config;
}

/**
 * Puts the decision files of a backup back. Every file is checked against its manifest before anything is written.
 * The state being replaced is backed up (`pre-restore`) and the restore writes under the same locks as that backup,
 * so nothing can change between the snapshot and the writes. Files the backup does not hold are reported as `leftover`
 * and never deleted.
 */
export function restoreBackup(
  root: string,
  config: LogConfig | null,
  id: string,
  adrienVersion: string,
  env: NodeJS.ProcessEnv = process.env,
): RestoreResult {
  refuseLinkedBackups(root);
  const { dir, manifest } = openBackup(root, id);
  // Where the ADRs go is what the backup says, checked like every other file; the live config may be gone or have moved.
  // A live config whose ADR directory cannot be backed up counts as unusable here; its bytes are still snapshotted.
  const usable = config && !adrDirProblem(config) ? config : null;
  const backed = backedUpConfig(dir, manifest, usable, id);
  const live = usable ?? backed;
  const scopes = scopesOf(backed, manifest);
  const staged = manifest.files.map(({ path, sha256: expected }) => {
    const target = restoreTarget(root, scopes, path);
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
    backed,
  ).adrs.map((a) => a.meta.id);
  const paths = manifest.files.map((f) => f.path);
  refuseLinked(root, paths);
  const lockIds = [...backedIds, ...scopes.flatMap((d) => currentIds(root, inDir(backed, d)))];
  return underLocks(root, live, lockIds, env, () => {
    // Checked again under the locks: a link made after the first check must still stop the restore before any write.
    refuseLinked(root, paths);
    const snap = snapshot(root, live, 'pre-restore', adrienVersion, [id], scopes);
    for (const s of staged) writeAtomic(s.target, s.bytes);
    const listed = new Set(manifest.files.map((f) => f.path));
    return {
      id,
      preRestore: snap.id,
      restored: staged.map((s) => s.path),
      leftover: unionFiles(root, backed, scopes).files.filter((p) => !listed.has(p)),
    };
  });
}

/**
 * The log a restore works on when its config may be gone: the folder `log` names (never a remote clone), else the nearest
 * folder above `cwd` that holds backups. Null when there is none.
 */
export function findBackupRoot(cwd: string, log?: string): string | null {
  if (log) return isGitUrl(log) ? null : canonicalPath(resolve(cwd, log));
  const found = findUp(cwd, join('.adrien', 'backups'));
  return found ? canonicalPath(found) : null;
}
