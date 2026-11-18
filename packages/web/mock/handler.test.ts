import type {
  AdrResponse,
  AdrsResponse,
  ApiError,
  CheckResponse,
  ForResponse,
  GraphResponse,
  MetaResponse,
} from '@adrien/api/contract';
import { handleApiRequest, type MockVariant } from './handler.ts';

function get<T>(url: string, variant: MockVariant = 'default'): { status: number; body: T } {
  const r = handleApiRequest(url, variant);
  return { status: r.status, body: JSON.parse(r.body) as T };
}

const ids = (url: string) => get<AdrsResponse>(url).body.results.map((r) => `${r.id}/${r.layer}`);

describe('mock API', () => {
  it('describes the log in /api/meta', () => {
    const { body } = get<MetaResponse>('/api/meta');
    expect(body.mode).toBe('git');
    expect(body.baseUnresolved).toBe(false);
    expect(body.counts.total).toBe(13);
    expect(body.counts.pending).toBe(3);
    expect(Object.values(body.counts.byStatus).every((n) => n > 0)).toBe(true);
  });

  it('flags the unresolved and fork variants', () => {
    expect(get<MetaResponse>('/api/meta', 'unresolved').body).toMatchObject({ baseUnresolved: true, baseRef: null });
    expect(get<MetaResponse>('/api/meta', 'fork').body.forkUnresolved).toBe(true);
    expect(get<MetaResponse>('/api/meta', 'files').body.mode).toBe('files');
  });

  it('lists base and pending rows, the same id twice when a decision is edited', () => {
    const all = ids('/api/adrs');
    expect(all).toContain('ADR-0004/base');
    expect(all).toContain('ADR-0004/pending');
    expect(ids('/api/adrs?pending=1')).toEqual(['ADR-0004/pending', 'ADR-0012/pending', 'ADR-0013/pending']);
  });

  it('needs every tag but any component or status', () => {
    expect(ids('/api/adrs?tag=architecture&tag=reliability')).toEqual(['ADR-0007/base', 'ADR-0011/base']);
    expect(ids('/api/adrs?component=platform&component=checkout-web&status=deprecated&status=proposed')).toEqual([
      'ADR-0006/base',
      'ADR-0008/base',
      'ADR-0012/base',
      'ADR-0012/pending',
      'ADR-0013/pending',
    ]);
  });

  it('ranks a text search with title hits first, ignoring accents', () => {
    const results = ids('/api/adrs?q=notificatión');
    expect(results[0]).toMatch(/ADR-0011|ADR-0007|ADR-0003/);
    expect(ids('/api/adrs?q=zzz')).toEqual([]);
  });

  it('returns one decision with its pending change, and 404 for an unknown id', () => {
    const edited = get<AdrResponse>('/api/adrs/ADR-0004').body;
    expect(edited.base?.meta.review_rule).toContain('5 attempts');
    expect(edited.pending).toMatchObject({ kind: 'modified' });
    expect(edited.pending?.meta?.review_rule).toContain('3 attempts');
    expect(get<AdrResponse>('/api/adrs/ADR-0013').body.base).toBeNull();
    expect(get<AdrResponse>('/api/adrs/ADR-0012').body.pending).toEqual({ kind: 'deleted' });
    const missing = get<ApiError>('/api/adrs/ADR-9999');
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('ADR_NOT_FOUND');
  });

  it('builds a graph with supersede and related edges', () => {
    const g = get<GraphResponse>('/api/graph').body;
    expect(g.nodes.find((n) => n.id === 'ADR-0013')?.pending).toBe(true);
    expect(g.edges).toContainEqual({ from: 'ADR-0011', to: 'ADR-0007', type: 'supersedes' });
    expect(g.edges).toContainEqual({ from: 'ADR-0007', to: 'ADR-0003', type: 'supersedes' });
    expect(g.edges.filter((e) => e.type === 'related').length).toBeGreaterThan(0);
  });

  it('resolves the decisions governing files', () => {
    const r = get<ForResponse>('/api/for?path=services/billing/src/payments/charge.ts&path=README.md').body;
    const [charge, readme] = r.files;
    expect(charge?.component).toBe('billing-service');
    expect(charge?.decisions[0]).toMatchObject({ id: 'ADR-0004', binding: true, match: 'anchor' });
    expect(charge?.decisions.some((d) => d.layer === 'pending' && !d.binding)).toBe(true);
    expect(readme).toEqual({ file: 'README.md', component: null, decisions: [] });
    expect(r.notes).toBeUndefined();
    expect(get<ForResponse>('/api/for?path=platform/deploy/app.yaml', 'unresolved').body.notes).toHaveLength(1);
    expect(get<ApiError>('/api/for').status).toBe(400);
  });

  it('adds style warnings to the check report with lint=1', () => {
    const plain = get<CheckResponse>('/api/check').body;
    const lint = get<CheckResponse>('/api/check?lint=1').body;
    expect(plain.errors).toBe(2);
    expect(lint.warnings).toBeGreaterThan(plain.warnings);
  });

  it('exports text and refuses unknown formats or endpoints', () => {
    expect(handleApiRequest('/api/export?format=llms').contentType).toContain('text/plain');
    expect(handleApiRequest('/api/export?format=pdf').status).toBe(400);
    expect(handleApiRequest('/api/nope').status).toBe(404);
  });
});
