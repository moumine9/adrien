import type { FileDecision, FileDecisions } from '../src/for-files.ts';
import { buildReview, REVIEW_MARKER } from '../src/review.ts';

const FOOTER = 'Adrien informs, it never blocks. Only accepted decisions on the default branch are binding.';
const NONE = `${REVIEW_MARKER}\n\nNo recorded decision governs the files in this change.\n\n${FOOTER}\n`;

function dec(id: string, over: Partial<FileDecision> = {}): FileDecision {
  return {
    id,
    title: `Title ${id}`,
    status: 'accepted',
    binding: true,
    workspace: null,
    layer: 'base',
    pending_kind: null,
    match: 'anchor',
    anchor: 'web:src/**',
    review_rule: `Rule ${id}.`,
    excerpt: '',
    ...over,
  };
}

const file = (path: string, ...decisions: FileDecision[]): FileDecisions => ({
  file: path,
  component: 'web',
  decisions,
});

test('no files, or files that no decision governs, say so and still carry the footer', () => {
  expect(buildReview([])).toEqual({ markdown: NONE, binding: 0, hints: 0, files: 0 });
  expect(buildReview([{ file: 'loose.txt', component: null, decisions: [] }])).toEqual({
    markdown: NONE,
    binding: 0,
    hints: 0,
    files: 1,
  });
});

test('one binding decision lists its title, rule and the file it governs', () => {
  const review = buildReview([file('apps/web/src/a.ts', dec('ADR-0007'))]);
  expect(review).toEqual({
    markdown: [
      REVIEW_MARKER,
      '',
      '### Decisions that govern this change',
      '',
      '**ADR-0007** Title ADR-0007',
      'Rule: Rule ADR-0007.',
      'Governs: `apps/web/src/a.ts`',
      '',
      FOOTER,
      '',
    ].join('\n'),
    binding: 1,
    hints: 0,
    files: 1,
  });
});

test('a decision without a review_rule omits the Rule line', () => {
  const review = buildReview([file('a.ts', dec('ADR-0007', { review_rule: null }))]);
  expect(review.markdown).toContain('**ADR-0007** Title ADR-0007\nGoverns: `a.ts`\n');
  expect(review.markdown).not.toContain('Rule:');
});

test('binding decisions are sorted by id and capped at maxDecisions, 20 by default', () => {
  const many = Array.from({ length: 25 }, (_, i) => dec(`ADR-${String(i + 1).padStart(4, '0')}`));
  const review = buildReview([file('a.ts', ...many)]);
  expect(review.binding).toBe(25);
  expect(review.markdown).toContain('**ADR-0001** Title ADR-0001');
  expect(review.markdown).toContain('**ADR-0020** Title ADR-0020');
  expect(review.markdown).not.toContain('**ADR-0021**');
  expect(review.markdown).toContain('and 5 more decisions\n');
});

test('maxDecisions changes the cap, and maxFilesPerDecision only the file cap', () => {
  const many = Array.from({ length: 3 }, (_, i) => dec(`ADR-000${i + 1}`));
  const review = buildReview([file('a.ts', ...many)], { maxDecisions: 1 });
  expect(review.markdown).toContain('**ADR-0001** Title ADR-0001');
  expect(review.markdown).not.toContain('**ADR-0002**');
  expect(review.markdown).toContain('and 2 more decisions\n');
  expect(review.markdown).not.toContain('Rule ADR-0002');
});

test('a decision governs at most maxFilesPerDecision files, then says how many more', () => {
  const files = ['f1.ts', 'f2.ts', 'f3.ts', 'f4.ts', 'f5.ts', 'f6.ts', 'f7.ts'].map((f) => file(f, dec('ADR-0007')));
  const review = buildReview(files);
  expect(review.markdown).toContain('Governs: `f1.ts`, `f2.ts`, `f3.ts`, `f4.ts`, `f5.ts` and 2 more\n');
  expect(review.files).toBe(7);

  const narrow = buildReview(files, { maxFilesPerDecision: 2 });
  expect(narrow.markdown).toContain('Governs: `f1.ts`, `f2.ts` and 5 more\n');
});

test('the same file given twice is listed once, but counts as two input files', () => {
  const review = buildReview([file('a.ts', dec('ADR-0007')), file('a.ts', dec('ADR-0007'))]);
  expect(review.markdown).toContain('Governs: `a.ts`\n');
  expect(review.markdown).not.toContain('and 1 more');
  expect(review).toMatchObject({ binding: 1, files: 2 });
});

