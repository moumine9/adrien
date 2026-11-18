import { createHash, timingSafeEqual } from 'node:crypto';

const digest = (text: string) => createHash('sha256').update(text).digest();
/** Compares digests, so the check takes the same time wherever the first difference is, whatever the lengths. */
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/**
 * True when an `Authorization` header carries the access token: `Bearer <token>` for scripts and agents, or `Basic`
 * with the token as the password (any user name) for browsers, which ask for it once and then keep sending it.
 */
export function isAuthorized(header: string | undefined, token: string): boolean {
  const m = /^(\S+)\s+(.+)$/.exec(header ?? '');
  if (!m) return false;
  const [, scheme, value] = m as unknown as [string, string, string];
  if (scheme.toLowerCase() === 'bearer') return same(value, token);
  if (scheme.toLowerCase() !== 'basic') return false;
  const decoded = Buffer.from(value, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  return colon !== -1 && same(decoded.slice(colon + 1), token);
}
