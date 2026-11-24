import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONFIG_FILE, lintAdrs, loadLogView, resolveContext } from '@adrien/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { adrText, configYaml, sharedLog, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';
import { git, initRepo } from '../../core/test/helpers/git.ts';
import { createAdrienServer, type ServerOptions } from '../src/server.ts';

const rule = 'Format dates with the locale helper.';
const governed = adrText(
  {
    id: 'ADR-0001',
    title: 'Render dates in the user locale',
    status: 'accepted',
    tags: ['frontend'],
    components: ['web'],
    code: ['web:src/**'],
    review_rule: rule,
  },
  '\n## Context\n\nDates were shown in UTC.\n\n## Decision\n\nRender dates in the user locale.\n',
);

function monorepo(files: Record<string, string> = {}): string {
  const root = tmpDir();
  writeFiles(root, {
    [CONFIG_FILE]: configYaml(),
    'apps/web/src/a.ts': 'export {};\n',
    'docs/adr/ADR-0001-dates.md': governed,
    ...files,
  });
  return root;
}

async function connect(opts: Partial<ServerOptions> & { cwd: string }) {
  const server = createAdrienServer({ env: { ADRIEN_HOME: tmpDir() }, today: () => '2026-11-17', ...opts });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientSide);
  onTestFinished(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text: string }[])[0]?.text ?? '';
  // biome-ignore lint/suspicious/noExplicitAny: tool output is untyped JSON and each test asserts its own shape
  return { isError: result.isError === true, structured: result.structuredContent as any, text };
}

/** The revision an agent gets from adr_get before it changes an ADR. */
const revisionOf = async (client: Client, id: string) =>
  (await call(client, 'adr_get', { id })).structured.revision as string;

test('lists exactly the six tools', async () => {
  const client = await connect({ cwd: monorepo() });
  const { tools } = await client.listTools();
  expect(tools.map((t) => t.name).sort()).toEqual([
    'adr_for_files',
    'adr_get',
    'adr_list',
    'adr_propose',
    'adr_propose_change',
    'adr_search',
  ]);
});

test('no write tool can set status or origin, and no tool input has an origin', async () => {
  const client = await connect({ cwd: monorepo() });
  const { tools } = await client.listTools();
  const keys = (schema: unknown): string[] => {
    if (Array.isArray(schema)) return schema.flatMap(keys);
    if (schema && typeof schema === 'object') {
      return Object.entries(schema).flatMap(([k, v]) => [k, ...keys(v)]);
    }
    return [];
  };
  for (const tool of tools) {
    const inputKeys = keys(tool.inputSchema.properties);
    expect(inputKeys, `${tool.name} must not accept an origin`).not.toContain('origin');
    // status is a read filter on adr_search / adr_list only; the tools that write must never take it
    if (tool.name === 'adr_propose' || tool.name === 'adr_propose_change') {
      expect(inputKeys, `${tool.name} must not accept a status`).not.toContain('status');
    }
  }
});

test('adr_propose tells an agent when not to write an ADR', async () => {
  const client = await connect({ cwd: monorepo() });
  const { tools } = await client.listTools();
  const description = tools.find((t) => t.name === 'adr_propose')?.description ?? '';
  expect(description).toContain('Do not propose');
  expect(description).toContain('adr_search');
  expect(description).toContain('adr_for_files');
});

test('the server tells agents never to accept', async () => {
  const client = await connect({ cwd: monorepo(), version: '9.9.9' });
  expect(client.getServerVersion()).toMatchObject({ name: 'adrien', version: '9.9.9' });
  expect(client.getInstructions()).toContain('adr_for_files');
  expect(client.getInstructions()).toContain("Never set an ADR's status to `accepted` yourself.");
});

test('adr_for_files returns the binding ADR with its review_rule', async () => {
  const client = await connect({ cwd: monorepo() });
  const { structured, isError } = await call(client, 'adr_for_files', { paths: ['apps/web/src/a.ts'] });
  expect(isError).toBe(false);
  expect(structured.files).toHaveLength(1);
  expect(structured.files[0]).toMatchObject({
    file: 'apps/web/src/a.ts',
    component: 'web',
    decisions: [{ id: 'ADR-0001', binding: true, layer: 'base', review_rule: rule }],
  });
});

