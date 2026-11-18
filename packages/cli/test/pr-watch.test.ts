import { evaluate, type Snapshot } from '../../../scripts/pr-watch.mjs';

const HEAD = 'abcdef1234567890abcdef1234567890abcdef12';
const CODEX = 'chatgpt-codex-connector[bot]';

const summary = (sha: string, unresolved: boolean, status = 'completed') => ({
  author: CODEX,
  body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 ${JSON.stringify({ code_review: { commit_sha: sha, has_unresolved_findings: unresolved, status } })} -->`,
});

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    number: 7,
    state: 'OPEN',
    headSha: HEAD,
    headDate: '2026-11-18T10:00:00Z',
    me: 'owner',
    mergeState: 'CLEAN',
    checks: [{ name: 'test (ubuntu-latest, 22)', state: 'SUCCESS' }],
    reviewComments: [],
    issueComments: [],
    reactions: [],
    ...over,
  };
}

const thumbs = (createdAt: string, author = CODEX) => ({ content: '+1', author, createdAt });
const finding = (id: number, over = {}) => ({
  id,
  inReplyTo: null,
  author: CODEX,
  path: 'a.ts',
  line: 3,
  body: '**<sub><sub>![P2 Badge](https://x/y.svg)</sub></sub>  Fix the thing**\n\nBecause.\n\nUseful? React with 👍 / 👎.\n<!-- codex-code-review-finding:v1 -->',
  ...over,
});

test('a merged or closed pull request is reported as such', () => {
  expect(evaluate(snapshot({ state: 'MERGED' }))).toEqual({ event: 'merged', pr: 7 });
  expect(evaluate(snapshot({ state: 'CLOSED' }))).toEqual({ event: 'closed', pr: 7 });
});

test('a comment nobody replied to is a finding, cleaned of badges and markup', () => {
  const result = evaluate(snapshot({ reviewComments: [finding(1)] }));
  expect(result).toMatchObject({ event: 'findings', pr: 7 });
  const [first] = (result as { comments: { id: number; text: string }[] }).comments;
  expect(first?.id).toBe(1);
  expect(first?.text).toContain('Fix the thing');
  expect(first?.text).not.toMatch(/<|Badge|Useful\?/);
});

test('a comment the watcher already replied to is not a finding', () => {
  const replied = [finding(1), { ...finding(2), inReplyTo: 1, author: 'owner', body: 'Fixed.' }];
  expect(evaluate(snapshot({ reviewComments: replied })).event).toBe('waiting');
});

test('a comment from the watcher itself is not a finding', () => {
  expect(evaluate(snapshot({ reviewComments: [finding(1, { author: 'owner' })] })).event).toBe('waiting');
});

test('a failed required check is reported before anything else', () => {
  const checks = [
    { name: 'test (windows-latest, 24)', state: 'FAILURE' },
    { name: 'test (ubuntu-latest, 22)', state: 'SUCCESS' },
  ];
  expect(evaluate(snapshot({ checks, reactions: [thumbs('2026-11-18T11:00:00Z')] }))).toEqual({
    event: 'ci_failed',
    pr: 7,
    checks: ['test (windows-latest, 24)'],
  });
});

test('ready needs a Codex thumbs-up after the head commit, green checks and a clean merge state', () => {
  const ready = snapshot({ reactions: [thumbs('2026-11-18T10:05:00Z')] });
  expect(evaluate(ready)).toMatchObject({ event: 'ready', pr: 7 });
  expect(evaluate({ ...ready, mergeState: 'BLOCKED' }).event).toBe('waiting');
  expect(evaluate({ ...ready, checks: [{ name: 'test', state: 'PENDING' }] }).event).toBe('waiting');
  expect(evaluate({ ...ready, checks: [] }).event).toBe('waiting');
});

test('a thumbs-up from anyone but Codex, or from before the head commit, does not count', () => {
  expect(evaluate(snapshot({ reactions: [thumbs('2026-11-18T11:00:00Z', 'someone')] })).event).toBe('waiting');
  expect(evaluate(snapshot({ reactions: [thumbs('2026-11-18T09:00:00Z')] })).event).toBe('waiting');
});

test('Codex reporting no unresolved findings on the head commit also counts as approval', () => {
  const approved = snapshot({ issueComments: [summary(HEAD.slice(0, 10), false)] });
  expect(evaluate(approved)).toMatchObject({ event: 'ready' });
});

test('unresolved findings on the head commit block a thumbs-up', () => {
  const blocked = snapshot({
    reactions: [thumbs('2026-11-18T10:05:00Z')],
    issueComments: [summary(HEAD.slice(0, 10), true)],
  });
  expect(evaluate(blocked)).toMatchObject({ event: 'waiting' });
});

test('a review of an older commit says nothing about the head, and a running review is waited for', () => {
  expect(evaluate(snapshot({ issueComments: [summary('0000000000', false)] })).event).toBe('waiting');
  expect(evaluate(snapshot({ issueComments: [summary(HEAD.slice(0, 10), false, 'running')] })).event).toBe('waiting');
});

test('unreplied findings win over a thumbs-up', () => {
  const both = snapshot({ reactions: [thumbs('2026-11-18T10:05:00Z')], reviewComments: [finding(9)] });
  expect(evaluate(both).event).toBe('findings');
});
