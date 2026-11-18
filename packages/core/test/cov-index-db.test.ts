import { parseAdr } from '../src/frontmatter.ts';
import { AdrIndex } from '../src/index-db.ts';
import type { LogView } from '../src/view.ts';
import { tmpDir } from './helpers/fixtures.ts';

test('sync atomically updates documents and drops stale search hits', async () => {
  const root = tmpDir();
  const original = parseAdr('# Original', '1-doc.md', { idFormat: 'ADR-{n}' });
  const changed = { ...original, body: 'revised' };
  const view: LogView = {
    mode: 'git',
    baseRef: 'main',
    working: [],
    problems: [],
    base: [original],
    pending: [
      { id: original.meta.id, kind: 'deleted', base: original },
      { id: 'unknown', kind: 'added' },
    ],
  };
  const first = await AdrIndex.open(root);
  try {
    expect(first.sync(view).inserted).toBe(2);
  } finally {
    first.close();
  }
  const index = await AdrIndex.open(root);
  try {
    expect(() => index.sync({ ...view, base: [changed, changed] })).toThrow(/unique/i);
    expect(index.search('revised')).toEqual([]);
    expect(index.list({ layer: 'all' }).map((r) => r.pending_kind)).toEqual([null, 'deleted']);
    expect(index.sync({ ...view, base: [changed], pending: [] })).toEqual({
      inserted: 0,
      updated: 1,
      deleted: 1,
      unchanged: 0,
    });
    expect(index.search('original').map((r) => r.layer)).toEqual(['base']);
    expect(index.search('revised').map((r) => r.id)).toEqual([original.meta.id]);
  } finally {
    index.close();
  }
});
