import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CODE_CONFIG_FILE, CONFIG_FILE } from '@adrien/core';
import { adrText, configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { commitAll, git, initRepo } from '../../core/test/helpers/git.ts';
import { AGENTS_SNIPPET } from '../src/commands/init.ts';
import { runCli } from '../src/program.ts';

const BILLING_URL = 'https://gitlab.example.com/acme/billing-service.git';

function runIn(cwd: string, home: string, ...argv: string[]) {
  return runCli(argv, { cwd, env: { ADRIEN_HOME: home } });
}

function log(files: Record<string, string> = {}): {
  root: string;
  run: (...argv: string[]) => ReturnType<typeof runCli>;
} {
  const root = tmpDir();
  const home = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml(), ...files });
  return { root, run: (...argv) => runIn(root, home, ...argv) };
}

const ready = (id: string, title: string) => adrText({ id, title, tags: ['backend'], review_rule: 'A rule.' });

test('accept flips status and prints the merge reminder', async () => {
  const { run } = log({ 'docs/adr/ADR-0001-a.md': ready('ADR-0001', 'A') });
  const result = await run('accept', 'ADR-0001');
  expect(result).toMatchObject({
    code: 0,
    stdout: 'ADR-0001 accepted. Commit and open/merge the MR: merging is the approval.\n',
  });
  expect((await run('show', 'ADR-0001')).stdout).toContain('status: accepted');
});

test('status superseded is refused with the supersede hint; accepted is routed to accept', async () => {
  const { run } = log({ 'docs/adr/ADR-0001-a.md': ready('ADR-0001', 'A') });
  const refused = await run('status', 'ADR-0001', 'superseded');
  expect(refused.code).toBe(2);
  expect(refused.stderr).toBe('adrien: Use `adrien supersede <old> --by <new>`.\n');

  expect((await run('status', 'ADR-0001', 'rejected')).stdout).toBe('ADR-0001 rejected\n');
  expect((await run('status', 'ADR-0001', 'bogus')).code).toBe(2);
  const accepted = await run('status', 'ADR-0001', 'accepted');
  expect(accepted.stdout).toContain('ADR-0001 accepted. Commit and open/merge the MR');
});

test('supersede links both ADRs; check is clean afterwards', async () => {
  const { run } = log({
    'docs/adr/ADR-0001-a.md': ready('ADR-0001', 'Old way'),
    'docs/adr/ADR-0002-b.md': ready('ADR-0002', 'New way'),
  });
  const result = await run('supersede', 'ADR-0001', '--by', 'ADR-0002');
  expect(result).toMatchObject({ code: 0, stdout: 'ADR-0001 superseded by ADR-0002.\n' });
  expect(await run('check')).toMatchObject({ code: 0, stdout: '0 errors, 0 warnings\n' });
});

test('renumber resolves a duplicate id', async () => {
  const { root, run } = log({ 'docs/adr/ADR-0001-a.md': ready('ADR-0001', 'A') });
  initRepo(root, { origin: true });
  writeFiles(root, { 'docs/adr/ADR-0001-dup.md': ready('ADR-0001', 'Dup') });
  expect((await run('check')).stdout).toContain('duplicate-id');

  const result = await run('renumber', 'ADR-0001');
  expect(result).toMatchObject({ code: 0, stdout: 'Renumbered ADR-0001 -> ADR-0002 (docs/adr/ADR-0002-dup.md)\n' });
  expect((await run('check')).code).toBe(0);
});

test('init --code-repo then for resolves through .adrien.yaml', async () => {
  const decisions = tmpDir();
  writeFiles(decisions, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/ADR-0001-a.md': adrText({
      id: 'ADR-0001',
      title: 'Invoices in decimal',
      status: 'accepted',
      review_rule: 'Use decimal.',
      code: ['billing-service:src/**'],
    }),
  });
  const code = tmpDir();
  writeFiles(code, { 'src/a.ts': 'export {};\n' });
  git(code, 'init', '-q');
  git(code, 'remote', 'add', 'origin', BILLING_URL);
  const home = tmpDir();

  const init = await runIn(code, home, 'init', '--code-repo', '--log', decisions);
  expect(init.code).toBe(0);
  expect(init.stdout).toContain(`Created ${CODE_CONFIG_FILE}`);
  expect(readFileSync(join(code, CODE_CONFIG_FILE), 'utf8')).toContain(`log: ${decisions}`);

  const found = await runIn(code, home, 'for', 'src/a.ts');
  expect(found.stdout).toContain('ADR-0001 BINDING Invoices in decimal');

  const again = await runIn(code, home, 'init', '--code-repo', '--log', decisions);
  expect(again.code).toBe(2);
  expect(again.stderr).toContain('already exists');
});

