/**
 * Realistic fixture data for the mock API (`pnpm --filter @adrien/web dev:mock`) and the tests. One fictional log
 * ("acme") with every status, a supersede chain, related links, a review date that has passed, and pending changes
 * of each kind, so every view has something to show.
 */
import type { AdrFile, AdrMeta, CheckResponse, Diagnostic } from '@adrien/api/contract';

type MetaInput = Partial<AdrMeta> & Pick<AdrMeta, 'id' | 'title' | 'status'>;

function meta(m: MetaInput): AdrMeta {
  return {
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
    ...m,
  };
}

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

function adr(m: MetaInput, body: string): AdrFile {
  const full = meta(m);
  return { meta: full, body: body.trim(), path: `${full.id}-${slug(full.title)}.md` };
}

export const COMPONENTS: Record<string, { repo?: string; root?: string }> = {
  'billing-service': { root: 'services/billing' },
  'checkout-web': { root: 'apps/checkout' },
  notifications: { root: 'services/notifications' },
  platform: { root: 'platform' },
};

export const TAGS = ['architecture', 'cost', 'data', 'frontend', 'reliability', 'security', 'workflow'];

export const BASE: AdrFile[] = [
  adr(
    {
      id: 'ADR-0001',
      title: 'Record architecture decisions as Markdown files in the repository',
      status: 'accepted',
      date: '2025-01-10',
      tags: ['workflow'],
      review_rule: 'Write an ADR before changing anything another team depends on, and link it from the merge request.',
      related: ['ADR-0008'],
      deciders: ['alex.m', 'sam.k'],
    },
    `
## Context

Decisions about the billing and checkout systems were scattered across chat threads and meeting notes. New people
could not tell which ones still held.

## Decision

Every significant architecture decision is written as a Markdown file under \`docs/decisions\`, reviewed in a merge
request like code, and accepted by merging it.

## Consequences

- The log is versioned with the code it governs.
- An unmerged decision is only a proposal, whatever its status field says.
`,
  ),
  adr(
    {
      id: 'ADR-0002',
      title: 'Use PostgreSQL as the system of record for billing',
      status: 'accepted',
      date: '2025-02-03',
      review_on: '2026-06-01',
      tags: ['data', 'architecture'],
      components: ['billing-service'],
      code: ['billing-service:src/db/**', 'billing-service:migrations/**'],
      review_rule:
        'Persist billing state in PostgreSQL only. A new datastore needs a decision that supersedes this one.',
      sources: ['https://www.postgresql.org/docs/current/transaction-iso.html'],
      deciders: ['sam.k'],
    },
    `
## Context

Invoices, payments and refunds must stay consistent under concurrent writes, and finance needs ad-hoc reporting.

## Options considered

| Option | Transactions | Reporting | Operations |
| --- | --- | --- | --- |
| PostgreSQL | Serializable | SQL | Managed by the platform team |
| Document store | Per document | Export needed | New skill set |

## Decision

Use **PostgreSQL** with \`SERIALIZABLE\` transactions for anything that moves money.

\`\`\`sql
SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
\`\`\`

## Consequences

- [x] Migrations live in \`services/billing/migrations\`.
- [ ] Revisit read replicas once reporting load grows (see the review date).
`,
  ),
  adr(
    {
      id: 'ADR-0003',
      title: 'Call the notification service synchronously over HTTP',
      status: 'superseded',
      date: '2025-02-20',
      tags: ['architecture'],
      components: ['billing-service', 'notifications'],
      review_rule: 'Billing calls the notification endpoint inline after a payment succeeds.',
      superseded_by: 'ADR-0007',
      deciders: ['alex.m'],
    },
    `
## Context

Customers need a receipt by email right after paying.

## Decision

Billing calls \`POST /notify\` on the notification service before returning to the client.

## Consequences

A slow mail provider slows every checkout. This proved too costly; see ADR-0007.
`,
  ),
  adr(
    {
      id: 'ADR-0004',
      title: 'Retry outbound payment calls with exponential backoff',
      status: 'accepted',
      date: '2025-03-14',
      tags: ['reliability'],
      components: ['billing-service'],
      code: ['billing-service:src/payments/**'],
      review_rule:
        'Every outbound call to the payment provider goes through the retry helper, capped at 5 attempts with jitter.',
      contested: true,
      deciders: ['jordan.p', 'sam.k'],
    },
    `
## Context

The payment provider returns transient 503s a few times a day.

## Decision

Wrap provider calls in \`withRetry\`: exponential backoff from 200 ms, full jitter, at most 5 attempts, and only for
idempotent requests carrying an idempotency key.

## Consequences

- Fewer failed checkouts during provider blips.
- Some reviewers think 5 attempts holds the request too long; the cap is contested.
`,
  ),
  adr(
    {
      id: 'ADR-0005',
      title: 'Render the checkout entirely on the server',
      status: 'rejected',
      date: '2025-04-02',
      tags: ['frontend', 'architecture'],
      components: ['checkout-web'],
      deciders: ['river.t'],
    },
    `
## Context

The checkout bundle had grown past 400 KB.

## Decision

Rejected. Server rendering would have meant a second runtime to operate; code splitting brought the bundle under
budget instead.
`,
  ),
  adr(
    {
      id: 'ADR-0006',
      title: 'Keep session tokens in localStorage',
      status: 'deprecated',
      date: '2025-04-18',
      tags: ['security', 'frontend'],
      components: ['checkout-web'],
      code: ['checkout-web:src/auth/**'],
      review_rule: 'Read the session token from localStorage through the auth module only.',
      related: ['ADR-0009'],
      deciders: ['river.t'],
    },
    `
## Context

The first checkout stored the session token where scripts could reach it.

## Decision

Deprecated after the security review: tokens now live in \`HttpOnly\` cookies set by the gateway. Nothing replaces
this decision; the auth module simply stopped reading storage.
`,
  ),
  adr(
    {
      id: 'ADR-0007',
      title: 'Send notifications through a durable queue',
      status: 'superseded',
      date: '2025-06-09',
      tags: ['architecture', 'reliability'],
      components: ['billing-service', 'notifications'],
      supersedes: ['ADR-0003'],
      superseded_by: 'ADR-0011',
      review_rule: 'Billing enqueues a notification job; it never waits for delivery.',
      deciders: ['alex.m'],
    },
    `
## Context

Inline calls (ADR-0003) tied checkout latency to the mail provider.

## Decision

Billing writes a job to a durable queue and returns. A worker in the notification service sends the email.
`,
  ),
  adr(
    {
      id: 'ADR-0008',
      title: 'Ship risky changes behind feature flags',
      status: 'proposed',
      date: '2026-09-30',
      tags: ['workflow', 'reliability'],
      components: ['checkout-web', 'billing-service'],
      review_rule: 'Changes to pricing or payment flows ship dark behind a flag and are enabled per region.',
      related: ['ADR-0001'],
      origin: 'agent',
    },
    `
## Context

Two incidents this year came from pricing changes released to every region at once.

## Decision (proposed)

Put pricing and payment-flow changes behind a feature flag, enable them region by region, and remove the flag within
two sprints.
`,
  ),
  adr(
    {
      id: 'ADR-0009',
      title: 'Keep secrets in the platform vault, never in environment files',
      status: 'accepted',
      date: '2025-05-05',
      tags: ['security'],
      components: ['platform', 'billing-service'],
      code: ['platform:deploy/**', 'billing-service:config/**'],
      review_rule: 'Read secrets from the vault client at startup. Never commit them or pass them through .env files.',
      sources: ['https://example.com/acme/security-review-2025'],
      related: ['ADR-0006'],
      deciders: ['jordan.p'],
    },
    `
## Context

A leaked \`.env\` file in a fork exposed a sandbox payment key.

## Decision

Services fetch secrets from the vault at startup with a short-lived token. CI fails when a file matching \`*.env\`
is committed.
`,
  ),
  adr(
    {
      id: 'ADR-0010',
      title: 'Log in structured JSON with a request id',
      status: 'accepted',
      date: '2025-07-21',
      review_on: '2027-01-15',
      tags: ['reliability'],
      components: ['platform', 'billing-service', 'notifications'],
      review_rule: 'Log one JSON object per line and include the inbound request id on every entry.',
      deciders: ['sam.k'],
    },
    `
## Decision

All services log JSON lines with \`timestamp\`, \`level\`, \`message\` and \`request_id\`.
`,
  ),
  adr(
    {
      id: 'ADR-0011',
      title: 'Publish notification events to the event bus',
      status: 'accepted',
      date: '2026-03-02',
      tags: ['architecture', 'reliability'],
      components: ['billing-service', 'notifications'],
      code: ['billing-service:src/events/**', 'notifications:src/consumers/**'],
      supersedes: ['ADR-0007'],
      review_rule: 'Billing publishes a PaymentSucceeded event; notification code subscribes to it and owns delivery.',
      related: ['ADR-0010'],
      deciders: ['alex.m', 'jordan.p'],
    },
    `
## Context

The queue from ADR-0007 coupled billing to the notification job format.

## Decision

Billing publishes domain events (\`PaymentSucceeded\`, \`RefundIssued\`) to the event bus. The notification service
subscribes and decides what to send.

See [the queue decision](ADR-0007-send-notifications-through-a-durable-queue.md) for the history.
`,
  ),
  adr(
    {
      id: 'ADR-0012',
      title: 'Cap monthly cloud spend per environment',
      status: 'proposed',
      date: '2026-10-12',
      tags: ['cost'],
      components: ['platform'],
      review_rule: 'Each non-production environment has a budget alert at 80% and a hard cap at 100%.',
    },
    `
## Context

Preview environments were left running over a holiday.

## Decision (proposed)

Set a monthly budget per environment, alert at 80% and stop non-production workloads at 100%.
`,
  ),
];

