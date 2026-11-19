// Fails when a pull request changes the decision log (docs/decisions) without the `adr` label, or changes an ADR the
// label does not allow. Only a pull request labelled `adr` may touch the log, and then an ADR may be added, but never
// deleted or renamed, and an accepted ADR is frozen except for its status and its links (supersedes, related, ...).
// The rules are a pure function over the changes, so they can be tested without git; `main` reads the changes from git.
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const LOG = 'docs/decisions';
// The frontmatter keys an accepted ADR may change. Every other key, and the body, is frozen.
const ALLOWED_ON_ACCEPTED = new Set(['status', 'superseded_by', 'supersedes', 'related', 'deprecated_on']);

/** Reads the frontmatter (top-level `key: value` lines; indented or `- ` lines belong to the key above) and the body. */
function parseAdr(text) {
  const lines = (text ?? '').split(/\r?\n/);
  const end = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (end === -1) return { fields: new Map(), body: (text ?? '').trimEnd() };
  const values = new Map();
  let key = null;
  for (const line of lines.slice(1, end)) {
    const field = /^([A-Za-z_][\w-]*):(.*)$/.exec(line);
    if (field) {
      key = field[1];
      values.set(key, [field[2].trim()]);
    } else if (key !== null && line.trim() !== '') {
      values.get(key).push(line.trim());
    }
  }
  const fields = new Map([...values].map(([name, parts]) => [name, parts.join('\n')]));
  return {
    fields,
    body: lines
      .slice(end + 1)
      .join('\n')
      .trimEnd(),
  };
}

const scalar = (value) => (value ?? '').replace(/^["']|["']$/g, '');

/** The frozen-text failure for a modified ADR that was accepted at base, or null when its change is allowed. */
function frozenFailure({ path, base, head }) {
  if (base == null) return null;
  const before = parseAdr(base);
  if (scalar(before.fields.get('status')) !== 'accepted') return null;
  const after = parseAdr(head);
  const keys = new Set([...before.fields.keys(), ...after.fields.keys()]);
  const frozenKeyChanged = [...keys].some(
    (name) => !ALLOWED_ON_ACCEPTED.has(name) && before.fields.get(name) !== after.fields.get(name),
  );
  if (!frozenKeyChanged && before.body === after.body) return null;
  // The ADR is named as it was accepted at base, whatever id the change gives it.
  const id =
    scalar(before.fields.get('id')) ||
    path
      .split('/')
      .pop()
      .match(/^ADR-\d+/)?.[0];
  return `${id} is accepted; its text is frozen. Supersede it with a new ADR.`;
}

/**
 * The failure messages for the changes under docs/decisions. A change is `{ status, path, oldPath?, base?, head? }`,
 * where status is git's letter (A, M, D, R, C, T) and base and head are the file's text before and after (null when
 * absent). An empty list passes.
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
    const letter = change.status.charAt(0);
    if (letter === 'D' || letter === 'R') {
      failures.push(`${change.oldPath ?? change.path}: ADR files are never deleted or renamed; supersede instead`);
    } else if (letter === 'M' || letter === 'T') {
      const failure = frozenFailure(change);
      if (failure) failures.push(failure);
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

/** The changes under docs/decisions from the merge base with `base` to HEAD. */
function changesSince(base) {
  const mergeBase = git(['merge-base', base, 'HEAD']);
  if (mergeBase.status !== 0) throw new Error(`cannot find a merge base with ${base}: ${mergeBase.stderr.trim()}`);
  const mergeBaseSha = mergeBase.stdout.trim();
  const diff = git(['diff', '--name-status', `${base}...HEAD`, '--', LOG]);
  if (diff.status !== 0) throw new Error(`git diff failed: ${diff.stderr.trim()}`);
  return diff.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => {
      const [code, first, second] = line.split('\t');
      const status = code.charAt(0);
      if (status === 'R' || status === 'C') {
        return {
          status,
          oldPath: first,
          path: second,
          base: fileAt(mergeBaseSha, first),
          head: fileAt('HEAD', second),
        };
      }
      return { status, path: first, base: fileAt(mergeBaseSha, first), head: fileAt('HEAD', first) };
    });
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