test('init --code-repo without --log, or pointing at no log, exits 2 and writes nothing', async () => {
  const code = tmpDir();
  const home = tmpDir();
  expect((await runIn(code, home, 'init', '--code-repo')).code).toBe(2);
  const missing = await runIn(code, home, 'init', '--code-repo', '--log', join(tmpDir(), 'nowhere'));
  expect(missing.code).toBe(2);
  expect(existsSync(join(code, CODE_CONFIG_FILE))).toBe(false);
});

test('init --agents twice leaves one block and keeps the rest of the file', async () => {
  const root = tmpDir();
  const home = tmpDir();
  writeFiles(root, { 'AGENTS.md': '# Repo rules\n\nBe kind.\n' });
  await runIn(root, home, 'init', '--agents');
  await runIn(root, home, 'init', '--agents');
  const text = readFileSync(join(root, 'AGENTS.md'), 'utf8');
  expect(text.split('<!-- adrien:start -->')).toHaveLength(2);
  expect(text).toContain('# Repo rules\n\nBe kind.\n');
  expect(text).toContain(AGENTS_SNIPPET);
  expect(AGENTS_SNIPPET).toContain("Never set an ADR's status to `accepted` yourself.");
});

test('init --agents creates AGENTS.md and tips about CLAUDE.md only when it does not read AGENTS.md', async () => {
  const fresh = tmpDir();
  const home = tmpDir();
  const created = await runIn(fresh, home, 'init', '--agents');
  expect(readFileSync(join(fresh, 'AGENTS.md'), 'utf8')).toBe(`${AGENTS_SNIPPET}\n`);
  expect(created.stdout).not.toContain('Tip:');

  const plain = tmpDir();
  writeFiles(plain, { 'CLAUDE.md': '# Claude\n' });
  expect((await runIn(plain, home, 'init', '--agents')).stdout).toContain(
    'Tip: add "@AGENTS.md" to CLAUDE.md so Claude Code reads it.',
  );

  const wired = tmpDir();
  writeFiles(wired, { 'CLAUDE.md': '@AGENTS.md\n' });
  expect((await runIn(wired, home, 'init', '--agents')).stdout).not.toContain('Tip:');
});

/** A decisions repo with a pushed origin, and a code repo whose .adrien.yaml points at that origin's URL. */
function cachedLog() {
  const decisions = tmpDir();
  writeFiles(decisions, { [CONFIG_FILE]: configYaml(), 'docs/adr/ADR-0001-a.md': ready('ADR-0001', 'A') });
  const { origin } = initRepo(decisions, { origin: true });
  const url = pathToFileURL(origin ?? '').href;
  const code = tmpDir();
  writeFiles(code, { [CODE_CONFIG_FILE]: `log: ${url}\n` });
  const home = tmpDir();
  return { origin: origin ?? '', url, run: (...argv: string[]) => runIn(code, home, ...argv) };
}

test('accept on a read-only cached log exits 2 with the READ_ONLY_LOG message', async () => {
  const { run } = cachedLog();
  const result = await run('accept', 'ADR-0001');
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('read-only cached clone');
});

test('sync on a cached clone picks up a new upstream ADR', async () => {
  const { origin, url, run } = cachedLog();
  expect((await run('list')).stdout).toContain('ADR-0001');

  const other = tmpDir();
  git(other, 'clone', '-q', origin, '.');
  writeFiles(other, { 'docs/adr/ADR-0002-b.md': ready('ADR-0002', 'B') });
  commitAll(other, 'add ADR-0002');
  git(other, 'push', '-q', 'origin', 'main');

  expect((await run('list')).stdout).not.toContain('ADR-0002');
  const synced = await run('sync');
  expect(synced.code).toBe(0);
  expect(synced.stdout).toMatch(new RegExp(`^Log ${url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} at \\S+\n$`));
  expect((await run('list')).stdout).toContain('ADR-0002');
});

test('sync on a cached clone whose origin is gone exits 2 and says so', async () => {
  const { origin, run } = cachedLog();
  await run('list');
  rmSync(origin, { recursive: true, force: true });
  const result = await run('sync');
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('Could not fetch');
  expect(result.stdout).toBe('');
});

test('sync on a local log fetches origin and reports the base ref', async () => {
  const { root, run } = log({ 'docs/adr/ADR-0001-a.md': ready('ADR-0001', 'A') });
  initRepo(root, { origin: true });
  const result = await run('sync');
  expect(result.code).toBe(0);
  expect(result.stdout).toBe(`Log ${root} at origin/main\n`);
});
