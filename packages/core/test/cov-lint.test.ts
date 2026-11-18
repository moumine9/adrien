import { vi } from 'vitest';
import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { lintAdrs } from '../src/lint.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';

vi.mock('markdownlint/promise', () => ({ lint: async () => ({}) }));

test('Adrien still checks an ADR when markdownlint returns no entry for its path', async () => {
  const dir = tmpDir();
  const path = 'docs/adr/ADR-0001-policy.md';
  writeFiles(dir, {
    [CONFIG_FILE]: configYaml(),
    [path]: adrText({ id: 'ADR-0001', title: 'Policy', status: 'accepted' }, '\n## 1. Context\n\nUse a cache.\n'),
  });
  const ctx = await resolveContext({ cwd: dir, env: {} });
  const view = await loadLogView(dir, ctx.config);
  expect(await lintAdrs(ctx, view)).toEqual([
    expect.objectContaining({ code: 'numbered-heading', id: 'ADR-0001', path }),
  ]);
});
