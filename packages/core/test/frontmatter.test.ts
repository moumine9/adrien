import { BODY_TEMPLATE, isAdrFile, parseAdr, serializeAdr } from '../src/frontmatter.ts';
import type { Adr, AdrMeta } from '../src/model.ts';

const opts = { idFormat: 'ADR-{n:4}' };

const meta = (over: Partial<AdrMeta>): AdrMeta => ({
  id: 'ADR-0001',
  title: 'Use Postgres',
  status: 'proposed',
  tags: [],
  components: [],
  code: [],
  sources: [],
  supersedes: [],
  related: [],
  deciders: [],
  origin: 'manual',
  contested: false,
  extra: {},
  ...over,
});

test('serializes a minimal ADR exactly', () => {
  expect(serializeAdr({ meta: meta({}), body: BODY_TEMPLATE })).toBe(
    `---\nid: ADR-0001\ntitle: Use Postgres\nstatus: proposed\n---\n${BODY_TEMPLATE}`,
  );
});

test('writes tags as a flow sequence', () => {
  expect(serializeAdr({ meta: meta({ tags: ['backend', 'database'] }), body: '' })).toContain(
    'tags: [backend, database]',
  );
});

test('round-trips a full ADR', () => {
  const adr: Adr = {
    path: 'docs/adr/ADR-0042-invoice-timestamps.md',
    body: '\n## Context\n\nInvoices: dates drift.\n',
    meta: meta({
      id: 'ADR-0042',
      title: 'Invoice timestamps: stored in UTC',
      status: 'accepted',
      date: '2026-03-04',
      tags: ['backend', 'database'],
      components: ['billing-service'],
      code: ['billing-service:src/**/Endpoints/**'],
      review_rule: 'Invoice timestamps are stored and compared in UTC, never in local time.',
      sources: ['gitlab:acme/billing-service!171', 'jira:ACME-123'],
      supersedes: ['ADR-0007'],
      superseded_by: 'ADR-0050',
      related: ['ADR-0010'],
      deciders: ['alice'],
      origin: 'mined',
      contested: true,
      extra: { 'decision-makers': ['alice'] },
    }),
  };
  expect(parseAdr(serializeAdr(adr), adr.path, opts)).toEqual(adr);
});

test('parses MADR 4 without id: id from the file name, title from the H1', () => {
  const text = '---\nstatus: accepted\ndate: 2024-01-02\ndecision-makers: [alice]\n---\n# Use Postgres\n\nBody.\n';
  const adr = parseAdr(text, 'docs/adr/0007-use-postgres.md', opts);
  expect(adr.meta).toMatchObject({ id: 'ADR-0007', title: 'Use Postgres', status: 'accepted', date: '2024-01-02' });
  expect(adr.meta.extra['decision-makers']).toEqual(['alice']);
});

test('parses adr-tools: status from the ## Status section', () => {
  const text =
    '# 1. Record architecture decisions\n\nDate: 2018-03-01\n\n## Status\n\nAccepted\n\n## Context\n\nWe need to record.\n';
  const adr = parseAdr(text, 'doc/adr/0001-record-architecture-decisions.md', opts);
  expect(adr.meta).toMatchObject({ id: 'ADR-0001', title: 'Record architecture decisions', status: 'accepted' });
});

test('maps "Superseded by …" to superseded', () => {
  const text = '# 2. Use MySQL\n\n## Status\n\nSuperseded by [3. Use Postgres](0003-use-postgres.md)\n';
  expect(parseAdr(text, 'doc/adr/0002-use-mysql.md', opts).meta.status).toBe('superseded');
});

test('invalid status throws PARSE_ERROR naming the file', () => {
  const text = '---\nid: ADR-0001\ntitle: X\nstatus: maybe\n---\n';
  expect(() => parseAdr(text, 'docs/adr/x.md', opts)).toThrow(/docs\/adr\/x\.md/);
});

test('malformed YAML throws PARSE_ERROR', () => {
  const text = '---\nid: ADR-0001\ntitle: [unclosed\n---\n';
  expect(() => parseAdr(text, 'docs/adr/x.md', opts)).toThrow(expect.objectContaining({ code: 'PARSE_ERROR' }));
});

test('isAdrFile tells ADRs from generated index files', () => {
  expect(isAdrFile('# Index\n', 'index.md')).toBe(false);
  expect(isAdrFile('# By service\n', 'by-service.md')).toBe(false);
  expect(isAdrFile('# 3. X\n', '0003-x.md')).toBe(true);
  expect(isAdrFile('---\nid: ADR-012\n---\n', 'ADR-012-x.md')).toBe(true);
  expect(isAdrFile('---\nid: ADR-0099\ntitle: X\n---\n', 'whatever.md')).toBe(true);
});
