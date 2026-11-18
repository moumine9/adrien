import { createRequire } from 'node:module';
import { AdrienError } from '@adrien/core';
import { Command, CommanderError } from 'commander';
import type { Cli } from './cli.ts';
import { registerAccept } from './commands/accept.ts';
import { registerCheck } from './commands/check.ts';
import { registerExport } from './commands/export.ts';
import { registerFor } from './commands/for.ts';
import { registerInit } from './commands/init.ts';
import { registerLint } from './commands/lint.ts';
import { registerList } from './commands/list.ts';
import { registerMcp } from './commands/mcp.ts';
import { registerNew } from './commands/new.ts';
import { registerRenumber } from './commands/renumber.ts';
import { registerSearch } from './commands/search.ts';
import { registerShow } from './commands/show.ts';
import { registerStatus } from './commands/status.ts';
import { registerSupersede } from './commands/supersede.ts';
import { registerSync } from './commands/sync.ts';

export const VERSION: string = createRequire(import.meta.url)('../package.json').version;

export interface CliIO {
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

const CLEAN_EXITS = new Set(['commander.helpDisplayed', 'commander.version', 'commander.help']);

export function buildProgram(cli: Cli): Command {
  const program = new Command('adrien')
    .description('Architecture Decision Records for developers and their AI agents')
    .version(VERSION, '-v, --version')
    .option('--log <path|url>', 'ADR log to use (default: found from the current directory)')
    .option('--json', 'machine-readable output')
    .exitOverride()
    .configureOutput({ writeOut: (s) => cli.out(s), writeErr: (s) => cli.err(s) });
  for (const register of [
    registerInit,
    registerNew,
    registerList,
    registerShow,
    registerSearch,
    registerFor,
    registerCheck,
    registerLint,
    registerAccept,
    registerStatus,
    registerSupersede,
    registerRenumber,
    registerSync,
    registerExport,
    registerMcp,
  ]) {
    register(program, cli);
  }
  return program;
}

/** Runs one CLI invocation and returns its exit code and output (the bin writes them; tests read them). */
export async function runCli(argv: string[], io: CliIO): Promise<CliResult> {
  let stdout = '';
  let stderr = '';
  let code = 0;
  const env = io.env ?? process.env;
  const cli: Cli = {
    cwd: io.cwd,
    env,
    out: (s) => {
      stdout += s;
    },
    err: (s) => {
      stderr += s;
    },
    setCode: (c) => {
      code = c;
    },
  };
  try {
    await buildProgram(cli).parseAsync(argv, { from: 'user' });
  } catch (e) {
    if (e instanceof CommanderError) code = CLEAN_EXITS.has(e.code) ? 0 : 2;
    else if (e instanceof AdrienError) {
      stderr += `adrien: ${e.message}\n`;
      code = 2;
    } else {
      const error = e as Error;
      stderr += `adrien: unexpected error: ${error.message}\n`;
      if (env.ADRIEN_DEBUG === '1' && error.stack) stderr += `${error.stack}\n`;
      code = 3;
    }
  }
  return { code, stdout, stderr };
}
