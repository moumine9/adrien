import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { exportLog } from '../src/export.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { initRepo } from './helpers/git.ts';

test('pending decisions are exported in numeric ID order even when filenames sort differently', async () => {
  const dir = tmpDir();
  writeFiles(dir, { [CONFIG_FILE]: configYaml() });
  initRepo(dir);
  writeFiles(dir, {
    'docs/adr/a.md': adrText({ id: 'ADR-10', title: 'Later' }),
    'docs/adr/z.md': adrText({ id: 'ADR-2', title: 'Earlier' }),
  });
  const ctx = await resolveContext({ cwd: dir, env: {} });
  const text = exportLog(ctx, await loadLogView(dir, ctx.config), 'llms');
  expect(text.split('\n').filter((line) => line.startsWith('- '))).toEqual([
    '- [ADR-2: Earlier](docs/adr/z.md) (added)',
    '- [ADR-10: Later](docs/adr/a.md) (added)',
  ]);
});
