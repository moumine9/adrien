import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE } from '@adrien/core';
import { adrText, configYaml, sharedLog, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { git, initRepo } from '../../core/test/helpers/git.ts';
import { runCli, VERSION } from '../src/program.ts';

function run(cwd: string, ...argv: string[]) {
  return runCli(argv, { cwd, env: { ADRIEN_HOME: join(cwd, '.home') } });
}

function log(files: Record<string, string> = {}): string {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), ...files });
  return root;
}

test('adrien for labels a common log decision with its workspace; an unreadable common log is a note', async () => {
  const root = log({
    'apps/web/src/a.ts': 'export {};\n',
    [CONFIG_FILE]: configYaml({ common: sharedLog() }),
  });
  const result = await run(root, 'for', 'apps/web/src/a.ts');
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    'apps/web/src/a.ts [web]\n  [shared-co] ADR-0009 BINDING Shared rule\n    rule: Shared rule applies.\n',
  );

  const missing = join(root, 'no-such-log');
  const broken = await run(log({ [CONFIG_FILE]: configYaml({ common: missing }) }), 'for', 'README.md');
  expect(broken.stderr).toContain(`note: The common log at ${missing} could not be read`);
});

test('--version prints the package version', async () => {
  const result = await run(tmpDir(), '--version');
  expect(result).toMatchObject({ code: 0, stdout: `${VERSION}\n` });
});

test('init writes the config and prints the setup hint; a second init exits 2', async () => {
  const root = tmpDir();
  const first = await run(root, 'init', '--product', 'acme');
  expect(first.code).toBe(0);
  expect(first.stdout).toBe(
    [
      'Created adrien.config.yaml (product: acme, workspace: acme).',
      'Next:',
      '  1. Add to CODEOWNERS:   docs/adr/ @your-architects-group',
      '  2. GitLab Premium+: Settings > Repository > Protected branches > require Code Owner approval on the default branch.',
      '  3. In each code repo: adrien init --code-repo --log <path|url> && adrien init --agents',
      '',
    ].join('\n'),
  );
  expect(existsSync(join(root, 'docs/adr/.gitkeep'))).toBe(true);
  expect(readFileSync(join(root, CONFIG_FILE), 'utf8')).toContain('- security');

  const second = await run(root, 'init', '--product', 'acme');
  expect(second.code).toBe(2);
  expect(second.stderr).toContain('already exists');
});

test('init names the workspace after the product unless --workspace overrides it', async () => {
  const derived = tmpDir();
  expect((await run(derived, 'init', '--product', 'Acme Billing')).code).toBe(0);
  expect(readFileSync(join(derived, CONFIG_FILE), 'utf8')).toMatch(/^product: Acme Billing\nworkspace: acme-billing\n/);

  const overridden = tmpDir();
  const result = await run(overridden, 'init', '--product', 'Acme Billing', '--workspace', 'billing');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('Created adrien.config.yaml (product: Acme Billing, workspace: billing).');
  expect(readFileSync(join(overridden, CONFIG_FILE), 'utf8')).toMatch(/^product: Acme Billing\nworkspace: billing\n/);
});

test('init rejects an invalid --workspace and a product name that yields no workspace', async () => {
  const invalid = tmpDir();
  const bad = await run(invalid, 'init', '--product', 'acme', '--workspace', 'Acme Core');
  expect(bad.code).toBe(2);
  expect(bad.stderr).toContain('lowercase letters');
  expect(existsSync(join(invalid, CONFIG_FILE))).toBe(false);

  const underivable = tmpDir();
  const none = await run(underivable, 'init', '--product', '!!!');
  expect(none.code).toBe(2);
  expect(none.stderr).toContain('Could not derive a workspace name from the product name; pass --workspace <name>.');
  expect(existsSync(join(underivable, CONFIG_FILE))).toBe(false);
});

