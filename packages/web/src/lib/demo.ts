import { createMockFetch } from '../../mock/handler.ts';

/** What the demo replaces: the page's fetch, and the URL the page is at (for relative requests). */
export interface DemoTarget {
  fetch: typeof fetch;
  location: { href: string };
}

/**
 * The `/api` path a request asks for, or null when it is not an API call of this page. The app asks for `/api/...` from
 * the site root; under a project page (`/adrien/demo/`) the same call may also arrive with that folder in front.
 */
function apiPath(input: RequestInfo | URL, page: string): string | null {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const here = new URL(page);
  const url = new URL(raw, here);
  if (url.origin !== here.origin) return null;
  const folder = new URL('./', here).pathname;
  const path = url.pathname.startsWith(folder) ? `/${url.pathname.slice(folder.length)}` : url.pathname;
  if (path !== '/api' && !path.startsWith('/api/')) return null;
  return path + url.search;
}

/**
 * Makes the page's `/api` calls answer from the mock fixtures (the same semantics the server documents, see
 * docs/api.md). Anything else still goes to the network. Only the demo build calls this (see main.tsx).
 */
export function installDemoFetch(target: DemoTarget): void {
  const network = target.fetch.bind(target);
  const mock = createMockFetch();
  target.fetch = (input, init) => {
    const path = apiPath(input, target.location.href);
    return path === null ? network(input, init) : mock(path);
  };
}
