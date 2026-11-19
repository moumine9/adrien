import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardChanges } from '../../../scripts/guard-adrs.mjs';
import { tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';

const script = fileURLToPath(new URL('../../../scripts/guard-adrs.mjs', import.meta.url));
const ADR = 'docs/decisions/ADR-0002-only-an-accepted-adr-is-binding.md';
const NEW = 'docs/decisions/ADR-0030-a-new-decision.md';
const CONFIG = 'adrien.config.yaml';
const CONFIG_TEXT = 'product: adrien\nadr_dir: docs/decisions\nid_format: "ADR-{n:4}"\n';
const CODE_CONFIG = '.adrien.yaml';
const CODE_TEXT = 'log: docs/decisions\ncomponents:\n  - core\n';

const PROPOSED = `---
id: ADR-0030
title: A proposed decision
status: proposed
date: 2026-11-18
tags: [workflow]
code:
  - core:src/view.ts
  - core:src/for-files.ts
review_rule: Anything pending is never binding.
origin: agent
---

## Context

Text.
`;

const ACCEPTED = `---
id: ADR-0002
title: Only an accepted ADR is binding
status: accepted
date: 2026-11-18
tags: [workflow]
code:
  - core:src/view.ts
  - core:src/for-files.ts
review_rule: Anything pending is never binding.
---

## Context

Text.
`;

const FROZEN = 'ADR-0002 is accepted; its text is frozen. Supersede it with a new ADR.';
const ONLY_SUPERSEDED_OR_DEPRECATED = 'ADR-0002 is accepted; it may only become superseded or deprecated.';
const NO_LABEL = `This pull request changes decision files (${ADR}). Move them to a pull request labelled \`adr\`.`;
const NEVER_DELETED = `${ADR}: ADR files are never deleted or renamed; supersede instead`;
const cannotRead = (path: string) => `${path}: cannot read the file at base or head, so the change is refused`;

/** A change to ADR-0002 as the guard sees it: the base and head contents of the file. */
const modified = (base: string | null, head: string | null, path = ADR) => ({ status: 'M', path, base, head });
const withTitle = (text: string, title: string) => text.replace(/^title: .*$/m, `title: ${title}`);

test('without the adr label, any change under docs/decisions or the config fails and names the files', () => {
  expect(guardChanges({ adrLabel: false, changes: [modified(PROPOSED, `${PROPOSED}\nMore.\n`)] })).toEqual([NO_LABEL]);
  expect(
    guardChanges({
      adrLabel: false,
      changes: [
        { status: 'A', path: NEW, head: PROPOSED },
        { status: 'M', path: ADR, base: ACCEPTED, head: ACCEPTED.replace('Text.', 'Other.') },
      ],
    }),
  ).toEqual([
    `This pull request changes decision files (${NEW}, ${ADR}). Move them to a pull request labelled \`adr\`.`,
  ]);
  expect(
    guardChanges({ adrLabel: false, changes: [modified(CONFIG_TEXT, CONFIG_TEXT + 'tags: []\n', CONFIG)] }),
  ).toEqual([`This pull request changes decision files (${CONFIG}). Move them to a pull request labelled \`adr\`.`]);
});

test('with no changes, nothing fails whatever the label says', () => {
  expect(guardChanges({ adrLabel: false, changes: [] })).toEqual([]);
  expect(guardChanges({ adrLabel: true, changes: [] })).toEqual([]);
});

test('with the adr label, a new ADR file passes', () => {
  expect(guardChanges({ adrLabel: true, changes: [{ status: 'A', path: NEW, head: PROPOSED }] })).toEqual([]);
});

test('with the adr label, deleting or renaming an ADR file fails, whatever its status', () => {
  expect(guardChanges({ adrLabel: true, changes: [{ status: 'D', path: ADR }] })).toEqual([NEVER_DELETED]);
  expect(
    guardChanges({
      adrLabel: true,
      changes: [{ status: 'R100', oldPath: ADR, path: NEW, base: ACCEPTED, head: ACCEPTED }],
    }),
  ).toEqual([NEVER_DELETED]);
});

test('with the adr label, a proposed ADR may change in any way', () => {
  const rewritten = PROPOSED.replace('A proposed decision', 'Another title').replace('Text.', 'Rewritten.');
  expect(guardChanges({ adrLabel: true, changes: [modified(PROPOSED, rewritten)] })).toEqual([]);
});

test('an accepted ADR may move to superseded or deprecated, with its links and review date', () => {
  const superseded = ACCEPTED.replace('status: accepted', 'status: superseded')
    .replace(
      'review_rule:',
      'superseded_by: ADR-0031\nsupersedes: []\nrelated:\n  - ADR-0005\nreview_on: 2027-03-04\nreview_rule:',
    )
    .replace('Text.\n', 'Text.\n\n\n');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, superseded)] })).toEqual([]);
  const deprecated = ACCEPTED.replace('status: accepted', 'status: deprecated');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, deprecated)] })).toEqual([]);
  const contested = ACCEPTED.replace('review_rule:', 'contested: true\nreview_rule:');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, contested)] })).toEqual([]);
});

