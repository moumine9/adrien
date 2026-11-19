import { readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE } from '@adrien/core';
import { adrText, configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { initRepo } from '../../core/test/helpers/git.ts';
import { runCli } from '../src/program.ts';

const ADR = 'docs/adr/ADR-0001-storage.md';

function logDir(): string {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    [ADR]: adrText({ id: 'ADR-0001', title: 'Storage' }),
  });
  return root;
}

const run = (cwd: string, argv: string[]) => runCli(argv, { cwd, env: { ADRIEN_HOME: join(tmpDir(), '.home') } });

test('backup create copies the decision files and reports the folder; list shows it', async () => {
  const root = logDir();
  const created = await run(root, ['backup', 'create', '--reason', 'before upgrade']);
  expect(created).toMatchObject({ code: 0, stderr: '' });
  expect(created.stdout).toMatch(/^Backed up 2 files to .*\.adrien[\\/]backups[\\/]\d{8}-\d{6}-before-upgrade/);

  const listed = await run(root, ['--json', 'backup', 'list']);
  const backups = JSON.parse(listed.stdout) as Array<{ reason: string; fileCount: number }>;
  expect(backups).toEqual([expect.objectContaining({ reason: 'before-upgrade', fileCount: 2 })]);
});

test('backup create defaults its reason to manual, and list says so when there is none', async () => {
  const root = logDir();
  expect((await run(root, ['backup', 'list'])).stdout).toBe('No backups yet.\n');
  await run(root, ['backup', 'create']);
  const [backup] = JSON.parse((await run(root, ['--json', 'backup', 'list'])).stdout) as Array<{ reason: string }>;
  expect(backup?.reason).toBe('manual');
  expect((await run(root, ['backup', 'list'])).stdout).toMatch(/^\d{8}-\d{6}-manual {2}.* 2 files {2}manual\n$/);
});

test('backup verify says the files are unchanged, then lists what changed and exits 1', async () => {
  const root = logDir();
  const id = JSON.parse((await run(root, ['--json', 'backup', 'create'])).stdout).id as string;

  expect(await run(root, ['backup', 'verify', id])).toMatchObject({
    code: 0,
    stdout: 'Decision files unchanged.\n',
  });

  writeFileSync(join(root, ADR), 'edited');
  const changed = await run(root, ['backup', 'verify', id]);
  expect(changed.code).toBe(1);
  expect(changed.stdout).toContain(`changed: ${ADR}`);
  expect(JSON.parse((await run(root, ['--json', 'backup', 'verify', id])).stdout)).toEqual({
    changed: [ADR],
    missing: [],
    added: [],
  });
});

test('backup restore puts the files back and reports the ones it left in place', async () => {
  const root = logDir();
  const id = JSON.parse((await run(root, ['--json', 'backup', 'create'])).stdout).id as string;
  const original = readFileSync(join(root, ADR), 'utf8');
  writeFileSync(join(root, ADR), 'damaged');
  writeFiles(root, { 'docs/adr/ADR-0002-later.md': adrText({ id: 'ADR-0002', title: 'Later' }) });

  const restored = await run(root, ['backup', 'restore', id]);
  expect(restored).toMatchObject({ code: 0, stderr: '' });
  expect(restored.stdout).toContain('Restored 2 files');
  expect(restored.stdout).toContain('left in place: docs/adr/ADR-0002-later.md');
  expect(readFileSync(join(root, ADR), 'utf8')).toBe(original);
  expect(JSON.parse((await run(root, ['--json', 'backup', 'list'])).stdout)).toHaveLength(2);
});

test('--json restore prints the result', async () => {
  const root = logDir();
  const id = JSON.parse((await run(root, ['--json', 'backup', 'create'])).stdout).id as string;
  const result = JSON.parse((await run(root, ['--json', 'backup', 'restore', id])).stdout);
  expect(result).toMatchObject({ id, restored: [CONFIG_FILE, ADR].sort(), leftover: [] });
});

test('backup commands outside a decision log fail with the usual message', async () => {
  const result = await run(tmpDir(), ['backup', 'list']);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('No Adrien log found');
});

test.skipIf(process.platform === 'win32')('backup create says which links it skipped', async () => {
  const root = logDir();
  symlinkSync(tmpDir(), join(root, 'docs/adr/linked'));
  const created = await run(root, ['backup', 'create']);
  expect(created.stdout).toContain('Skipped 1 entry that is not a regular file: docs/adr/linked');
});

test('backup list marks a backup it cannot read as damaged', async () => {
  const root = logDir();
  await run(root, ['backup', 'create']);
  writeFiles(root, { '.adrien/backups/broken/manifest.json': '{not json' });
  expect((await run(root, ['backup', 'list'])).stdout).toContain('broken  damaged');
  const backups = JSON.parse((await run(root, ['--json', 'backup', 'list'])).stdout) as Array<{ status: string }>;
  expect(backups.filter((b) => b.status === 'damaged')).toHaveLength(1);
});

test('backup create and restore refuse a read-only clone of the log', async () => {
  const root = logDir();
  const { origin } = initRepo(root, { origin: true });
  const args = ['--log', `file://${origin}`];
  const created = await run(root, [...args, 'backup', 'create']);
  expect(created.code).toBe(2);
  expect(created.stderr).toContain('read-only cached clone');
  const restored = await run(root, [...args, 'backup', 'restore', 'anything']);
  expect(restored.stderr).toContain('read-only cached clone');
});

test('backup verify and restore refuse an unknown id', async () => {
  const root = logDir();
  expect(await run(root, ['backup', 'verify', 'nope'])).toMatchObject({ code: 2 });
  expect((await run(root, ['backup', 'restore', 'nope'])).stderr).toContain('No backup "nope"');
});

test('backup restore brings back a config that was deleted, from the folder or by naming it with --log', async () => {
  const root = logDir();
  const id = JSON.parse((await run(root, ['--json', 'backup', 'create'])).stdout).id as string;

  rmSync(join(root, CONFIG_FILE));
  const found = await run(root, ['backup', 'restore', id]);
  expect(found).toMatchObject({ code: 0, stderr: '' });
  expect(readFileSync(join(root, CONFIG_FILE), 'utf8')).toBe(configYaml());

  writeFileSync(join(root, CONFIG_FILE), 'product: [broken');
  const named = await run(tmpDir(), ['--log', root, 'backup', 'restore', id]);
  expect(named).toMatchObject({ code: 0, stderr: '' });
  expect(readFileSync(join(root, CONFIG_FILE), 'utf8')).toBe(configYaml());
});

test('backup restore outside any log still says there is no log', async () => {
  const result = await run(tmpDir(), ['backup', 'restore', 'x']);
  expect(result.code).toBe(2);
  expect(result.stderr).toContain('No Adrien log found');
});
