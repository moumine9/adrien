import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { loadLogConfig } from '@adrien/core';
import { adrText, configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { runCli } from '../src/program.ts';

/** A common log `shared` (workspace `shared`) and a product `acme` whose accepted ADR-0002 refers to ADR-0009 of it. */
function logs() {
  const root = tmpDir();
  const home = tmpDir();
  writeFiles(root, {
    'shared/adrien.config.yaml': configYaml({ product: 'Shared Co', workspace: 'shared' }),
    'shared/docs/adr/ADR-0009-shared.md': adrText({
      id: 'ADR-0009',
      title: 'Shared rule',
      status: 'accepted',
      components: ['web'],
      review_rule: 'Shared rule applies.',
    }),
    'product/adrien.config.yaml': configYaml({ product: 'Acme', workspace: 'acme', common: '../shared' }),
    'product/docs/adr/ADR-0002-use-it.md': adrText({
      id: 'ADR-0002',
      title: 'Use it',
      status: 'accepted',
      review_rule: 'Use it.',
      related: ['shared/ADR-0009'],
    }),
  });
  const shared = join(root, 'shared');
  const product = join(root, 'product');
  const run = (cwd: string, ...argv: string[]) => runCli(argv, { cwd, env: { ADRIEN_HOME: home } });
  return { root, shared, product, run };
}

/** The text of every file under `root`, outside `.adrien`. */
function snapshot(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const rel of readdirSync(root, { recursive: true, encoding: 'utf8' })) {
    if (rel.includes('.adrien')) continue;
    const full = join(root, rel);
    if (statSync(full).isFile()) files[rel] = readFileSync(full, 'utf8');
  }
  return files;
}

test('--dry-run prints the plan and writes nothing', async () => {
  const { root, shared, product, run } = logs();
  const before = snapshot(root);
  const result = await run(shared, '--log', `${shared};${product}`, 'rename-workspace', 'house', '--dry-run');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Would rename workspace shared -> house');
  expect(result.stdout).toContain('ADR-0002-use-it.md: related shared/ADR-0009 -> house/ADR-0009');
  expect(snapshot(root)).toEqual(before);
});

test('renames the log and the references of the products that name it, and says which logs were not checked', async () => {
  const { shared, product, run } = logs();
  const result = await run(shared, '--log', `${shared};${product}`, '--json', 'rename-workspace', 'house');
  expect(result.code).toBe(0);
  const out = JSON.parse(result.stdout);
  expect(out).toMatchObject({ from: 'shared', to: 'house', applied: true });
  expect(out.references).toEqual([
    expect.objectContaining({ field: 'related', from: 'shared/ADR-0009', to: 'house/ADR-0009' }),
  ]);
  expect(out.notes).toContain(
    'Logs not listed in ADRIEN_LOG or --also were not checked: references to shared there keep the old name and show as unresolved-ref.',
  );
  expect(loadLogConfig(shared).workspace).toBe('house');
  expect(readFileSync(join(product, 'docs/adr/ADR-0002-use-it.md'), 'utf8')).toContain('house/ADR-0009');
});

test('the name of an instance override is ignored: the old name is the log own name', async () => {
  const { shared, product, run } = logs();
  const result = await run(shared, '--log', `legacy=${shared};acme=${product}`, 'rename-workspace', 'house');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Renamed workspace shared -> house');
  expect(readFileSync(join(product, 'docs/adr/ADR-0002-use-it.md'), 'utf8')).toContain('house/ADR-0009');
  expect(result.stdout).not.toContain('still names');
});

test('an ADRIEN_LOG entry that still uses the old name is reported', async () => {
  const { shared, product, run } = logs();
  const result = await run(shared, '--log', `shared=${shared};acme=${product}`, 'rename-workspace', 'house');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(`ADRIEN_LOG still names ${shared} "shared"`);
  expect(result.stdout).toContain('until that entry is "house="');
});

