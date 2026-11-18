import { formatId, idNumber, nextIdNumber, parseIdFormat } from '../src/ids.ts';

test('formatId pads to the configured width and never truncates', () => {
  expect(formatId(7, 'ADR-{n:4}')).toBe('ADR-0007');
  expect(formatId(1234, 'ADR-{n:3}')).toBe('ADR-1234');
});

test('idNumber reads the number back whatever its digit width', () => {
  expect(idNumber('ADR-042', 'ADR-{n:4}')).toBe(42);
  expect(idNumber('XYZ-1', 'ADR-{n:4}')).toBeNull();
});

test('nextIdNumber is max + 1, starting at 1', () => {
  expect(nextIdNumber(['ADR-0001', 'ADR-0009'], 'ADR-{n:4}')).toBe(10);
  expect(nextIdNumber([], 'ADR-{n:4}')).toBe(1);
});

test('parseIdFormat rejects a format without a {n} placeholder', () => {
  expect(() => parseIdFormat('ADR-')).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
  expect(parseIdFormat('ADR-{n}')).toEqual({ prefix: 'ADR-', width: 1, suffix: '' });
});
