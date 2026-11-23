import { parseRef } from '../src/ref.ts';

test('a plain id has no workspace', () => {
  expect(parseRef('ADR-0004')).toEqual({ workspace: null, id: 'ADR-0004' });
});

test('workspace/ADR-n splits at the slash', () => {
  expect(parseRef('common/ADR-0004')).toEqual({ workspace: 'common', id: 'ADR-0004' });
});

test('a workspace that is not a valid workspace name stays a plain string', () => {
  expect(parseRef('Shared Co/ADR-0004')).toEqual({ workspace: null, id: 'Shared Co/ADR-0004' });
  expect(parseRef('/ADR-0004')).toEqual({ workspace: null, id: '/ADR-0004' });
});

test('the id after the slash is whatever the target log writes: custom formats stay referenceable', () => {
  expect(parseRef('common/DEC(0001)')).toEqual({ workspace: 'common', id: 'DEC(0001)' });
  expect(parseRef('common/a:b')).toEqual({ workspace: 'common', id: 'a:b' });
  expect(parseRef('common/x/ADR-1')).toEqual({ workspace: 'common', id: 'x/ADR-1' });
});

test('an empty id, or one with whitespace, is not a reference', () => {
  expect(parseRef('common/')).toEqual({ workspace: null, id: 'common/' });
  expect(parseRef('common/ADR 0004')).toEqual({ workspace: null, id: 'common/ADR 0004' });
});
