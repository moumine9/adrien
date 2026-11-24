import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { LogConfig } from './config.ts';
import { AdrienError } from './errors.ts';
import { isAdrFile, parseAdr, serializeAdr } from './frontmatter.ts';
import type { Adr } from './model.ts';
import { canonicalPath, isInside } from './paths.ts';
import { slugify } from './slug.ts';

export interface LoadProblem {
  path: string;
  message: string;
}

export interface LoadedLog {
  adrs: Adr[];
  problems: LoadProblem[];
}

export const toPosix = (p: string): string => p.replace(/\\/g, '/');

/** Parses candidate files; a broken file becomes a problem instead of hiding the rest of the log. */
export function parseLogFiles(files: Array<{ path: string; text: string }>, config: LogConfig): LoadedLog {
  const adrs: Adr[] = [];
  const problems: LoadProblem[] = [];
  for (const { path, text } of files) {
    if (!isAdrFile(text, posix.basename(path))) continue;
    try {
      // The revision comes from the very text that is parsed, so it can never be newer than the content it describes.
      adrs.push({ ...parseAdr(text, path, { idFormat: config.id_format }), revision: revisionOfText(text) });
    } catch (e) {
      if (!(e instanceof AdrienError) || e.code !== 'PARSE_ERROR') throw e;
      problems.push({ path, message: e.message });
    }
  }
  return { adrs, problems };
}

export function readWorkingLog(logRoot: string, config: LogConfig): LoadedLog {
  const adrDir = join(logRoot, config.adr_dir);
  if (!existsSync(adrDir)) return { adrs: [], problems: [] };
  const files = readdirSync(adrDir, { recursive: true, encoding: 'utf8' })
    .map(toPosix)
    .filter((rel) => rel.endsWith('.md'))
    .sort()
    .map((rel) => ({
      path: posix.join(toPosix(config.adr_dir), rel),
      text: readFileSync(join(adrDir, rel), 'utf8'),
    }));
  return parseLogFiles(files, config);
}

export function adrFilePath(config: LogConfig, id: string, title: string, subdir?: string): string {
  const adrDir = posix.join(toPosix(config.adr_dir));
  const dir = posix.join(adrDir, toPosix(subdir ?? ''));
  const inside = posix.relative(adrDir, dir);
  if (inside === '..' || inside.startsWith('../')) {
    throw new AdrienError('INVALID_INPUT', `--subdir "${subdir}" leaves the ADR directory (${config.adr_dir}).`);
  }
  const file = posix.join(dir, `${id}-${slugify(title)}.md`);
  // An id_format with separators (`../ADR-{n}`) would otherwise put the file somewhere the log never reads.
  const filePart = posix.relative(adrDir, file);
  if (filePart === '..' || filePart.startsWith('../')) {
    throw new AdrienError(
      'INVALID_INPUT',
      `The id "${id}" would place ${file} outside the ADR directory (${config.adr_dir}).`,
    );
  }
  return file;
}

/** Refuses a destination that leaves the log, lexically or through a symlink (whether the file or a folder above it). */
export function assertInsideLog(logRoot: string, file: string, adrPath: string): void {
  const root = canonicalPath(logRoot);
  const outside = (where: string) =>
    new AdrienError('INVALID_INPUT', `${adrPath} resolves outside the log (${where}); refusing to write it.`);
  if (!isInside(file, logRoot)) throw outside(file);
  const link = lstatSync(file, { throwIfNoEntry: false });
  if (link?.isSymbolicLink()) {
    const real = canonicalPath(file);
    if (real === file || !isInside(real, root)) throw outside(real);
    return;
  }
  let probe = file;
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
  const real = canonicalPath(probe);
  if (!isInside(real, root)) throw outside(real);
}

/** `exclusive` refuses to replace an existing file, so creating an ADR can never overwrite another one. */
export function writeAdr(logRoot: string, adr: Adr, opts: { exclusive?: boolean } = {}): void {
  const file = join(logRoot, ...adr.path.split('/'));
  assertInsideLog(logRoot, file, adr.path);
  mkdirSync(dirname(file), { recursive: true });
  if (!tryWriteFile(file, serializeAdr(adr), opts.exclusive ? 'wx' : 'w')) {
    throw new AdrienError('INVALID_INPUT', `${adr.path} already exists; refusing to overwrite it.`);
  }
}

export function tryWriteFile(file: string, content: string, flag: 'wx' | 'w'): boolean {
  try {
    writeFileSync(file, content, { flag });
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw e;
  }
}

/** A crashed writer costs one number: later writers skip occupied markers without waiting or stealing them. */
export function reserveId(logRoot: string, start: number): { number: number; release: () => void } {
  const dir = join(logRoot, '.adrien');
  assertInsideLog(logRoot, dir, '.adrien');
  mkdirSync(dir, { recursive: true });
  tryWriteFile(join(dir, '.gitignore'), '*\n', 'wx');
  for (let number = start; ; number++) {
    const marker = join(dir, `create-${number}.lock`);
    if (tryWriteFile(marker, '', 'wx')) return { number, release: () => unlinkSync(marker) };
  }
}

/** A short hash of the text of an ADR file, so a change can say which version it was based on, as a commit does. */
export const revisionOfText = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 12);

/** The revision of an ADR file as it is on disk right now. */
export const revisionOf = (logRoot: string, adrPath: string): string =>
  revisionOfText(readFileSync(join(logRoot, ...adrPath.split('/')), 'utf8'));

/**
 * Replaces the text of a file in one step: the new text goes to a temp file beside it, which is then renamed over it, so
 * a reader sees the old text or the new one. The temp name ends in `.tmp-<pid>`, which no log reader picks up. A symlink
 * is followed, so the link stays and its target is replaced. The file must exist.
 */
export function writeTextAtomic(file: string, content: string): void {
  const target = realpathSync(file);
  const temp = `${target}.tmp-${process.pid}`;
  let created = false;
  try {
    // 'wx' fails on any existing path, a link included, so the write can never be redirected to another file.
    const fd = openSync(temp, 'wx');
    created = true;
    try {
      writeFileSync(fd, content);
    } finally {
      closeSync(fd);
    }
    renameSync(temp, target);
  } catch (e) {
    // Only a temp file this call created is removed: an existing one is not ours.
    if (created) {
      try {
        unlinkSync(temp);
      } catch {
        // It cannot be removed: the original error is the one to report.
      }
    }
    throw e;
  }
}