test('adr_for_files carries a note when no default branch can be found, and none otherwise', async () => {
  const plain = await call(await connect({ cwd: monorepo() }), 'adr_for_files', { paths: ['apps/web/src/a.ts'] });
  expect(plain.structured.notes).toBeUndefined();

  const root = monorepo();
  initRepo(root);
  git(root, 'branch', '-m', 'trunk');
  const unresolved = await call(await connect({ cwd: root }), 'adr_for_files', { paths: ['apps/web/src/a.ts'] });
  expect(unresolved.structured.notes).toHaveLength(1);
  expect(unresolved.structured.notes[0]).toContain('No default branch');
  expect(unresolved.structured.files[0].decisions[0]).toMatchObject({ id: 'ADR-0001', binding: true });
});

test('adr_for_files shows the accepted decisions of the common log, with its workspace', async () => {
  const common = sharedLog();
  const client = await connect({ cwd: monorepo({ [CONFIG_FILE]: configYaml({ common }) }) });
  const { structured } = await call(client, 'adr_for_files', { paths: ['apps/web/src/a.ts'] });
  expect(structured.notes).toBeUndefined();
  expect(structured.files[0].decisions).toEqual([
    expect.objectContaining({ id: 'ADR-0001', workspace: null }),
    expect.objectContaining({
      id: 'ADR-0009',
      workspace: 'shared-co',
      binding: true,
      review_rule: 'Shared rule applies.',
    }),
  ]);
});

test('adr_for_files with an unreadable common log keeps its own decisions and adds a note', async () => {
  const missing = join(tmpDir(), 'no-such-log');
  const client = await connect({ cwd: monorepo({ [CONFIG_FILE]: configYaml({ common: missing }) }) });
  const { structured } = await call(client, 'adr_for_files', { paths: ['apps/web/src/a.ts'] });
  expect(structured.files[0].decisions).toEqual([expect.objectContaining({ id: 'ADR-0001', workspace: null })]);
  expect(structured.notes).toBeUndefined();
  expect(structured.common_notes).toEqual([expect.stringContaining(missing)]);
});

test('adr_for_files puts a common log without a default branch in common_notes, not notes', async () => {
  const common = sharedLog();
  initRepo(common);
  git(common, 'branch', '-m', 'trunk');
  const client = await connect({ cwd: monorepo({ [CONFIG_FILE]: configYaml({ common }) }) });
  const { structured } = await call(client, 'adr_for_files', { paths: ['apps/web/src/a.ts'] });
  expect(structured.notes).toBeUndefined();
  expect(structured.common_notes).toEqual([expect.stringContaining('In the common log "shared-co": ')]);
});

test('adr_search, adr_list and adr_get read the log', async () => {
  const client = await connect({ cwd: monorepo() });
  expect(
    (await call(client, 'adr_search', { query: 'dates' })).structured.results.map((r: { id: string }) => r.id),
  ).toEqual(['ADR-0001']);
  expect((await call(client, 'adr_list', { tags: ['frontend'] })).structured.results).toHaveLength(1);
  expect((await call(client, 'adr_list', { tags: ['database'] })).structured.results).toEqual([]);
  const got = (await call(client, 'adr_get', { id: 'ADR-0001' })).structured;
  expect(got).toMatchObject({ id: 'ADR-0001', base: { meta: { review_rule: rule } }, pending: null });
  const missing = await call(client, 'adr_get', { id: 'ADR-0099' });
  expect(missing).toMatchObject({ isError: true, text: 'ADR_NOT_FOUND: No ADR ADR-0099 in the log' });
});

const proposal = {
  title: 'Cache invoices in Redis',
  context: 'Invoice reads dominate the load.',
  decision: 'Cache rendered invoices in Redis for 5 minutes.',
  rationale: 'It removes the hot path without a schema change.',
  review_rule: 'Invoice reads go through the cache helper.',
  tags: ['backend'],
};

