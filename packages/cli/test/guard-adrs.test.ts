import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { guardChanges } from '../../../scripts/guard-adrs.mjs';
import { tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';

const script = fileURLToPath(new URL('../../../scripts/guard-adrs.mjs', import.meta.url));
const ADR = 'docs/decisions/ADR-0002-only-an-accepted-adr-is-binding.md';
const NEW = 'docs/decisions/ADR-0030-a-new-decision.md';

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
const NO_LABEL = `This pull request changes decision files (${ADR}). Move them to a pull request labelled \`adr\`.`;
const NEVER_DELETED = `${ADR}: ADR files are never deleted or renamed; supersede instead`;

/** A change to ADR-0002 as the guard sees it: the base and head contents of the file. */
const modified = (base: string, head: string) => ({ status: 'M', path: ADR, base, head });

test('without the adr label, any change under docs/decisions fails and names the files', () => {
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
  ).toEqual([`${ADR}: ADR files are never deleted or renamed; supersede instead`]);
});

test('with the adr label, a proposed ADR may change in any way', () => {
  const rewritten = PROPOSED.replace('A proposed decision', 'Another title').replace('Text.', 'Rewritten.');
  expect(guardChanges({ adrLabel: true, changes: [modified(PROPOSED, rewritten)] })).toEqual([]);
});

test('an accepted ADR may change its status and links, and trailing blank lines', () => {
  const head = ACCEPTED.replace('status: accepted', 'status: superseded')
    .replace('review_rule:', 'superseded_by: ADR-0031\nrelated:\n  - ADR-0005\nreview_rule:')
    .replace('Text.\n', 'Text.\n\n\n');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, head)] })).toEqual([]);
  const deprecated = ACCEPTED.replace('status: accepted', 'status: deprecated\ndeprecated_on: 2026-12-01');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, deprecated)] })).toEqual([]);
});

test('an accepted ADR whose title changes is frozen', () => {
  const head = ACCEPTED.replace('Only an accepted ADR is binding', 'Something else');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, head)] })).toEqual([FROZEN]);
});

test('an accepted ADR whose body changes is frozen', () => {
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, ACCEPTED.replace('Text.', 'Edited.'))] })).toEqual(
    [FROZEN],
  );
});

test('an accepted ADR whose review_rule or id changes is frozen', () => {
  const rule = ACCEPTED.replace('Anything pending is never binding.', 'Anything goes.');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, rule)] })).toEqual([FROZEN]);
  const id = ACCEPTED.replace('id: ADR-0002', 'id: ADR-0003');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, id)] })).toEqual([FROZEN]);
});

test('a list item under a frozen key is part of that key, so changing it is frozen', () => {
  const head = ACCEPTED.replace('  - core:src/for-files.ts', '  - core:src/other.ts');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, head)] })).toEqual([FROZEN]);
});

test('a list item under an allowed key may change', () => {
  const base = ACCEPTED.replace('review_rule:', 'related:\n  - ADR-0005\nreview_rule:');
  const head = base.replace('  - ADR-0005', '  - ADR-0005\n  - ADR-0006');
  expect(guardChanges({ adrLabel: true, changes: [modified(base, head)] })).toEqual([]);
});

test('the frozen message names the ADR from the base when the head has no id', () => {
  const head = ACCEPTED.replace('Text.', 'Edited.').replace('id: ADR-0002\n', '');
  expect(guardChanges({ adrLabel: true, changes: [modified(ACCEPTED, head)] })).toEqual([FROZEN]);
});

test('the command exits 1 and explains a change made without the label, read from git', () => {
  const root = tmpDir();
  const git = (...args: string[]) => {
    const run = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
      cwd: root,
      encoding: 'utf8',
    });
    if (run.status !== 0) throw new Error(run.stderr);
  };
  git('init', '-q', '-b', 'main');
  writeFiles(root, { [ADR]: ACCEPTED });
  git('add', '-A');
  git('commit', '-qm', 'base');
  git('checkout', '-qb', 'feature');
  writeFiles(root, { [ADR]: ACCEPTED.replace('Text.', 'Edited.') });
  git('commit', '-qam', 'feature');

  const run = (label: string) =>
    spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, GUARD_BASE: 'main', ADR_LABEL: label },
    });

  const unlabelled = run('false');
  expect(unlabelled.status).toBe(1);
  expect(unlabelled.stderr).toContain('Move them to a pull request labelled');
  const labelled = run('true');
  expect(labelled.status).toBe(1);
  expect(labelled.stderr).toContain(FROZEN);
});