test('non-binding entries go in a details block: proposals, retired ones and pending changes', () => {
  const review = buildReview([
    file(
      'a.ts',
      dec('ADR-0005', { binding: false, status: 'proposed', review_rule: null }),
      dec('ADR-0006', { binding: false, status: 'superseded', layer: 'base' }),
      dec('ADR-0009', { binding: false, layer: 'pending', pending_kind: 'modified', review_rule: null }),
    ),
  ]);
  expect(review.binding).toBe(0);
  expect(review.hints).toBe(3);
  expect(review.markdown).toBe(
    [
      REVIEW_MARKER,
      '',
      '### Decisions that govern this change',
      '',
      '<details><summary>Not binding (3): proposals, pending changes and retired decisions</summary>',
      '',
      '**ADR-0005** Title ADR-0005 (proposed)',
      'Governs: `a.ts`',
      '',
      '**ADR-0006** Title ADR-0006 (superseded)',
      'Rule: Rule ADR-0006.',
      'Governs: `a.ts`',
      '',
      '**ADR-0009** Title ADR-0009 (accepted, pending change)',
      'Governs: `a.ts`',
      '',
      '</details>',
      '',
      FOOTER,
      '',
    ].join('\n'),
  );
});

test('a proposal and its own pending edit are two hints, the base entry first', () => {
  const review = buildReview([
    file('a.ts', dec('ADR-0005', { binding: false, status: 'proposed', review_rule: null })),
    file('b.ts', dec('ADR-0005', { binding: false, status: 'proposed', layer: 'pending', pending_kind: 'modified' })),
  ]);
  expect(review).toMatchObject({ binding: 0, hints: 2 });
  const base = review.markdown.indexOf('**ADR-0005** Title ADR-0005 (proposed)\n');
  const pending = review.markdown.indexOf('**ADR-0005** Title ADR-0005 (proposed, pending change)\n');
  expect(base).toBeGreaterThan(-1);
  expect(pending).toBeGreaterThan(base);
});

test('non-binding entries are capped at maxDecisions inside the block', () => {
  const hints = Array.from({ length: 3 }, (_, i) => dec(`ADR-000${i + 1}`, { binding: false, status: 'proposed' }));
  const review = buildReview([file('a.ts', ...hints)], { maxDecisions: 2 });
  expect(review.hints).toBe(3);
  expect(review.markdown).toContain('<summary>Not binding (3):');
  expect(review.markdown).toContain('**ADR-0002** Title ADR-0002 (proposed)');
  expect(review.markdown).not.toContain('**ADR-0003**');
  expect(review.markdown).toContain('and 1 more decisions\n\n</details>');
});

test('hints without a binding decision still render the heading and the block', () => {
  const review = buildReview([file('a.ts', dec('ADR-0005', { binding: false, status: 'proposed' }))]);
  expect(review).toMatchObject({ binding: 0, hints: 1 });
  expect(review.markdown).toContain('### Decisions that govern this change\n\n<details>');
  expect(review.markdown).not.toContain('No recorded decision');
});

test('a decision with a binding base entry and a pending entry is one binding and one hint', () => {
  const review = buildReview([
    file('apps/web/src/a.ts', dec('ADR-0007')),
    file('apps/web/src/b.ts', dec('ADR-0007', { layer: 'pending', binding: false, pending_kind: 'modified' })),
  ]);
  expect(review).toMatchObject({ binding: 1, hints: 1, files: 2 });
  const [binding, details] = review.markdown.split('<details>');
  expect(binding).toContain('**ADR-0007** Title ADR-0007\nRule: Rule ADR-0007.\nGoverns: `apps/web/src/a.ts`\n');
  expect(binding).not.toContain('apps/web/src/b.ts');
  expect(details).toContain(
    '**ADR-0007** Title ADR-0007 (accepted, pending change)\nRule: Rule ADR-0007.\nGoverns: `apps/web/src/b.ts`',
  );
});

test('user text is escaped: ampersands, angle brackets, markdown syntax, and an @ that would mention someone', () => {
  const review = buildReview([
    file(
      'src/a.ts',
      dec('ADR-0007', {
        title: '<script>alert(1)</script> for @alice & `x` *bold* _it_ [l](u) \\',
        review_rule: 'Use <T> and @bob > 1',
      }),
    ),
  ]);
  expect(review.markdown).toContain(
    '**ADR-0007** &lt;script&gt;alert(1)&lt;/script&gt; for @\u200Balice &amp; \\`x\\` \\*bold\\* \\_it\\_ \\[l\\](u) \\\\\n',
  );
  expect(review.markdown).toContain('Rule: Use &lt;T&gt; and @\u200Bbob &gt; 1\n');
  expect(review.markdown).not.toContain('<script>');
  expect(review.markdown).not.toContain('@alice');
  expect(review.markdown).not.toContain('@bob');
});

