import { CONFIG_FILE } from '@adrien/core';
import { adrText, configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { commitAll, git, initRepo } from '../../core/test/helpers/git.ts';
import { runCli } from '../src/program.ts';

const GOVERNED = 'apps/web/src/x.ts';

/**
 * One repo that is both the ADR log and a code repo: the `web` component is this repo's `apps/web`. With `origin`, a
 * pushed remote whose origin/HEAD is main, so the default branch resolves.
 */
function repo(origin = true) {
  const root = tmpDir();
  const home = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/ADR-0001-invoices.md': adrText({
      id: 'ADR-0001',
      title: 'Invoices in decimal',
      status: 'accepted',
      tags: ['backend'],
      components: ['web'],
      code: ['web:src/**'],
      review_rule: 'Use decimal, never float.',
    }),
    [GOVERNED]: 'export const x = 1;\n',
    'README.md': '# Readme\n',
  });
  initRepo(root, { origin });
  return { root, run: (...argv: string[]) => runCli(argv, { cwd: root, env: { ADRIEN_HOME: home } }) };
}

test('--files names the governing decision and its rule, and exits 0', async () => {
  const { run } = repo();
  const result = await run('review', '--files', GOVERNED);
  expect(result.code).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout.startsWith('<!-- adrien-review -->\n')).toBe(true);
  expect(result.stdout).toContain(
    '**ADR-0001** Invoices in decimal\nRule: Use decimal, never float.\nGoverns: `apps/web/src/x.ts`\n',
  );
});

test('--base and --head review what a branch changes, and the default base gives the same answer', async () => {
  const { root, run } = repo();
  git(root, 'checkout', '-q', '-b', 'feature');
  writeFiles(root, { [GOVERNED]: 'export const x = 2;\n' });
  commitAll(root, 'change x');
  const explicit = await run('review', '--base', 'main', '--head', 'feature');
  expect(explicit.code).toBe(0);
  expect(explicit.stdout).toContain('**ADR-0001** Invoices in decimal\n');
  expect(explicit.stdout).toContain('Governs: `apps/web/src/x.ts`\n');

  const implicit = await run('review');
  expect(implicit).toMatchObject({ code: 0, stdout: explicit.stdout });
});

test('a branch that changes no governed file says that no decision governs it', async () => {
  const { root, run } = repo();
  git(root, 'checkout', '-q', '-b', 'docs');
  writeFiles(root, { 'README.md': '# Readme, edited\n' });
  commitAll(root, 'edit readme');
  const result = await run('review');
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(
    [
      '<!-- adrien-review -->',
      '',
      'No recorded decision governs the files in this change.',
      '',
      'Adrien informs, it never blocks. Only accepted decisions on the default branch are binding.',
      '',
    ].join('\n'),
  );
});

test('a base that does not exist exits 2 with the reason', async () => {
  const { run } = repo();
  const result = await run('review', '--base', 'no-such-ref');
  expect(result).toMatchObject({ code: 2, stdout: '' });
  expect(result.stderr).toBe(
    'adrien: Could not list the changed files between no-such-ref and HEAD: check that both refs exist.\n',
  );
});

test('without a resolvable default branch, review exits 2 and asks for --base', async () => {
  const { root, run } = repo(false);
  git(root, 'branch', '-m', 'main', 'trunk');
  const result = await run('review');
  expect(result).toMatchObject({
    code: 2,
    stdout: '',
    stderr: 'adrien: No default branch found to compare with: pass --base <ref>.\n',
  });
  const explicit = await run('review', '--base', 'trunk');
  expect(explicit.code).toBe(0);
  expect(explicit.stderr).toMatch(/^note: No default branch was found/);
});

test('--files with no resolvable default branch still exits 0, and notes it on stderr', async () => {
  const { root, run } = repo(false);
  git(root, 'branch', '-m', 'main', 'trunk');
  const result = await run('review', '--files', GOVERNED);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('**ADR-0001** Invoices in decimal\n');
  expect(result.stderr).toMatch(/^note: No default branch was found/);
});

test('outside git, review needs --files and exits 2', async () => {
  const root = tmpDir();
  const home = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'A', status: 'accepted', review_rule: 'R.' }),
  });
  const result = await runCli(['review'], { cwd: root, env: { ADRIEN_HOME: home } });
  expect(result).toMatchObject({
    code: 2,
    stderr: 'adrien: Not inside a git repository: pass --files <paths...> instead.\n',
  });
});

test('--json prints the counts, the markdown and the decisions per file', async () => {
  const { run } = repo();
  const result = await run('--json', 'review', '--files', GOVERNED, 'README.md');
  expect(result.code).toBe(0);
  const data = JSON.parse(result.stdout);
  expect(Object.keys(data)).toEqual(['binding', 'hints', 'files', 'markdown', 'decisions']);
  expect(data).toMatchObject({
    binding: 1,
    hints: 0,
    files: 2,
    decisions: [
      {
        file: GOVERNED,
        component: 'web',
        decisions: [{ id: 'ADR-0001', binding: true, layer: 'base', review_rule: 'Use decimal, never float.' }],
      },
      { file: 'README.md', component: null, decisions: [] },
    ],
  });
  expect(data.markdown).toContain('**ADR-0001** Invoices in decimal\n');
});

test('an unverified base is said in the comment itself, where a CI reader will see it', async () => {
  const { root, run } = repo(false);
  git(root, 'branch', '-m', 'trunk'); // no origin and no main or master: the default branch cannot be found
  const result = await run('review', '--files', GOVERNED);
  expect(result.code).toBe(0);
  expect(result.stdout).toContain('> Note: No default branch was found');
});

test('a verified base adds no note to the comment', async () => {
  const { run } = repo(true);
  expect((await run('review', '--files', GOVERNED)).stdout).not.toContain('> Note:');
});