/** The difference in this checkout: one new ADR, one edit, one removal. */
export const PENDING: Array<{ kind: 'added' | 'modified' | 'deleted'; file: AdrFile | null; id: string }> = [
  {
    kind: 'added',
    id: 'ADR-0013',
    file: adr(
      {
        id: 'ADR-0013',
        title: 'Move product search to a dedicated index',
        status: 'proposed',
        date: '2026-11-17',
        tags: ['data', 'architecture'],
        components: ['checkout-web'],
        code: ['checkout-web:src/search/**'],
        review_rule: 'Query the search index for product lookups; PostgreSQL stays the source of truth.',
        related: ['ADR-0002'],
        origin: 'agent',
      },
      `
## Context

Product search runs \`ILIKE\` queries against the billing database and slows it down at peak.

## Decision (proposed)

Index products in a dedicated search engine fed from change events. Writes still go to PostgreSQL (ADR-0002).
`,
    ),
  },
  {
    kind: 'modified',
    id: 'ADR-0004',
    file: (() => {
      const base = BASE.find((a) => a.meta.id === 'ADR-0004') as AdrFile;
      return {
        ...base,
        meta: {
          ...base.meta,
          contested: false,
          review_rule:
            'Every outbound call to the payment provider goes through the retry helper, capped at 3 attempts with jitter.',
        },
        body: base.body.replace('at most 5 attempts', 'at most 3 attempts').replace(/- Some reviewers[^\n]*/, ''),
      };
    })(),
  },
  { kind: 'deleted', id: 'ADR-0012', file: null },
];