test('an id is escaped like any other text, so it cannot close the details block', () => {
  const review = buildReview([file('src/a.ts', dec('ADR-9</details>', { binding: false, status: 'proposed' }))]);
  expect(review.markdown).toContain('**ADR-9&lt;/details&gt;**');
  expect(review.markdown.match(/<\/details>/g)).toHaveLength(1);
});

test('newlines in a title or rule collapse to one line, so no line of a comment is chosen by an ADR author', () => {
  const evil = 'Nice\n\n/approve\n/merge\r\n# Heading\t\u0007x';
  const review = buildReview([file('src/a.ts', dec('ADR-0007', { title: evil, review_rule: evil }))]);
  expect(review.markdown).toContain('**ADR-0007** Nice /approve /merge # Heading x\n');
  expect(review.markdown).toContain('Rule: Nice /approve /merge # Heading x\n');
  expect(review.markdown.split('\n').some((line) => /^\s*\/(approve|merge)/.test(line))).toBe(false);
});

test('a long title or rule is cut, ending in an ellipsis', () => {
  const long = 'w'.repeat(500);
  const review = buildReview([file('src/a.ts', dec('ADR-0007', { title: long, review_rule: long }))]);
  const title = review.markdown.split('\n').find((l) => l.startsWith('**ADR-0007**')) ?? '';
  expect(title.length).toBeLessThan(230);
  expect(title.endsWith('\u2026')).toBe(true);
});

test('file names go into code spans as they are: angle brackets and @ stay readable, control characters become spaces', () => {
  const review = buildReview([
    file('packages/@scope/<x>.ts', dec('ADR-0007')),
    file('a\nb\u0001c.ts', dec('ADR-0007')),
  ]);
  expect(review.markdown).toContain('Governs: `packages/@scope/<x>.ts`, `a b c.ts`\n');
  expect(review.markdown).not.toContain('\u200B');
  expect(review.markdown).not.toContain('&lt;x');
});

test('a decision from a common log is labelled with its workspace, apart from an own decision with the same id', () => {
  const review = buildReview([
    file(
      'src/a.ts',
      dec('ADR-0010', { workspace: null, review_rule: 'Own.' }),
      dec('ADR-0010', { workspace: 'shared-co', review_rule: 'Shared.' }),
    ),
  ]);
  expect(review.binding).toBe(2);
  expect(review.markdown).toContain('**ADR-0010** Title ADR-0010');
  expect(review.markdown).toContain('[shared-co] **ADR-0010** Title ADR-0010');
  expect(review.markdown).toContain('Rule: Shared.');
});

test('same-id decisions from the own log and two common logs sort own first, then by workspace', () => {
  const review = buildReview([
    file(
      'src/a.ts',
      dec('ADR-0010', { workspace: 'shared-co' }),
      dec('ADR-0010', { workspace: null }),
      dec('ADR-0010', { workspace: 'other-co' }),
    ),
  ]);
  const at = (text: string) => review.markdown.indexOf(text);
  expect(at('**ADR-0010**')).toBeLessThan(at('[other-co] **ADR-0010**'));
  expect(at('[other-co] **ADR-0010**')).toBeLessThan(at('[shared-co] **ADR-0010**'));
});

test('a note about an unverified base is shown, right after the marker', () => {
  const review = buildReview([file('src/a.ts', dec('ADR-0007'))], { note: 'No default branch was found.' });
  expect(review.markdown.split('\n').slice(0, 3)).toEqual([REVIEW_MARKER, '', '> Note: No default branch was found.']);
  expect(buildReview([], { note: 'Careful.' }).markdown).toBe(
    `${REVIEW_MARKER}\n\n> Note: Careful.\n\nNo recorded decision governs the files in this change.\n\n${FOOTER}\n`,
  );
  expect(buildReview([], { note: null })).toEqual(buildReview([]));
});

test('a file name with backticks keeps a longer code span around it', () => {
  const review = buildReview([
    file('a``b.ts', dec('ADR-0007')),
    file('`lead.ts', dec('ADR-0008')),
    file('trail.ts`', dec('ADR-0009')),
    file('in`side.ts', dec('ADR-0010')),
  ]);
  expect(review.markdown).toContain('Governs: ```a``b.ts```\n');
  expect(review.markdown).toContain('Governs: `` `lead.ts ``\n');
  expect(review.markdown).toContain('Governs: `` trail.ts` ``\n');
  expect(review.markdown).toContain('Governs: ``in`side.ts``\n');
});

test('counts are distinct decisions, and files is the number of input files', () => {
  const review = buildReview([
    file('a.ts', dec('ADR-0007'), dec('ADR-0008')),
    file('b.ts', dec('ADR-0007'), dec('ADR-0009', { binding: false, status: 'proposed' })),
    { file: 'c.txt', component: null, decisions: [] },
  ]);
  expect(review).toEqual({ markdown: expect.any(String), binding: 2, hints: 1, files: 3 });
});
