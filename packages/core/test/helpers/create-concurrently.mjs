import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveContext } from '../../src/context.ts';
import { createAdr } from '../../src/ops.ts';
import { loadLogView } from '../../src/view.ts';

const [root, title, peer] = process.argv.slice(2);
const ctx = await resolveContext({ cwd: root });
const view = await loadLogView(root, ctx.config);

// Hold both creators after the initial disk scan so even a slow runner exercises a stale allocation.
createAdr(ctx, view, {
  get title() {
    writeFileSync(join(root, title), '');
    const deadline = Date.now() + 10000;
    const signal = new Int32Array(new SharedArrayBuffer(4));
    while (!existsSync(join(root, peer))) {
      if (Date.now() >= deadline) throw new Error('Peer did not reach allocation');
      Atomics.wait(signal, 0, 0, 5);
    }
    return title;
  },
});