test('an accepted ADR may not move back to proposed or rejected', () => {
  for (const status of ['proposed', 'rejected']) {
    const head = ACCEPTED.replace('status: accepted', `status: ${status}`);
    expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, head)] })).toEqual([
      ONLY_SUPERSEDED_OR_DEPRECATED,
    ]);
  }
});

test('the status is compared as core parses it, so case and trailing comments do not hide a move', () => {
  const capital = ACCEPTED.replace('status: accepted', 'status: Accepted');
  expect(
    guardChanges({
      adrLabel: true,
      changes: [modified(capital, capital.replace('status: Accepted', 'status: proposed'))],
    }),
  ).toEqual([ONLY_SUPERSEDED_OR_DEPRECATED]);
  const comment = ACCEPTED.replace('status: accepted', 'status: accepted # reviewed');
  expect(guardChanges({ adrLabel: true, changes: [modified(comment, withTitle(comment, 'Other'))] })).toEqual([FROZEN]);
  const capitalTitle = capital.replace('Only an accepted ADR is binding', 'Something else');
  expect(guardChanges({ adrLabel: true, changes: [modified(capital, capitalTitle)] })).toEqual([FROZEN]);
});

test('an accepted ADR whose title, body, tags, date, review_rule or id changes is frozen', () => {
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, withTitle(ACCEPTED, 'Other'))] })).toEqual([
    FROZEN,
  ]);
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, ACCEPTED.replace('Text.', 'Edited.'))] })).toEqual(
    [FROZEN],
  );
  expect(
    guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, ACCEPTED.replace('[workflow]', '[format]'))] }),
  ).toEqual([FROZEN]);
  expect(
    guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, ACCEPTED.replace('2026-11-18', '2026-11-19'))] }),
  ).toEqual([FROZEN]);
  expect(
    guardChanges({
      adrLabel: true,
      changes: [modified(ACCEPTED, ACCEPTED.replace('Anything pending is never binding.', 'Anything goes.'))],
    }),
  ).toEqual([FROZEN]);
  expect(
    guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, ACCEPTED.replace('id: ADR-0002', 'id: ADR-0003'))] }),
  ).toEqual([FROZEN]);
});

test('an accepted ADR may not gain a deprecated_on or any other unlisted key', () => {
  const head = ACCEPTED.replace('status: accepted', 'status: deprecated\ndeprecated_on: 2026-12-01');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, head)] })).toEqual([FROZEN]);
  const origin = ACCEPTED.replace('review_rule:', 'origin: agent\nreview_rule:');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, origin)] })).toEqual([FROZEN]);
});

test('an accepted ADR may not change its components', () => {
  const head = ACCEPTED.replace('review_rule:', 'components:\n  - core\nreview_rule:');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, head)] })).toEqual([FROZEN]);
});

test('an accepted ADR may not change its code, not even by renaming a path', () => {
  const renamed = ACCEPTED.replace('  - core:src/for-files.ts', '  - core:src/other.ts');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, renamed)] })).toEqual([FROZEN]);
  const added = ACCEPTED.replace('  - core:src/for-files.ts', '  - core:src/for-files.ts\n  - core:src/extra.ts');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, added)] })).toEqual([FROZEN]);
});

test('a list item under an allowed key may change', () => {
  const base = ACCEPTED.replace('review_rule:', 'related:\n  - ADR-0005\nreview_rule:');
  const head = base.replace('  - ADR-0005', '  - ADR-0005\n  - ADR-0006');
  expect(guardChanges({ adrLabel: true, changes: [modified(base, head)] })).toEqual([]);
});

test('an ADR that cannot be parsed on either side fails', () => {
  const broken = ACCEPTED.replace('title: Only an accepted ADR is binding', 'title: [unclosed');
  const bad = guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, broken)] });
  expect(bad).toHaveLength(1);
  expect(bad[0]).toMatch(new RegExp(`^${ADR.replace(/[.]/g, '\\.')}: cannot be read`));
  expect(guardChanges({ adrLabel: true, changes: [modified(broken, ACCEPTED)] })).toHaveLength(1);
  expect(guardChanges({ adrLabel: true, changes: [modified(PROPOSED, broken)] })).toHaveLength(1);
});

