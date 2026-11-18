import { findDuplicates } from '../src/duplicates.ts';
import type { Adr } from '../src/model.ts';

const adr = (id: string, title: string) => ({ meta: { id, title } }) as Adr;

test('a near-identical title is a duplicate with its Jaccard score', () => {
  const hits = findDuplicates('Use PostgreSQL for persistence', [
    adr('ADR-0001', 'Use PostgreSQL for the persistence layer'),
  ]);
  expect(hits).toHaveLength(1);
  expect(hits[0]?.id).toBe('ADR-0001');
  expect(hits[0]?.score).toBeCloseTo(0.667, 2);
});

test('an unrelated title is not a duplicate', () => {
  expect(findDuplicates('Queue jobs in Redis', [adr('ADR-0001', 'Use PostgreSQL for persistence')])).toEqual([]);
});

test('an identical title after normalisation scores 1', () => {
  expect(findDuplicates('Use  postgres!', [adr('ADR-0001', 'use Postgres')])).toEqual([
    { id: 'ADR-0001', title: 'use Postgres', score: 1 },
  ]);
});
