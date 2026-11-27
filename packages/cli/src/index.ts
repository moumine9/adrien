#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { AdrienError } from '@adrien/core';
import { runCli } from './program.ts';

// Questions (such as the parent folder of the ADRs in `adrien init`) only when a person can answer them.
const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
const ask = interactive
  ? async (question: string): Promise<string> => {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const stop = new AbortController();
      // Ctrl+C: with no listener readline only pauses, and the question would never be answered.
      rl.on('SIGINT', () => stop.abort());
      try {
        return await rl.question(question, { signal: stop.signal });
      } catch {
        // Ctrl+C or Ctrl+D: the person left without answering.
        process.stdout.write('\n');
        throw new AdrienError('INVALID_INPUT', 'No answer was given, so nothing was written.');
      } finally {
        rl.close();
      }
    }
  : undefined;

const { code, stdout, stderr } = await runCli(process.argv.slice(2), {
  cwd: process.cwd(),
  env: process.env,
  ...(ask ? { ask } : {}),
});
process.stdout.write(stdout);
process.stderr.write(stderr);
process.exitCode = code;