test('new creates the file; list shows it; list --json parses', async () => {
  const root = log();
  const created = await run(root, 'new', 'Use Postgres', '--tags', 'backend,database');
  expect(created).toMatchObject({ code: 0, stdout: 'Created ADR-0001 docs/adr/ADR-0001-use-postgres.md (proposed)\n' });

  const listed = await run(root, 'list');
  expect(listed.stdout).toBe('ADR-0001  proposed    backend,database  Use Postgres\n');

  const json = JSON.parse((await run(root, '--json', 'list', '--tag', 'database')).stdout);
  expect(json).toMatchObject([{ id: 'ADR-0001', status: 'proposed', layer: 'base' }]);
});

test('new with a near-duplicate title exits 1 with "Possible duplicates"', async () => {
  const root = log();
  await run(root, 'new', 'Use PostgreSQL for the persistence layer');
  const dup = await run(root, 'new', 'Use PostgreSQL for persistence');
  expect(dup.code).toBe(1);
  expect(dup.stdout).toContain('Possible duplicates:');
  expect(dup.stdout).toContain('ADR-0001');
  expect(dup.stdout).toContain('Use --force to create anyway.');
});

test('search postgres finds it', async () => {
  const root = log();
  await run(root, 'new', 'Use Postgres');
  expect((await run(root, 'search', 'postgres')).stdout).toContain('ADR-0001');
});

test('for <file> shows a common decision an accepted exception exempts as EXEMPT, by the exception', async () => {
  const root = log({
    'apps/web/src/a.ts': 'export {};\n',
    'docs/adr/ADR-0001-a.md': adrText({
      id: 'ADR-0001',
      title: 'Local exception',
      status: 'accepted',
      components: ['web'],
      exception_to: ['shared-co/ADR-0009'],
      review_on: '2027-03-04',
      review_rule: 'Local rule applies.',
    }),
    [CONFIG_FILE]: configYaml({ common: sharedLog() }),
  });
  const result = await run(root, 'for', 'apps/web/src/a.ts');
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    [
      'apps/web/src/a.ts [web]',
      '  ADR-0001 BINDING Local exception',
      '    rule: Local rule applies.',
      '  [shared-co] ADR-0009 EXEMPT (by ADR-0001) Shared rule',
      '    rule: Shared rule applies.',
      '',
    ].join('\n'),
  );
});

test('for <file> in a monorepo prints the BINDING ADR and its rule', async () => {
  const root = log({
    'apps/web/src/a.ts': 'export {};\n',
    'docs/adr/ADR-0001-a.md': adrText({
      id: 'ADR-0001',
      title: 'Render dates in the user locale',
      status: 'accepted',
      code: ['web:src/**'],
      review_rule: 'Format dates with the locale helper.',
    }),
  });
  const result = await run(root, 'for', 'apps/web/src/a.ts', 'README.md');
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    [
      'apps/web/src/a.ts [web]',
      '  ADR-0001 BINDING Render dates in the user locale',
      '    rule: Format dates with the locale helper.',
      'README.md',
      '  (not inside a linked component)',
      '',
    ].join('\n'),
  );
});

test('check exits 0 with "0 errors" on a clean log and 1 on a broken one', async () => {
  const clean = await run(log({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) }), 'check');
  expect(clean).toMatchObject({ code: 0, stdout: '0 errors, 0 warnings\n' });

  const broken = await run(
    log({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', tags: ['ghost'] }) }),
    'check',
  );
  expect(broken.code).toBe(1);
  expect(broken.stdout).toContain('error  unknown-tag  ADR-0001');
  expect(broken.stdout).toContain('1 errors, 0 warnings');
});

test('show prints the ADR and fails with exit 2 on an unknown id', async () => {
  const root = log({ 'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A' }) });
  expect((await run(root, 'show', 'ADR-0001')).stdout).toContain('title: A');
  const missing = await run(root, 'show', 'ADR-0099');
  expect(missing.code).toBe(2);
  expect(missing.stderr).toBe('adrien: No ADR ADR-0099 in the log\n');
});

test('outside any config: exit 2 with the init hint and no stack trace', async () => {
  const result = await run(tmpDir(), 'list');
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('adrien init');
  expect(result.stderr).not.toMatch(/\n\s+at /);
});

