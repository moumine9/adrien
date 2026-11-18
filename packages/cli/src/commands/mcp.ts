import { startStdio } from '@adrien/mcp';
import type { Command } from 'commander';
import type { Cli, GlobalOptions } from '../cli.ts';

export function registerMcp(program: Command, cli: Cli): void {
  program
    .command('mcp')
    .description('Run the MCP server on stdio, for AI agents (run it from the code repo or log repo)')
    .action(async (_opts: unknown, cmd: Command) => {
      const { log } = cmd.optsWithGlobals<GlobalOptions>();
      // stdout belongs to the protocol from here on: nothing in this command may print to it.
      await startStdio({ cwd: cli.cwd, log, env: cli.env, version: program.version() });
    });
}
