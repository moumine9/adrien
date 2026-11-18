import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CONFIG_FILE } from '@adrien/core';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { getDefaultEnvironment, StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { adrText, configYaml, tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';

const dist = fileURLToPath(new URL('../dist/index.js', import.meta.url));

// `pretest` builds the bundle; a bare `vitest run` without a build skips this file instead of failing on it.
describe.runIf(existsSync(dist))('adrien mcp over real stdio', () => {
  test('lists the six tools and searches, and stdout carries nothing but protocol frames', async () => {
    const root = tmpDir();
    writeFiles(root, {
      [CONFIG_FILE]: configYaml(),
      'docs/adr/ADR-0001-dates.md': adrText({ id: 'ADR-0001', title: 'Render dates in the user locale' }),
    });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [dist, 'mcp'],
      cwd: root,
      env: { ...getDefaultEnvironment(), ADRIEN_HOME: tmpDir() },
      stderr: 'pipe',
    });
    const parseErrors: Error[] = [];
    const client = new Client({ name: 'smoke', version: '0.0.0' });
    client.onerror = (error) => parseErrors.push(error);
    onTestFinished(() => client.close());

    await client.connect(transport);
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(6);

    const found = await client.callTool({ name: 'adr_search', arguments: { query: 'dates' } });
    expect(found.structuredContent).toMatchObject({ results: [{ id: 'ADR-0001' }] });
    expect(client.getServerVersion()?.name).toBe('adrien');
    // A stray console.log on stdout would surface here as a JSON parse error.
    expect(parseErrors).toEqual([]);
  });
});