test('new --template picks the body skeleton; an unknown template exits 2', async () => {
  const root = log();
  await run(root, 'new', 'Small decision', '--template', 'minimal');
  expect(readFileSync(join(root, 'docs/adr/ADR-0001-small-decision.md'), 'utf8')).toContain(
    '\n## Context\n\n## Decision\n\n## Consequences\n',
  );
  const bad = await run(root, 'new', 'Other decision', '--template', 'fancy');
  expect(bad.code).toBe(2);
  expect(bad.stderr).toContain('standard, minimal, madr');
});

const sloppy = adrText(
  { id: 'ADR-0001', title: 'A' },
  '\n## Context\n\nWe store invoices.\n\n##Decision\n\nUse Postgres.\n',
);

test('lint reports style warnings and still exits 0; --strict makes them fail', async () => {
  const root = log({ 'docs/adr/ADR-0001-a.md': sloppy });
  const result = await run(root, 'lint');
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('warning  markdown  ADR-0001');
  expect(result.stdout).toContain('MD018 no-missing-space-atx');
  expect(result.stdout).toContain('0 errors, 1 warnings');
  expect((await run(root, 'lint', '--strict')).code).toBe(1);
});

test('check only reports style with --lint', async () => {
  const root = log({ 'docs/adr/ADR-0001-a.md': sloppy });
  expect((await run(root, 'check')).stdout).toBe('0 errors, 0 warnings\n');
  expect((await run(root, 'check', '--lint')).stdout).toContain('markdown  ADR-0001');
});

test('lint --json lists the diagnostics', async () => {
  const root = log({ 'docs/adr/ADR-0001-a.md': sloppy });
  const json = JSON.parse((await run(root, '--json', 'lint')).stdout);
  expect(json).toMatchObject({ errors: 0, warnings: 1, diagnostics: [{ code: 'markdown', id: 'ADR-0001' }] });
});

test('new --review-on records the date, and check flags it once it has passed', async () => {
  const root = log();
  const created = await run(root, 'new', 'Revisit this', '--review-on', '2020-01-01', '--review-rule', 'A rule.');
  expect(created.code).toBe(0);
  expect(readFileSync(join(root, 'docs/adr/ADR-0001-revisit-this.md'), 'utf8')).toContain('review_on: 2020-01-01');
  expect((await run(root, 'check')).stdout).toContain('warning  review-due  ADR-0001');
  expect((await run(root, 'new', 'Bad date', '--review-on', 'soon')).code).toBe(2);
});

test('export prints the index, writes it with --out using links relative to the file, and rejects a bad format', async () => {
  const root = log({
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', status: 'accepted', review_rule: 'Rule.' }),
  });
  expect((await run(root, 'export')).stdout).toContain('| [ADR-0001](docs/adr/ADR-0001-a.md) | A | accepted |');
  expect((await run(root, 'export', '--format', 'llms')).stdout).toContain(
    '- [ADR-0001: A](docs/adr/ADR-0001-a.md): Rule.',
  );

  const written = await run(root, 'export', '--out', 'docs/index.md');
  expect(written.stdout).toBe('Wrote docs/index.md\n');
  expect(readFileSync(join(root, 'docs/index.md'), 'utf8')).toContain('[ADR-0001](adr/ADR-0001-a.md)');
  expect((await run(root, 'export', '--format', 'pdf')).code).toBe(2);
});

test('for says so when no default branch can be found, and still lists the decisions', async () => {
  const root = log({
    'apps/web/src/a.ts': 'export {};\n',
    'docs/adr/ADR-0001-a.md': adrText({
      id: 'ADR-0001',
      title: 'Render dates in the user locale',
      status: 'accepted',
      code: ['web:src/**'],
      review_rule: 'Use the helper.',
    }),
  });
  initRepo(root);
  git(root, 'branch', '-m', 'trunk');
  const result = await run(root, 'for', 'apps/web/src/a.ts');
  expect(result.stdout).toContain('ADR-0001 BINDING');
  expect(result.stderr).toMatch(/^note: No default branch/);
  expect((await run(log(), 'for', 'README.md')).stderr).toBe('');
});