test('an invalid new name is refused with exit 2 and nothing is written', async () => {
  const { root, shared, run } = logs();
  const before = snapshot(root);
  const result = await run(shared, 'rename-workspace', 'Bad Name');
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('"Bad Name" is not a valid workspace name');
  expect(snapshot(root)).toEqual(before);
});

test('--also reaches a product outside ADRIEN_LOG, for a normal rename', async () => {
  const { shared, product, run } = logs();
  const result = await run(shared, '--log', shared, '--json', 'rename-workspace', 'house', '--also', '../product');
  expect(result.code).toBe(0);
  expect(JSON.parse(result.stdout).references).toEqual([
    expect.objectContaining({ field: 'related', from: 'shared/ADR-0009', to: 'house/ADR-0009' }),
  ]);
  expect(readFileSync(join(product, 'docs/adr/ADR-0002-use-it.md'), 'utf8')).toContain('house/ADR-0009');
});

test('--also skips a log listed twice, a log already in ADRIEN_LOG, and the renamed log itself', async () => {
  const { shared, product, run } = logs();
  const listed = await run(
    shared,
    '--log',
    `${shared};${product}`,
    '--json',
    'rename-workspace',
    'house',
    '--dry-run',
    '--also',
    product,
    '--also',
    '.',
  );
  expect(JSON.parse(listed.stdout).references).toHaveLength(1);
  const twice = await run(
    shared,
    '--log',
    shared,
    '--json',
    'rename-workspace',
    'house',
    '--dry-run',
    '--also',
    '../product',
    '--also',
    product,
    '--also',
    '.',
  );
  expect(JSON.parse(twice.stdout).references).toHaveLength(1);
});

/** The logs of `logs()` after the common log was renamed to `house`, as a run from it leaves them: the product still names `shared`. */
function renamedElsewhere() {
  const made = logs();
  writeFiles(made.root, { 'shared/adrien.config.yaml': configYaml({ product: 'Shared Co', workspace: 'house' }) });
  return made;
}

test('--from catches up a product renamed elsewhere, rewriting its references and nothing else', async () => {
  const { root, product, run } = renamedElsewhere();
  const before = snapshot(root);
  const result = await run(product, 'rename-workspace', 'house', '--from', 'shared');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Updated references to shared: shared -> house');
  expect(result.stdout).toContain('ADR-0002-use-it.md: related shared/ADR-0009 -> house/ADR-0009');
  expect(result.stdout).not.toContain('workspace is now');
  const after = snapshot(root);
  expect(Object.keys(after).filter((rel) => after[rel] !== before[rel])).toEqual([
    'product/docs/adr/ADR-0002-use-it.md',
  ]);
});

test('--from --json reports file as null', async () => {
  const { product, run } = renamedElsewhere();
  const result = await run(product, '--json', 'rename-workspace', 'house', '--from', 'shared');
  expect(result.code).toBe(0);
  const out = JSON.parse(result.stdout);
  expect(out).toMatchObject({ from: 'shared', to: 'house', applied: true, file: null });
  expect(out.references).toHaveLength(1);
});

test('--from --dry-run says what it would update and writes nothing', async () => {
  const { root, product, run } = renamedElsewhere();
  const before = snapshot(root);
  const result = await run(product, 'rename-workspace', 'house', '--from', 'shared', '--dry-run');
  expect(result.stdout).toContain('Would update references to shared: shared -> house');
  expect(snapshot(root)).toEqual(before);
});

test('a normal rename notes the logs in other repositories that still name the old name', async () => {
  const { shared, run } = logs();
  const result = await run(shared, '--log', shared, 'rename-workspace', 'house');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain(
    'Note: A log in another repository that names shared keeps it until you run `adrien rename-workspace house --from shared` in it, once its common log is named house.',
  );
});

test('--from says so when no reference names the old name', async () => {
  const { product, run } = renamedElsewhere();
  const first = await run(product, 'rename-workspace', 'house', '--from', 'shared');
  expect(first.code).toBe(0);
  const again = await run(product, 'rename-workspace', 'house', '--from', 'shared');
  expect(again.code).toBe(0);
  expect(again.stdout).toContain('No references to shared found.');
});
