import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { adrsForFiles } from '../src/for-files.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { initRepo } from './helpers/git.ts';

test('equally specific proposals sort by ID then layer and omit unrelated additions', async () => {
  const dir = tmpDir();
  const proposal = (id: string, title: string, component = 'web') => adrText({ id, title, components: [component] });
  writeFiles(dir, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/a.md': proposal('ADR-0002', 'Assets'),
    'docs/adr/b.md': proposal('ADR-0001', 'Caching'),
  });
  initRepo(dir);
  writeFiles(dir, {
    'docs/adr/a.md': proposal('ADR-0002', 'Static assets'),
    'docs/adr/c.md': proposal('ADR-0003', 'Invoice storage', 'billing-service'),
  });
  const ctx = await resolveContext({ cwd: dir, env: {} });
  const view = await loadLogView(dir, ctx.config);
  const [result] = adrsForFiles(ctx, view, ['apps/web/index.ts']);
  expect(result?.decisions.map((d) => [d.id, d.title, d.layer, d.pending_kind])).toEqual([
    ['ADR-0001', 'Caching', 'base', null],
    ['ADR-0002', 'Assets', 'base', 'modified'],
    ['ADR-0002', 'Static assets', 'pending', 'modified'],
  ]);
});