test('adr_propose writes status proposed, origin agent, with the sections filled', async () => {
  const root = monorepo();
  const client = await connect({ cwd: root });
  const { structured, isError } = await call(client, 'adr_propose', proposal);
  expect(isError).toBe(false);
  expect(structured).toMatchObject({ written: true, id: 'ADR-0002' });
  const text = readFileSync(join(root, ...structured.path.split('/')), 'utf8');
  expect(text).toContain('status: proposed');
  expect(text).toContain('origin: agent');
  expect(text).toContain('## Context\n\nInvoice reads dominate the load.\n');
  expect(text).toContain('## Decision\n\nCache rendered invoices in Redis for 5 minutes.\n');
  expect(text).toContain('## Considered options\n');
});

test('adr_propose records exception_to and review_on', async () => {
  const root = monorepo();
  const client = await connect({ cwd: root });
  const { structured } = await call(client, 'adr_propose', {
    ...proposal,
    exception_to: ['shared/ADR-0009'],
    review_on: '2027-06-01',
  });
  const text = readFileSync(join(root, ...structured.path.split('/')), 'utf8');
  expect(text).toContain('exception_to: [shared/ADR-0009]');
  expect(text).toContain('review_on: 2027-06-01');
});

test('two adr_propose calls in flight at once get distinct ids and both files survive', async () => {
  const root = monorepo();
  const client = await connect({ cwd: root });
  const [a, b] = await Promise.all([
    call(client, 'adr_propose', proposal),
    call(client, 'adr_propose', { ...proposal, title: 'Retry failed webhooks with backoff' }),
  ]);
  expect([a.structured.id, b.structured.id].sort()).toEqual(['ADR-0002', 'ADR-0003']);
  expect(readFileSync(join(root, ...a.structured.path.split('/')), 'utf8')).toContain('Cache invoices in Redis');
  expect(readFileSync(join(root, ...b.structured.path.split('/')), 'utf8')).toContain('Retry failed webhooks');
});

test('what adr_propose and adr_propose_change write lints clean', async () => {
  const root = monorepo();
  const client = await connect({ cwd: root });
  await call(client, 'adr_propose', { ...proposal, options: 'Redis\nMemcached', consequences: 'One more service.' });
  await call(client, 'adr_propose_change', {
    id: 'ADR-0001',
    base_revision: await revisionOf(client, 'ADR-0001'),
    patch: { review_rule: 'Use Intl.DateTimeFormat.' },
    rationale: 'The helper was removed.',
  });
  const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: tmpDir() } });
  expect(await lintAdrs(ctx, await loadLogView(ctx.logRoot, ctx.config))).toEqual([]);
});

test('adr_propose on a near-duplicate returns written:false; force:true writes', async () => {
  const client = await connect({ cwd: monorepo() });
  await call(client, 'adr_propose', proposal);
  const again = await call(client, 'adr_propose', { ...proposal, title: 'Cache invoices in Redis cache' });
  expect(again.isError).toBe(false);
  expect(again.structured.written).toBe(false);
  expect(again.structured.duplicates[0]).toMatchObject({ id: 'ADR-0002' });
  const forced = await call(client, 'adr_propose', {
    ...proposal,
    title: 'Cache invoices in Redis cache',
    force: true,
  });
  expect(forced.structured).toMatchObject({ written: true, id: 'ADR-0003' });
});

test("after adr_propose_change, adr_for_files shows base binding:true and the agent's version binding:false", async () => {
  const root = monorepo();
  initRepo(root, { origin: true });
  const client = await connect({ cwd: root });
  const changed = await call(client, 'adr_propose_change', {
    id: 'ADR-0001',
    base_revision: await revisionOf(client, 'ADR-0001'),
    patch: { review_rule: 'Always use Intl.DateTimeFormat.' },
    rationale: 'The locale helper was removed.',
  });
  expect(changed.structured).toMatchObject({ id: 'ADR-0001', pending: true });

  const { structured } = await call(client, 'adr_for_files', { paths: ['apps/web/src/a.ts'] });
  const decisions = structured.files[0].decisions;
  expect(decisions).toMatchObject([
    { id: 'ADR-0001', binding: true, layer: 'base', review_rule: rule },
    { id: 'ADR-0001', binding: false, layer: 'pending', review_rule: 'Always use Intl.DateTimeFormat.' },
  ]);
  const body = readFileSync(join(root, 'docs/adr/ADR-0001-dates.md'), 'utf8');
  expect(body).toContain('> Proposed change (agent, 2026-11-17): The locale helper was removed.');
});

