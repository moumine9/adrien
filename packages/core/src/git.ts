import { execFile, spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { toPosix } from './log.ts';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

/** Runs git; resolves stdout, or null when git fails (not a repo, unknown ref, offline…). */
export async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: MAX_BUFFER, encoding: 'utf8' });
    return stdout;
  } catch {
    return null;
  }
}

export async function gitToplevel(dir: string): Promise<string | null> {
  if (!existsSync(dir)) return null;
  const out = await git(dir, ['rev-parse', '--show-toplevel']);
  return out ? resolve(out.trim()) : null;
}

async function isCommit(repoDir: string, ref: string): Promise<boolean> {
  return (await git(repoDir, ['rev-parse', '--verify', '-q', '--end-of-options', `${ref}^{commit}`])) !== null;
}

/** The ref that holds the binding version of the log: origin's default branch, else a local main/master. */
export async function resolveBaseRef(repoDir: string): Promise<string | null> {
  const originHead = (await git(repoDir, ['symbolic-ref', '-q', '--short', 'refs/remotes/origin/HEAD']))?.trim();
  const candidates = [originHead, 'origin/main', 'origin/master', 'main', 'master'];
  for (const ref of candidates) if (ref && (await isCommit(repoDir, ref))) return ref;
  return null;
}

/** Splits `git cat-file --batch` output, whose object sizes are in bytes. */
function parseBatch(out: Buffer, paths: string[]): Array<{ path: string; text: string }> {
  const files: Array<{ path: string; text: string }> = [];
  let pos = 0;
  for (const path of paths) {
    const eol = out.indexOf(10, pos);
    const header = out.subarray(pos, eol).toString('utf8');
    pos = eol + 1;
    const size = /^\S+ blob (\d+)$/.exec(header)?.[1];
    if (size === undefined) continue; // "missing" or not a blob
    files.push({ path, text: out.subarray(pos, pos + Number(size)).toString('utf8') });
    pos += Number(size) + 1;
  }
  return files;
}

function catFileBatch(repoDir: string, specs: string[]): Promise<Buffer> {
  return new Promise((done, fail) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: repoDir });
    const chunks: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => chunks.push(c));
    child.on('error', fail);
    child.on('close', (code) =>
      code === 0 ? done(Buffer.concat(chunks)) : fail(new Error(`git cat-file exited ${code}`)),
    );
    child.stdin.end(specs.map((s) => `${s}\n`).join(''));
  });
}

/** All files under `subdir` at `ref`, with paths relative to `repoDir` (the repo's top level). */
export async function readTreeAtRef(
  repoDir: string,
  ref: string,
  subdir: string,
): Promise<Array<{ path: string; text: string }>> {
  const listing = await git(repoDir, ['ls-tree', '-r', '-z', '--name-only', ref, '--', subdir || '.']);
  if (!listing) return [];
  const paths = listing.split('\0').filter(Boolean);
  if (paths.length === 0) return [];
  return parseBatch(
    await catFileBatch(
      repoDir,
      paths.map((p) => `${ref}:${p}`),
    ),
    paths,
  );
}

export async function remoteUrl(repoDir: string, remote = 'origin'): Promise<string | null> {
  return (await git(repoDir, ['remote', 'get-url', remote]))?.trim() || null;
}

export async function fetchOrigin(repoDir: string): Promise<boolean> {
  return (await git(repoDir, ['fetch', '--quiet', 'origin'])) !== null;
}

function walk(dir: string, rel = ''): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(dir, child));
    else out.push(child);
  }
  return out;
}

/** Tracked and untracked (non-ignored) files under `subdir`, relative to `subdir`. */
export async function listFiles(repoDir: string, subdir = ''): Promise<string[]> {
  const root = join(repoDir, subdir);
  if (!existsSync(root)) return [];
  const out = await git(root, ['ls-files', '-z', '-co', '--exclude-standard', '--', '.']);
  if (out !== null) return out.split('\0').filter(Boolean).map(toPosix);
  return walk(root);
}
