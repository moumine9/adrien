import { exactTime, relativeTime } from './time.ts';

const NOW = Date.parse('2026-11-20T12:00:00Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('relativeTime', () => {
  it.each([
    [10, 'just now'],
    [59, 'just now'],
    [60, '1 minute ago'],
    [5 * 60, '5 minutes ago'],
    [3 * 3600, '3 hours ago'],
    [2 * 24 * 3600, '2 days ago'],
    [45 * 24 * 3600, '1 month ago'],
    [400 * 24 * 3600, '1 year ago'],
  ])('%i seconds ago reads %s', (seconds, text) => {
    expect(relativeTime(ago(seconds), NOW)).toBe(text);
  });

  it('reads a time in the future as just now', () => {
    expect(relativeTime(ago(-3600), NOW)).toBe('just now');
  });

  it('uses the clock when no time is given', () => {
    expect(relativeTime(new Date(Date.now() - 2 * 3600 * 1000).toISOString())).toBe('2 hours ago');
  });
});

describe('exactTime', () => {
  it('gives the day, month, year and time', () => {
    expect(exactTime('2026-11-18T14:02:00Z')).toMatch(/^1[78] Nov 2026, \d\d:\d\d$/);
  });
});
