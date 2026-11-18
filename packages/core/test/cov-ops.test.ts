import { CONFIG_FILE } from '../src/config.ts';
import { resolveContext } from '../src/context.ts';
import { readWorkingLog } from '../src/log.ts';
import { acceptAdr, createAdr, renumber, setStatus, updateAdr } from '../src/ops.ts';
import { loadLogView } from '../src/view.ts';
import { adrText, configYaml, tmpDir, writeFiles } from './helpers/fixtures.ts';
import { git, initRepo } from './helpers/git.ts';

async function setup() {
  const root = tmpDir();
  writeFiles(root, { [CONFIG_FILE]: configYaml() });
  const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: tmpDir() } });
  return { root, ctx, view: await loadLogView(root, ctx.config) };
}

test('creation validates review dates, components and code anchors', async () => {
  const { ctx, view } = await setup();
  const create = (input: Parameters<typeof createAdr>[2]) => createAdr(ctx, view, input);
  expect(() => create({ title: 'A', review_on: 'tomorrow' })).toThrow('must be a date');
  expect(() => create({ title: 'A', components: ['missing'] })).toThrow('Unknown component(s): missing');
  expect(() => create({ title: 'A', code: ['bad', 'missing:path'] })).toThrow('Invalid anchor(s): bad, missing:path');
  const input = {
    title: 'Storage',
    review_rule: 'Check schema',
    components: ['web'],
    code: ['web:src/**'],
    sources: ['design'],
    related: ['ADR-0010'],
    body: 'Decision',
    origin: 'agent' as const,
  };
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-05-01T22:00:00Z'));
    expect(create(input)).toMatchObject({
      written: true,
      adr: {
        body: input.body,
        meta: {
          title: input.title,
          review_rule: input.review_rule,
          components: input.components,
          code: input.code,
          sources: input.sources,
          related: input.related,
          origin: 'agent',
          date: '2026-05-01',
        },
      },
    });
  } finally {
    vi.useRealTimers();
  }
  expect(acceptAdr(ctx, view, 'ADR-0001', { today: '2026-06-10' }).meta.date).toBe('2026-05-01');
  expect(
    updateAdr(
      ctx,
      view,
      'ADR-0001',
      { body: 'Replacement' },
      { origin: 'manual', note: 'verified', today: '2026-06-10' },
    ).body,
  ).toBe('Replacement\n\n> Proposed change (manual, 2026-06-10): verified\n');
});

test('operations report missing and ambiguous ids and enforce status transitions', async () => {
  const { root, ctx, view } = await setup();
  const id = 'ADR-0001';
  expect(() => updateAdr(ctx, view, id, {})).toThrow('No ADR ADR-0001');
  expect(() => renumber(ctx, view, id)).toThrow('No ADR ADR-0001');
  // External callers can pass an unsupported status at runtime.
  expect(() => Reflect.apply(setStatus, undefined, [ctx, view, id, 'accepted'])).toThrow('adrien accept');
  const text = adrText({ id, title: 'A' });
  writeFiles(root, { 'docs/adr/1-a.md': text, 'docs/adr/1-b.md': text });
  expect(() => updateAdr(ctx, view, id, {})).toThrow('docs/adr/1-a.md, docs/adr/1-b.md');
  expect(() => renumber(ctx, view, id)).toThrow('Say which file to renumber');
});

test('renumber follows supersession links, preserves other ids and skips deletions', async () => {
  const { root, ctx } = await setup();
  const id = 'ADR-0001';
  writeFiles(root, { 'docs/adr/3-gone.md': adrText({ id: 'ADR-0003', title: 'Gone' }) });
  initRepo(root);
  git(root, 'rm', 'docs/adr/3-gone.md');
  writeFiles(root, {
    'docs/adr/1-a.md': adrText({ id, title: 'A' }),
    'docs/adr/2-b.md': adrText({ id: 'ADR-0002', title: 'B', superseded_by: id, related: [id, 'ADR-0005'] }),
  });
  const view = await loadLogView(root, ctx.config);
  expect(renumber(ctx, view, id).to).toBe('ADR-0004');
  expect(readWorkingLog(root, ctx.config).adrs.find((a) => a.meta.id === 'ADR-0002')?.meta).toMatchObject({
    superseded_by: 'ADR-0004',
    related: ['ADR-0004', 'ADR-0005'],
  });
});