test('a modified file whose text is missing on either side fails', () => {
  expect(guardChanges({ adrLabel: true, changes: [modified(PROPOSED, null)] })).toEqual([cannotRead(ADR)]);
  expect(guardChanges({ adrLabel: true, changes: [modified(null, PROPOSED)] })).toEqual([cannotRead(ADR)]);
});

test('with the adr label, a change to adrien.config.yaml passes unless adr_dir moves', () => {
  expect(
    guardChanges({ adrLabel: true, changes: [modified(CONFIG_TEXT, CONFIG_TEXT + 'tags: []\n', CONFIG)] }),
  ).toEqual([]);
  expect(
    guardChanges({
      adrLabel: true,
      changes: [modified(CONFIG_TEXT, CONFIG_TEXT.replace('docs/decisions', 'docs/other'), CONFIG)],
    }),
  ).toEqual([`${CONFIG}: adr_dir cannot change from docs/decisions to docs/other`]);
  expect(
    guardChanges({ adrLabel: true, changes: [{ status: 'D', path: CONFIG, base: CONFIG_TEXT, head: null }] }),
  ).toEqual([`${CONFIG}: a config file is never deleted or renamed`]);
  expect(guardChanges({ adrLabel: true, changes: [modified(CONFIG_TEXT, 'product: [oops', CONFIG)] })).toHaveLength(1);
});

test('with the adr label, id_format and components of adrien.config.yaml are frozen too', () => {
  const idFormat = CONFIG_TEXT.replace('ADR-{n:4}', 'ADR-{n:5}');
  expect(guardChanges({ adrLabel: true, changes: [modified(CONFIG_TEXT, idFormat, CONFIG)] })).toEqual([
    `${CONFIG}: id_format cannot change from ADR-{n:4} to ADR-{n:5}`,
  ]);
  const components = `${CONFIG_TEXT}components:\n  core:\n    root: packages/core\n`;
  const changed = guardChanges({ adrLabel: true, changes: [modified(CONFIG_TEXT, components, CONFIG)] });
  expect(changed).toHaveLength(1);
  expect(changed[0]).toMatch(/^adrien\.config\.yaml: components cannot change/);
});

test('with the adr label, the log, components and any comment of .adrien.yaml are judged by value', () => {
  const log = CODE_TEXT.replace('log: docs/decisions', 'log: docs/other');
  expect(guardChanges({ adrLabel: true, changes: [modified(CODE_TEXT, log, CODE_CONFIG)] })).toEqual([
    `${CODE_CONFIG}: log cannot change from docs/decisions to docs/other`,
  ]);
  const components = CODE_TEXT.replace('  - core', '  - core\n  - mcp');
  expect(guardChanges({ adrLabel: true, changes: [modified(CODE_TEXT, components, CODE_CONFIG)] })).toHaveLength(1);
  expect(
    guardChanges({ adrLabel: true, changes: [modified(CODE_TEXT, `# a note\n${CODE_TEXT}`, CODE_CONFIG)] }),
  ).toEqual([]);
});

test('a config file at any depth is guarded by its basename, case aside', () => {
  const nested = 'packages/core/adrien.config.yaml';
  const moved = CONFIG_TEXT.replace('docs/decisions', 'docs/other');
  expect(guardChanges({ adrLabel: true, changes: [modified(CONFIG_TEXT, moved, nested)] })).toEqual([
    `${nested}: adr_dir cannot change from docs/decisions to docs/other`,
  ]);
  expect(guardChanges({ adrLabel: false, changes: [modified(CODE_TEXT, CODE_TEXT, 'x/.adrien.yaml')] })).toEqual([
    'This pull request changes decision files (x/.adrien.yaml). Move them to a pull request labelled `adr`.',
  ]);
  const upper = 'Packages/X/Adrien.Config.yaml';
  expect(guardChanges({ adrLabel: true, changes: [modified(CONFIG_TEXT, moved, upper)] })).toEqual([
    `${upper}: adr_dir cannot change from docs/decisions to docs/other`,
  ]);
});

test('a config file cannot be added, at the root or nested', () => {
  expect(
    guardChanges({ adrLabel: true, changes: [{ status: 'A', path: 'packages/x/.adrien.yaml', head: CODE_TEXT }] }),
  ).toEqual(['packages/x/.adrien.yaml: a config file cannot be added']);
  expect(
    guardChanges({ adrLabel: true, changes: [{ status: 'C', path: 'packages/y/.adrien.yaml', head: CODE_TEXT }] }),
  ).toEqual(['packages/y/.adrien.yaml: a config file cannot be added']);
});

