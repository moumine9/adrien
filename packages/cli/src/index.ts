#!/usr/bin/env node
import { runCli } from './program.ts';

const { code, stdout, stderr } = await runCli(process.argv.slice(2), { cwd: process.cwd(), env: process.env });
process.stdout.write(stdout);
process.stderr.write(stderr);
process.exitCode = code;
