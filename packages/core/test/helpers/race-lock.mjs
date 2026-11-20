// One of several processes that all want the same ADR at once: it holds the lock briefly and logs when.
import { appendFileSync } from 'node:fs';
import { withAdrLocks } from '../../src/lock.ts';

const [root, id, out] = process.argv.slice(2);
withAdrLocks(root, [id], () => {
  appendFileSync(out, `${process.pid} enter ${performance.now()}\n`);
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40);
  appendFileSync(out, `${process.pid} exit ${performance.now()}\n`);
});
