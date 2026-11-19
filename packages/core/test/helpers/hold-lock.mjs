// A child process that holds the lock of one ADR for a while and records when it entered and left.
import { appendFileSync } from 'node:fs';
import { withAdrLocks } from '../../src/lock.ts';

const [root, id, holdMs, out] = process.argv.slice(2);
withAdrLocks(root, [id], () => {
  appendFileSync(out, `enter ${Date.now()}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Number(holdMs));
  appendFileSync(out, `exit ${Date.now()}\n`);
});
