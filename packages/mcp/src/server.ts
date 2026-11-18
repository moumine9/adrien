import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTools } from './tools.ts';

export interface ServerOptions {
  cwd: string;
  log?: string;
  env?: NodeJS.ProcessEnv;
  today?: () => string;
  version?: string;
}

// The same guidance `adrien init --agents` writes into AGENTS.md, for agents that only see the MCP server.
const INSTRUCTIONS =
  "Before changing code, call the `adr_for_files` tool with the files you will touch, and follow the `review_rule` of every binding ADR. If your change contradicts an accepted ADR, stop and tell the user instead of working around it. Record a new durable decision with `adr_propose`. Never set an ADR's status to `accepted` yourself.";

export function createAdrienServer(opts: ServerOptions): McpServer {
  const server = new McpServer({ name: 'adrien', version: opts.version ?? '0.0.0' }, { instructions: INSTRUCTIONS });
  registerTools(server, opts);
  return server;
}

export async function startStdio(opts: ServerOptions): Promise<void> {
  await createAdrienServer(opts).connect(new StdioServerTransport());
}
