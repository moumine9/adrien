import { realpathSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';

/**
 * The physical path: symlinks, Windows 8.3 short names (`RUNNER~1`) and drive-letter case resolved. Git reports paths
 * this way, so every path node compares with one of git's goes through here first.
 */
export function canonicalPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** True when `child` is `parent` or lies below it. */
export function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
