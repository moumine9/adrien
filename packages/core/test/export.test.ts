import { join } from 'node:path';
import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { exportLog } from '../src/export.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';

async function load() {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    'docs/adr/ADR-0002-b.md': adrText({
      id: 'ADR-0002',
      title: 'Cache | reads',
      status: 'accepted',
      tags: ['backend'],
      review_rule: 'Reads go through the cache.',
    }),
    'docs/adr/ADR-0010-c.md': adrText({ id: 'ADR-0010', title: 'Try queues', tags: ['infra', 'backend'] }),
    'docs/adr/ADR-0001-a.md': adrText({ id: 'ADR-0001', title: 'Old way', status: 'superseded' }),
  });
  const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: tmpDir() } });
  return { ctx, view: await loadLogView(ctx.logRoot, ctx.config) };
}

test('the markdown index lists every ADR in id order, with links and escaped pipes', async () => {
  const { ctx, view } = await load();
  expect(exportLog(ctx, view, 'markdown')).toBe(
    [
      '# acme: architecture decisions',
      '',
      '| ID | Title | Status | Tags |',
      '| --- | --- | --- | --- |',
      '| [ADR-0001](docs/adr/ADR-0001-a.md) | Old way | superseded |  |',
      '| [ADR-0002](docs/adr/ADR-0002-b.md) | Cache \\| reads | accepted | backend |',
      '| [ADR-0010](docs/adr/ADR-0010-c.md) | Try queues | proposed | infra, backend |',
      '',
    ].join('\n'),
  );
});

test('links are relative to where the index will be written', async () => {
  const { ctx, view } = await load();
  expect(exportLog(ctx, view, 'markdown', { from: join(ctx.logRoot, 'sub') })).toContain(
    '[ADR-0002](../docs/adr/ADR-0002-b.md)',
  );
});

test('the llms.txt export has the accepted decisions with their rule, then the proposed, and no retired ones', async () => {
  const { ctx, view } = await load();
  expect(exportLog(ctx, view, 'llms')).toBe(
    [
      '# acme',
      '',
      '> Architecture decisions for acme. Before changing code, follow the rule of every accepted decision that governs it.',
      '',
      '## Accepted',
      '',
      '- [ADR-0002: Cache | reads](docs/adr/ADR-0002-b.md): Reads go through the cache.',
      '',
      '## Proposed (not yet binding)',
      '',
      '- [ADR-0010: Try queues](docs/adr/ADR-0010-c.md)',
      '',
    ].join('\n'),
  );
});
