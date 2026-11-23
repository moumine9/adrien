import { changedIds, readingChanges, type Stamps, stampsOf } from './change-watch.ts';

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

describe('readingChanges (one baseline per workspace)', () => {
  it('reports nothing when another workspace is read for the first time', () => {
    const baselines = new Map<string, Stamps>();
    expect(readingChanges(baselines, 'adrien', stampsOf([row('ADR-0001', 'aaa'), row('ADR-0002', 'bbb')]))).toEqual([]);
    // Switching to another workspace: its decisions are not "changed" against the first one's.
    expect(readingChanges(baselines, 'common', stampsOf([row('ADR-0009', 'ddd')]))).toEqual([]);
  });

  it('reports only the real change when the reader comes back', () => {
    const baselines = new Map<string, Stamps>();
    readingChanges(baselines, 'adrien', stampsOf([row('ADR-0001', 'aaa'), row('ADR-0002', 'bbb')]));
    readingChanges(baselines, 'common', stampsOf([row('ADR-0009', 'ddd')]));
    expect(readingChanges(baselines, 'adrien', stampsOf([row('ADR-0001', 'aaa'), row('ADR-0002', 'ccc')]))).toEqual([
      'ADR-0002',
    ]);
    expect(readingChanges(baselines, 'common', stampsOf([row('ADR-0009', 'ddd')]))).toEqual([]);
  });
});
