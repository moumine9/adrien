// A child process that appends `count` notes to one ADR, each one a read, a change and a write of the whole file.
import { resolveContext } from '../../src/context.ts';
import { updateAdr } from '../../src/ops.ts';
import { loadLogView } from '../../src/view.ts';

const [root, id, label, count] = process.argv.slice(2);
const ctx = await resolveContext({ cwd: root, env: { ADRIEN_HOME: `${root}/.home` } });
const view = await loadLogView(ctx.logRoot, ctx.config);
for (let i = 1; i <= Number(count); i++) {
  updateAdr(ctx, view, id, {}, { note: `${label}${i}`, today: '2026-11-19' });
}
