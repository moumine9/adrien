// Fails when a pull request changes the decision log (docs/decisions) or a config file (adrien.config.yaml or
// .adrien.yaml, at any depth) without the `adr` label, or changes them in a way the label does not allow. With the label,
// an ADR may be added but never deleted or renamed, and an accepted ADR is frozen except for its status (only to
// superseded or deprecated) and its links and review fields. A config file is never added, deleted or renamed, and
// with the label its adr_dir, id_format, components and log do not change. Files are parsed with core (parseAdr,
// parseLogConfigText, parseCodeRepoConfigText), so the guard sees what Adrien sees. The rules are a pure function over the
// changes, so they can be tested without git; `main` reads the changes from git.
//
// The workflow (.github/workflows/adr-guard.yml) runs on pull_request_target, so it runs the base branch's copy of this
// script and never runs code from the pull request. A pull request that adds the workflow therefore finds it absent (the
// workflow comes from main, and there is none until it is merged): that is expected until then.
//
// Inputs: GUARD_BASE (the base ref), GUARD_HEAD (the head to check, default HEAD), LABELS_JSON (the pull request's label
// names as a JSON array; the `adr` label must match exactly).
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseCodeRepoConfigText, parseLogConfigText } from '../packages/core/src/config.ts';
import { parseAdr } from '../packages/core/src/frontmatter.ts';

const LOG = 'docs/decisions';
const CODE_CONFIG = '.adrien.yaml';
const CONFIG_NAMES = new Set(['adrien.config.yaml', CODE_CONFIG]);
const ID_FORMAT = 'ADR-{n:4}';
// What an accepted ADR may change. `status` is restricted further (see below). `code` is frozen: a path change there
// changes what the ADR is about, so it takes a new ADR.
const EDITABLE_ON_ACCEPTED = new Set(['status', 'superseded_by', 'supersedes', 'related', 'review_on', 'contested']);
const STATUSES_AFTER_ACCEPTED = new Set(['superseded', 'deprecated']);

const basename = (path) => path.split('/').pop().toLowerCase();
const isConfig = (change) => CONFIG_NAMES.has(basename(change.path));
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
  if (frozenPart(before) !== frozenPart(after) || before.body.trimEnd() !== after.body.trimEnd()) {
    failures.push(`${id} is accepted; its text is frozen. Supersede it with a new ADR.`);
  }
  return failures;
}

/** The values of a config file that the label does not let change, as core parses them. */
function configValues(text, path) {
  if (basename(path) === CODE_CONFIG) {
    const { log, components } = parseCodeRepoConfigText(text, path);
    return { log, components };
  }
  const { adr_dir, components, id_format } = parseLogConfigText(text, path);
  return { adr_dir, components, id_format };
}

const show = (value) => (value === undefined ? 'nothing' : typeof value === 'string' ? value : canonical(value));

/** The failures for a config file: never added, deleted or renamed, and its frozen values never change. */
function configFailures({ status, path, oldPath, base, head }) {
  if (status === 'A' || status === 'C') return [`${path}: a config file cannot be added`];
  if (status === 'D' || status === 'R') return [`${oldPath ?? path}: a config file is never deleted or renamed`];
  if (base == null || head == null) return [cannotRead(path)];
  let before;
  let after;
  try {
    before = configValues(base, path);
    after = configValues(head, path);
  } catch (error) {
    return [`${path}: cannot be read (${error.message})`];
  }
  return Object.keys({ ...before, ...after })
    .sort()
    .filter((key) => canonical(before[key]) !== canonical(after[key]))
    .map((key) => `${path}: ${key} cannot change from ${show(before[key])} to ${show(after[key])}`);
}

/**
 * The failure messages for the changes under docs/decisions and the config files. A change is
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
 * The changes under docs/decisions and the config files, from the merge base of `base` and `head` to `head`. The
 * pathspecs ignore case, the config files match by basename at any depth, and `-z` keeps names as they are (no
 * quoting), so a non-ASCII file name is read with its real path.
 */
function changesSince(base, head) {
  const mergeBase = git(['merge-base', base, head]);
  if (mergeBase.status !== 0) throw new Error(`cannot find a merge base with ${base}: ${mergeBase.stderr.trim()}`);
  const mergeBaseSha = mergeBase.stdout.trim();
  const diff = git([
    'diff',
    '-z',
    '--name-status',
    mergeBaseSha,
    head,
    '--',
    `:(icase)${LOG}`,
    ':(icase,glob)**/adrien.config.yaml',
    `:(icase,glob)**/${CODE_CONFIG}`,
  ]);
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
      changes.push({ status, oldPath, path, base: fileAt(mergeBaseSha, oldPath), head: fileAt(head, path) });
    } else {
      const path = tokens[i];
      i += 1;
      changes.push({
        status,
        path,
        base: status === 'A' ? null : fileAt(mergeBaseSha, path),
        head: status === 'D' ? null : fileAt(head, path),
      });
    }
  }
  return changes;
}

function main() {
  const base = process.env.GUARD_BASE || 'origin/main';
  const head = process.env.GUARD_HEAD || 'HEAD';
  let failures;
  try {
    // The label is compared exactly: GitHub's own `contains` ignores case, so the label names come in as JSON.
    const labels = JSON.parse(process.env.LABELS_JSON || '[]');
    const adrLabel = Array.isArray(labels) && labels.includes('adr');
    failures = guardChanges({ adrLabel, changes: changesSince(base, head) });
  } catch (error) {
    console.error(`adrien: ${error.message}`);
    process.exit(1);
  }
  for (const failure of failures) console.error(`adrien: ${failure}`);
  if (failures.length > 0) process.exit(1);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main();