test('a nested config file that is deleted or renamed fails', () => {
  expect(
    guardChanges({
      adrLabel: true,
      changes: [{ status: 'D', path: 'packages/x/.adrien.yaml', base: CODE_TEXT, head: null }],
    }),
  ).toEqual(['packages/x/.adrien.yaml: a config file is never deleted or renamed']);
});

/**
 * A repository whose base commit has `base` files and whose feature branch then writes `feature` (null deletes).
 * `run(labels, env)` runs the guard with LABELS_JSON set to `labels`; HEAD is left on the feature branch.
 */
function repo(base: Record<string, string>, feature: Record<string, string | null>) {
  const root = tmpDir();
  const git = (...args: string[]) => {
    const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(run.stderr);
  };
  git('init', '-q', '-b', 'main');
  writeFiles(root, base);
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  for (const [file, text] of Object.entries(feature)) {
    if (text === null) git('rm', '-q', file);
    else writeFiles(root, { [file]: text });
  }
  git('add', '-A');
  git('commit', '-qm', 'feature');
  const run = (labels: string, env: Record<string, string> = {}) =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GUARD_BASE: 'main', LABELS_JSON: labels, ...env },
    });
  return { root, git, run };
}

test('the command exits 1 and explains a change made without the label, read from git', () => {
  const { run } = repo({ [ADR]: ACCEPTED }, { [ADR]: ACCEPTED.replace('Text.', 'Edited.') });
  const unlabelled = run('[]');
  expect(unlabelled.status).toBe(1);
  expect(unlabelled.stderr).toContain('Move them to a pull request labelled');
  const labelled = run('["adr"]');
  expect(labelled.status).toBe(1);
  expect(labelled.stderr).toContain(FROZEN);
});

test('the label is matched exactly: "ADR" or "adr-ish" is not the adr label', () => {
  const { run } = repo({ [ADR]: ACCEPTED }, { [ADR]: ACCEPTED.replace('status: accepted', 'status: superseded') });
  for (const labels of ['["ADR"]', '["adr-ish"]', '["adr "]', '[]']) {
    const result = run(labels);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Move them to a pull request labelled');
  }
  expect(run('["bug", "adr"]').status).toBe(0);
});

test('GUARD_HEAD names the head to check, so the guard can run with HEAD on the base', () => {
  const { git, run } = repo({ [ADR]: ACCEPTED }, { [ADR]: ACCEPTED.replace('Text.', 'Edited.') });
  git('checkout', '-q', 'main');
  expect(run('[]').status).toBe(0);
  const checked = run('[]', { GUARD_HEAD: 'feature' });
  expect(checked.status).toBe(1);
  expect(checked.stderr).toContain('Move them to a pull request labelled');
});

test('a non-ASCII file name is read from git with its real path, so an allowed move passes', () => {
  const file = 'docs/decisions/ADR-0009-café.md';
  const superseded = ACCEPTED.replace('ADR-0002', 'ADR-0009').replace(
    'status: accepted',
    'status: superseded\nsuperseded_by: ADR-0010',
  );
  const { run } = repo({ [file]: ACCEPTED.replace('ADR-0002', 'ADR-0009') }, { [file]: superseded });
  expect(run('["adr"]').status).toBe(0);
  expect(run('[]').status).toBe(1);
});

test('the decision directory is matched whatever the case of its path', () => {
  const file = 'Docs/Decisions/ADR-0002-only-an-accepted-adr-is-binding.md';
  const { run } = repo({ [file]: ACCEPTED }, { [file]: ACCEPTED.replace('Text.', 'Edited.') });
  const unlabelled = run('[]');
  expect(unlabelled.status).toBe(1);
  expect(unlabelled.stderr).toContain('Docs/Decisions/ADR-0002');
});

test('a change to the config is read from git and needs the label', () => {
  const { run } = repo({ [CONFIG]: CONFIG_TEXT }, { [CONFIG]: CONFIG_TEXT.replace('docs/decisions', 'docs/other') });
  expect(run('[]').stderr).toContain(CONFIG);
  const labelled = run('["adr"]');
  expect(labelled.status).toBe(1);
  expect(labelled.stderr).toContain('adr_dir cannot change from docs/decisions to docs/other');
});

test('a nested .adrien.yaml is found by git at any depth, and its components are frozen', () => {
  const file = 'packages/x/.adrien.yaml';
  const { run } = repo({ [file]: CODE_TEXT }, { [file]: CODE_TEXT.replace('  - core', '  - core\n  - mcp') });
  expect(run('[]').stderr).toContain(file);
  const labelled = run('["adr"]');
  expect(labelled.status).toBe(1);
  expect(labelled.stderr).toContain('packages/x/.adrien.yaml: components cannot change');
});
