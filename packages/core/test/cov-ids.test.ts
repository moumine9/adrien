import { idNumber, nextIdNumber, parseIdFormat } from '../src/ids.ts';

test('an unpadded number can be the entire ID', () => {
  expect(parseIdFormat('{n}')).toEqual({ prefix: '', width: 1, suffix: '' });
});

test('allocation ignores IDs with a wrong suffix or a nonnumeric middle', () => {
  const format = 'A{n}Z';
  expect(idNumber('A12X', format)).toBeNull();
  expect(idNumber('A1xZ', format)).toBeNull();
  expect(nextIdNumber(['A12X', 'A1xZ', 'A3Z'], format)).toBe(4);
});
