import { runCheck } from '../src/check.ts';
import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';

test('a replacement must list the retired decision in supersedes', async () => {
  const dir = tmpDir();
  writeFiles(dir, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/old.md': adrText({
      id: 'ADR-0001',
      title: 'Old policy',
      status: 'superseded',
      superseded_by: 'ADR-0002',
    }),
    'docs/adr/new.md': adrText({ id: 'ADR-0002', title: 'New policy' }),
  });
  const ctx = await resolveContext({
    cwd: dir,
    env: { ADRIEN_HOME: tmpDir(), ADRIEN_REPOS: `unconfigured=${tmpDir()}` },
  });
  expect(await runCheck(ctx, await loadLogView(dir, ctx.config))).toEqual([
    expect.objectContaining({
      code: 'supersede-asymmetry',
      id: 'ADR-0001',
      message: expect.stringContaining('ADR-0002 does not list it in supersedes'),
    }),
  ]);
});

test('--here skips external anchors when invoked outside a code checkout', async () => {
  const dir = tmpDir();
  writeFiles(dir, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/web.md': adrText({ id: 'ADR-0001', title: 'Assets', code: ['web:missing.ts'] }),
  });
  const ctx = await resolveContext({ cwd: tmpDir(), log: dir, env: {} });
  expect(ctx.codeRepo).toBeNull();
  expect(await runCheck(ctx, await loadLogView(dir, ctx.config), { here: true })).toEqual([]);
});
