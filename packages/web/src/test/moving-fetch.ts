import { createMockFetch } from '../../mock/handler.ts';

/** What changed in a decision between two polls. */
export interface Moved {
  revision?: string | null;
  /** A new title, so a test can see whether the page shows the old or the new version. */
  title?: string;
}

/**
 * The mock API, with some decisions altered while `moved` says so: their revision in the list and on the decision, and
 * their title on the decision. `moved` is read on every request, so a test changes the answer between polls.
 */
export function movingFetch(moved: () => Record<string, Moved>): typeof fetch {
  const inner = createMockFetch('default');
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  return async (input, init) => {
    const response = await inner(input, init);
    const { pathname } = new URL(String(input), 'http://localhost');
    const patch = moved();
    if (pathname === '/api/adrs') {
      const body = await response.json();
      for (const row of body.results) {
        const change = patch[row.id];
        if (change && 'revision' in change) row.revision = change.revision;
      }
      return json(body);
    }
    const id = pathname.startsWith('/api/adrs/') ? decodeURIComponent(pathname.slice('/api/adrs/'.length)) : '';
    const change = patch[id];
    if (!change) return response;
    const body = await response.json();
    if ('revision' in change) body.revision = change.revision;
    if (change.title && body.base) body.base.meta.title = change.title;
    return json(body);
  };
}
