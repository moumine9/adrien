import { findDuplicates } from '../src/duplicates.ts';
import { parseAdr } from '../src/frontmatter.ts';
import { adrText } from './helpers/fixtures.ts';

test('ranks the exact title above a partial match encountered first', () => {
  const adrs = ['Cache invoice reads locally', 'Cache invoice reads'].map((title, i) => {
    const id = `ADR-000${i + 1}`;
    return parseAdr(adrText({ id, title }), `${id}.md`, { idFormat: 'ADR-{n:4}' });
  });
  expect(findDuplicates('Cache invoice reads', adrs)).toEqual([
    { id: 'ADR-0002', title: 'Cache invoice reads', score: 1 },
    { id: 'ADR-0001', title: 'Cache invoice reads locally', score: 0.75 },
  ]);
});
