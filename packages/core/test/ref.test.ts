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

test('an id after the slash that is not an id stays a plain string', () => {
  expect(parseRef('common/')).toEqual({ workspace: null, id: 'common/' });
  expect(parseRef('common/a:b')).toEqual({ workspace: null, id: 'common/a:b' });
  expect(parseRef('common/x/ADR-1')).toEqual({ workspace: null, id: 'common/x/ADR-1' });
});