export const DIAGNOSTICS: Diagnostic[] = [
  {
    severity: 'error',
    code: 'broken-link',
    message: 'related links to ADR-0099, which does not exist',
    id: 'ADR-0008',
    path: 'ADR-0008-ship-risky-changes-behind-feature-flags.md',
  },
  {
    severity: 'error',
    code: 'unknown-component',
    message: 'component "search" is not declared in adrien.config.yaml',
    id: 'ADR-0013',
    path: 'ADR-0013-move-product-search-to-a-dedicated-index.md',
  },
  {
    severity: 'warning',
    code: 'review-due',
    message: 'review_on 2026-06-01 has passed: check that this decision still holds',
    id: 'ADR-0002',
    path: 'ADR-0002-use-postgresql-as-the-system-of-record-for-billing.md',
  },
  {
    severity: 'warning',
    code: 'stale-anchor',
    message: 'code anchor checkout-web:src/auth/** matches no file',
    id: 'ADR-0006',
    path: 'ADR-0006-keep-session-tokens-in-localstorage.md',
  },
  {
    severity: 'warning',
    code: 'missing-review-rule',
    message: 'an accepted decision should say how to review code against it (review_rule)',
    id: 'ADR-0005',
  },
  {
    severity: 'info',
    code: 'pending-proposed',
    message: 'ADR-0013 is proposed in this checkout and will merge as a hint, not a rule',
    id: 'ADR-0013',
  },
];

export const LINT_DIAGNOSTICS: Diagnostic[] = [
  {
    severity: 'warning',
    code: 'markdown',
    message: 'MD022/blanks-around-headings: headings should be surrounded by blank lines (line 7)',
    id: 'ADR-0010',
    path: 'ADR-0010-log-in-structured-json-with-a-request-id.md',
  },
  {
    severity: 'warning',
    code: 'unfilled-placeholder',
    message: 'the Consequences section still contains the template placeholder',
    id: 'ADR-0012',
    path: 'ADR-0012-cap-monthly-cloud-spend-per-environment.md',
  },
];

export function checkReport(lint: boolean): CheckResponse {
  const diagnostics = lint ? [...DIAGNOSTICS, ...LINT_DIAGNOSTICS] : DIAGNOSTICS;
  return {
    errors: diagnostics.filter((d) => d.severity === 'error').length,
    warnings: diagnostics.filter((d) => d.severity === 'warning').length,
    diagnostics,
  };
}
