// Fails when a pull request changes the decision log (docs/decisions) or adrien.config.yaml without the `adr` label, or
// changes them in a way the label does not allow. With the label, an ADR may be added but never deleted or renamed, and
// an accepted ADR is frozen except for its status (only to superseded or deprecated) and its links and review fields.
// Files are read and parsed with core (parseAdr, parseLogConfigText), so the guard sees what Adrien sees. The rules are
// a pure function over the changes, so they can be tested without git; `main` reads the changes from git.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseLogConfigText } from '../packages/core/src/config.ts';
import { parseAdr } from '../packages/core/src/frontmatter.ts';

const LOG = 'docs/decisions';
const CONFIG = 'adrien.config.yaml';
// The decision directory this guard protects. A config that names another adr_dir moves the log out of its reach.
const GUARDED_DIR = LOG;
const ID_FORMAT = 'ADR-{n:4}';
// What an accepted ADR may change. `status` is restricted further (see below); `code` may only be edited, not grown or
// shrunk, so a change is a path rename.
const EDITABLE_ON_ACCEPTED = new Set([
  'status',
  'superseded_by',
  'supersedes',
  'related',
  'review_on',
  'contested',
  'code',
]);
const STATUSES_AFTER_ACCEPTED = new Set(['superseded', 'deprecated']);

const isConfig = (change) => change.path.toLowerCase() === CONFIG;
const cannotRead = (path) => `${path}: cannot read the file at base or head, so the change is refused`;

/** JSON with sorted keys, so two parsed values compare equal whatever order core put their keys in. */
function canonical(value) {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

/** The parsed ADR without the fields an accepted ADR may change (its body is compared on its own). */
function frozenPart(adr) {
  return canonical(Object.fromEntries(Object.entries(adr.meta).filter(([key]) => !EDITABLE_ON_ACCEPTED.has(key))));
}

/** The failures for a modified ADR, given its base and head text. An ADR that was not accepted at base is free. */
function adrFailures({ path, base, head }) {
  if (base == null || head == null) return [cannotRead(path)];
  let before;
  let after;
  try {
    before = parseAdr(base, path, { idFormat: ID_FORMAT });
    after = parseAdr(head, path, { idFormat: ID_FORMAT });
  } catch (error) {
    return [`${path}: cannot be read (${error.message})`];
  }
  if (before.meta.status !== 'accepted') return [];

  const failures = [];
  // The ADR is named as it was accepted at base, whatever the change does to its id.
  const id = before.meta.id;
  if (after.meta.status !== 'accepted' && !STATUSES_AFTER_ACCEPTED.has(after.meta.status)) {
    failures.push(`${id} is accepted; it may only become superseded or deprecated.`);
  }
  const frozenChanged =
    frozenPart(before) !== frozenPart(after) ||
    before.body.trimEnd() !== after.body.trimEnd() ||
    before.meta.code.length !== after.meta.code.length;
  if (frozenChanged) failures.push(`${id} is accepted; its text is frozen. Supersede it with a new ADR.`);
  return failures;
}

/** The failures for adrien.config.yaml: it is never deleted or renamed, and its adr_dir never changes. */
function configFailures({ status, path, oldPath, base, head }) {
  if (status === 'D' || status === 'R') return [`${oldPath ?? path}: ${CONFIG} is never deleted or renamed`];
  if (head == null || (status !== 'A' && base == null)) return [cannotRead(path)];
  try {
    const before = base == null ? GUARDED_DIR : parseLogConfigText(base, path).adr_dir;
    const after = parseLogConfigText(head, path).adr_dir;
    return before === after ? [] : [`${path}: adr_dir cannot change from ${before} to ${after}`];
  } catch (error) {
    return [`${path}: cannot be read (${error.message})`];
  }
}

/**
 * The failure messages for the changes under docs/decisions and the config. A change is
 * `{ status, path, oldPath?, base?, head? }`, where status is git's letter (A, M, D, R, C, T, possibly with a score such
 * as `R100`) and base and head are the file's text before and after (null when absent). An empty list passes.
 */
export function guardChanges({ adrLabel, changes }) {
  if (changes.length === 0) return [];
  if (!adrLabel) {
    const files = changes.map((change) => change.path).join(', ');
    return [`This pull request changes decision files (${files}). Move them to a pull request labelled \`adr\`.`];
  }
  const failures = [];
  for (const change of changes) {
    // git writes a rename or copy with its similarity score, as in `R100`; only the letter matters here.
    const status = change.status.charAt(0);
    if (isConfig(change)) {
      failures.push(...configFailures({ ...change, status }));
    } else if (status === 'D' || status === 'R') {
      failures.push(`${change.oldPath ?? change.path}: ADR files are never deleted or renamed; supersede instead`);
    } else if (status === 'M' || status === 'T') {
      failures.push(...adrFailures(change));
    }
  }
  return failures;
}

function git(args) {
  return spawnSync('git', args, { encoding: 'utf8' });
}

/** The text of `path` at `ref`, or null when the file is not there. */
function fileAt(ref, path) {
  const run = git(['show', `${ref}:${path}`]);
  return run.status === 0 ? run.stdout : null;
}

/**
 * The changes under docs/decisions and the config from the merge base with `base` to HEAD. The pathspecs ignore case,
 * and `-z` keeps names as they are (no quoting), so a non-ASCII file name is read with its real path.
 */
function changesSince(base) {
  const mergeBase = git(['merge-base', base, 'HEAD']);
  if (mergeBase.status !== 0) throw new Error(`cannot find a merge base with ${base}: ${mergeBase.stderr.trim()}`);
  const mergeBaseSha = mergeBase.stdout.trim();
  const diff = git(['diff', '-z', '--name-status', `${base}...HEAD`, '--', `:(icase)${LOG}`, `:(icase)${CONFIG}`]);
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  const tokens = diff.stdout.split('\0');
  const changes = [];
  for (let i = 0; i < tokens.length && tokens[i] !== ''; ) {
    const status = tokens[i].charAt(0);
    i += 1;
    if (status === 'R' || status === 'C') {
      const oldPath = tokens[i];
      const path = tokens[i + 1];
      i += 2;
      changes.push({ status, oldPath, path, base: fileAt(mergeBaseSha, oldPath), head: fileAt('HEAD', path) });
    } else {
      const path = tokens[i];
      i += 1;
      changes.push({
        status,
        path,
        base: status === 'A' ? null : fileAt(mergeBaseSha, path),
        head: status === 'D' ? null : fileAt('HEAD', path),
      });
    }
  }
  return changes;
}

function main() {
  const base = process.env.GUARD_BASE || 'origin/main';
  const adrLabel = process.env.ADR_LABEL === 'true';
  let failures;
  try {
    failures = guardChanges({ adrLabel, changes: changesSince(base) });
  } catch (error) {
    console.error(`adrien: ${error.message}`);
    process.exit(1);
  }
  for (const failure of failures) console.error(`adrien: ${failure}`);
  if (failures.length > 0) process.exit(1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
