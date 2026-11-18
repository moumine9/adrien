import { anchorMatches, excerpt, parseAnchor } from '../src/anchors.ts';
import type { Adr } from '../src/model.ts';

test('parseAnchor splits on the first ":"', () => {
  expect(parseAnchor('billing-service:src/**')).toEqual({ component: 'billing-service', glob: 'src/**' });
  expect(parseAnchor('web:src/a:b.ts')).toEqual({ component: 'web', glob: 'src/a:b.ts' });
  expect(parseAnchor('nocolon')).toBeNull();
  expect(parseAnchor(':src/**')).toBeNull();
  expect(parseAnchor('web:')).toBeNull();
});

test('anchorMatches checks the component and matches dotfiles', () => {
  const anchor = { component: 'web', glob: 'src/**' };
  expect(anchorMatches(anchor, 'web', 'src/.env')).toBe(true);
  expect(anchorMatches(anchor, 'web', 'test/a.ts')).toBe(false);
  expect(anchorMatches(anchor, 'billing-service', 'src/a.ts')).toBe(false);
});

const withBody = (body: string) => ({ body }) as Adr;

test('excerpt prefers Rationale, then Decision, then the first paragraph', () => {
  expect(excerpt(withBody('\n## Decision\n\nUse UTC.\n\n## Rationale\n\nDST bugs.\n'))).toBe('DST bugs.');
  expect(excerpt(withBody('\n## Context\n\nC.\n\n## Decision\n\nUse UTC.\n'))).toBe('Use UTC.');
  expect(excerpt(withBody('\nJust a paragraph.\n\nAnother.\n'))).toBe('Just a paragraph.');
});

test('excerpt truncates at 600 characters with an ellipsis', () => {
  const text = excerpt(withBody(`\n## Rationale\n\n${'x'.repeat(700)}\n`));
  expect(text).toHaveLength(600);
  expect(text.endsWith('…')).toBe(true);
});
