import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import type { LogConfig } from './config.ts';
import { AdrienError } from './errors.ts';
import { isAdrFile, parseAdr, serializeAdr } from './frontmatter.ts';
import type { Adr } from './model.ts';
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
      adrs.push(parseAdr(text, path, { idFormat: config.id_format }));
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
  return posix.join(dir, `${id}-${slugify(title)}.md`);
}

export function writeAdr(logRoot: string, adr: Adr): void {
  const file = join(logRoot, ...adr.path.split('/'));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, serializeAdr(adr));
}
