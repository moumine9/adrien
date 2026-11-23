import { recordGaps } from './record-gaps.ts';

const madr = (confirmation: string) =>
  `## Decision Outcome\n\nWe use X.\n\n### Confirmation\n${confirmation}\n## More Information\n\nNone.\n`;

describe('recordGaps', () => {
  it('says nothing for a decision that is not accepted', () => {
    expect(recordGaps({ status: 'proposed', deciders: [] }, madr(''))).toEqual([]);
  });

  it('reports a Confirmation heading with nothing under it', () => {
    expect(recordGaps({ status: 'accepted', deciders: ['Ada'] }, madr('\n'))).toEqual(['confirmation']);
  });

  it('reports an empty Confirmation at the end of the text', () => {
    expect(recordGaps({ status: 'accepted', deciders: ['Ada'] }, '### Confirmation\n\n')).toEqual(['confirmation']);
  });

  it('does not report a Confirmation that has text, or a template without that heading', () => {
    expect(recordGaps({ status: 'accepted', deciders: ['Ada'] }, madr('\nA test checks it.\n'))).toEqual([]);
    expect(recordGaps({ status: 'accepted', deciders: ['Ada'] }, '## Context\n\nWhy.\n')).toEqual([]);
  });

  it('does not call a Confirmation empty when its text sits under a sub-heading', () => {
    const body = '### Confirmation\n\n#### Tests\n\nA test checks it.\n';
    expect(recordGaps({ status: 'accepted', deciders: ['Ada'] }, body)).toEqual([]);
  });

  it('reports missing deciders', () => {
    expect(recordGaps({ status: 'accepted', deciders: [] }, '## Context\n\nWhy.\n')).toEqual(['deciders']);
  });

  it('reports both, deciders first', () => {
    expect(recordGaps({ status: 'accepted', deciders: [] }, madr(''))).toEqual(['deciders', 'confirmation']);
  });
});
