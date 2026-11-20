const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'always' });

/** "3 hours ago", from an ISO time. Under a minute is "just now"; a time in the future reads as "just now" too. */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return relative.format(-Math.floor(seconds / size), unit);
  }
  return 'just now';
}

/** "18 Nov 2026, 14:02" in the reader's time zone: the exact time behind a relative one. */
export function exactTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
