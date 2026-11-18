import { installDemoFetch } from './demo.ts';

/** A page at `href` whose network `fetch` is a stub, with the demo fetch installed on top of it. */
function installOn(href: string) {
  const network = vi.fn(async () => new Response('from the network', { status: 200 }));
  const page = { fetch: network as unknown as typeof fetch, location: { href } };
  installDemoFetch(page);
  return { page, network };
}

describe('installDemoFetch', () => {
  it('answers the app’s /api calls from the mock fixtures, without touching the network', async () => {
    const { page, network } = installOn('http://localhost/');
    const res = await page.fetch('/api/meta');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('json');
    expect(await res.json()).toMatchObject({ product: 'Adrien' });
    expect(network).not.toHaveBeenCalled();
  });

  it('keeps the query string and accepts URL and Request inputs', async () => {
    const { page, network } = installOn('http://localhost/');
    const pending = await page.fetch(new URL('/api/adrs?pending=1', 'http://localhost/'));
    expect(((await pending.json()) as { results: unknown[] }).results).toHaveLength(3);
    const meta = await page.fetch(new Request('http://localhost/api/meta'));
    expect(await meta.json()).toMatchObject({ product: 'Adrien' });
    expect(network).not.toHaveBeenCalled();
  });

  it('also finds the API under the folder of a project page, such as /adrien/demo/', async () => {
    const { page, network } = installOn('https://owner.example.io/adrien/demo/#/adr/ADR-0001');
    const res = await page.fetch('/adrien/demo/api/adrs/ADR-0001');
    expect(await res.json()).toMatchObject({ id: 'ADR-0001' });
    expect(network).not.toHaveBeenCalled();
  });

  it('passes every other request to the network, unchanged', async () => {
    const { page, network } = installOn('http://localhost/');
    const init = { method: 'GET' };
    const res = await page.fetch('https://example.com/data.json', init);
    expect(await res.text()).toBe('from the network');
    expect(network).toHaveBeenCalledWith('https://example.com/data.json', init);
    await page.fetch('/assets/app.js');
    expect(network).toHaveBeenCalledWith('/assets/app.js', undefined);
  });

  it('answers an unknown /api path the way the server does: 404 JSON', async () => {
    const { page } = installOn('http://localhost/');
    const res = await page.fetch('/api/nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  });
});
