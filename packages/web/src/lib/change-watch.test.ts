import { changedIds, stampsOf } from './change-watch.ts';

const row = (id: string, revision: string | null) => ({ id, revision });

describe('stampsOf', () => {
  it('maps each decision to its revision', () => {
    expect([...stampsOf([row('ADR-0001', 'aaa'), row('ADR-0002', null)])]).toEqual([
      ['ADR-0001', 'aaa'],
      ['ADR-0002', null],
    ]);
  });
});

describe('changedIds', () => {
  const before = stampsOf([row('ADR-0001', 'aaa'), row('ADR-0002', 'bbb')]);

  it('is empty when nothing moved', () => {
    expect(changedIds(before, stampsOf([row('ADR-0002', 'bbb'), row('ADR-0001', 'aaa')]))).toEqual([]);
  });

  it('names a decision whose revision changed', () => {
    expect(changedIds(before, stampsOf([row('ADR-0001', 'aaa'), row('ADR-0002', 'ccc')]))).toEqual(['ADR-0002']);
  });

  it('names a decision that appeared and one that is gone, in id order', () => {
    expect(changedIds(before, stampsOf([row('ADR-0002', 'bbb'), row('ADR-0000', 'zzz')]))).toEqual([
      'ADR-0000',
      'ADR-0001',
    ]);
  });

  it('counts a revision that became null (deleted here) as a change', () => {
    expect(changedIds(before, stampsOf([row('ADR-0001', null), row('ADR-0002', 'bbb')]))).toEqual(['ADR-0001']);
  });
});