test('adr_propose_change rejects a status in the patch', async () => {
  const client = await connect({ cwd: monorepo() });
  const result = await call(client, 'adr_propose_change', {
    id: 'ADR-0001',
    base_revision: await revisionOf(client, 'ADR-0001'),
    patch: { status: 'deprecated' },
    rationale: 'trying to sneak in a status',
  });
  expect(result.isError).toBe(true);
});

test('unknown tag → isError text lists allowed tags', async () => {
  const client = await connect({ cwd: monorepo() });
  const result = await call(client, 'adr_propose', { ...proposal, tags: ['ghost'] });
  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/^INVALID_INPUT: Unknown tag\(s\): ghost\. Allowed: frontend, backend/);
});

test('read-only cached log → isError READ_ONLY_LOG', async () => {
  const decisions = monorepo();
  const { origin } = initRepo(decisions, { origin: true });
  const client = await connect({ cwd: tmpDir(), log: pathToFileURL(origin ?? '').href });
  const result = await call(client, 'adr_propose', proposal);
  expect(result.isError).toBe(true);
  expect(result.text).toMatch(/^READ_ONLY_LOG: /);
  expect((await call(client, 'adr_list')).structured.results).toHaveLength(1);
});

test('adr_get returns the revision of the working copy, to base a change on', async () => {
  const client = await connect({ cwd: monorepo() });
  expect(await revisionOf(client, 'ADR-0001')).toMatch(/^[0-9a-f]{12}$/);
});

test('adr_propose_change needs the revision that was read: without it the call is refused, naming adr_get', async () => {
  const client = await connect({ cwd: monorepo() });
  const result = await call(client, 'adr_propose_change', {
    id: 'ADR-0001',
    patch: { review_rule: 'Use the helper.' },
    rationale: 'A reason.',
  });
  expect(result.isError).toBe(true);
  expect(result.text).toContain('Call adr_get first');
  expect(result.text).toMatch(/^INVALID_INPUT: Call adr_get first and pass its `revision` as base_revision/);
});

test('adr_propose_change on a stale revision fails with ADR_CONFLICT and writes nothing; reading again and redoing it works', async () => {
  const root = monorepo();
  const client = await connect({ cwd: root });
  const stale = await revisionOf(client, 'ADR-0001');
  // Another agent, or the CLI, changes the same ADR first.
  const first = await call(client, 'adr_propose_change', {
    id: 'ADR-0001',
    base_revision: stale,
    patch: { tags: ['backend'] },
    rationale: 'First change.',
  });
  expect(first.isError).toBe(false);
  const afterFirst = readFileSync(join(root, 'docs/adr/ADR-0001-dates.md'), 'utf8');

  const late = await call(client, 'adr_propose_change', {
    id: 'ADR-0001',
    base_revision: stale,
    patch: { review_rule: 'Based on what I read before.' },
    rationale: 'A late change.',
  });
  expect(late.isError).toBe(true);
  expect(late.text).toMatch(/^ADR_CONFLICT: ADR-0001 changed since you read it/);
  expect(late.text).toContain('Read it again');
  expect(readFileSync(join(root, 'docs/adr/ADR-0001-dates.md'), 'utf8')).toBe(afterFirst);

  const redo = await call(client, 'adr_propose_change', {
    id: 'ADR-0001',
    base_revision: await revisionOf(client, 'ADR-0001'),
    patch: { review_rule: 'Based on the latest version.' },
    rationale: 'Redone.',
  });
  expect(redo.isError).toBe(false);
});
