// The story: a maintainer opens Adrien to see where the decision log stands, narrows it to what matters,
// reads one decision's rule, checks the read-only board, then a teammate merges a change while the page is open
// and the reader is told and reloads. Titles and ids come from the mock fixtures (mock/fixtures.ts).
import { expect, test } from '@playwright/test';
import { moveAdr, seedSettings } from './support.ts';

const DECISIONS = [
  { id: 'ADR-0001', status: 'Accepted', title: 'Record architecture decisions as Markdown files in the repository' },
  { id: 'ADR-0002', status: 'Accepted', title: 'Use PostgreSQL as the system of record for billing' },
  { id: 'ADR-0003', status: 'Superseded', title: 'Call the notification service synchronously over HTTP' },
  { id: 'ADR-0005', status: 'Rejected', title: 'Render the checkout entirely on the server' },
  { id: 'ADR-0006', status: 'Deprecated', title: 'Keep session tokens in localStorage' },
  { id: 'ADR-0008', status: 'Proposed', title: 'Ship risky changes behind feature flags' },
];
const BILLING = { id: 'ADR-0002', title: 'Use PostgreSQL as the system of record for billing' };
const REJECTED_TITLE = 'Render the checkout entirely on the server';
const RULE = 'Persist billing state in PostgreSQL only. A new datastore needs a decision that supersedes this one.';

test('a maintainer follows the decision log, from the list to a change made by a teammate', async ({ page }) => {
  await seedSettings(page, { theme: 'light', refreshSeconds: 5, changeNotifications: true });
  const teammateMerges = await moveAdr(page);

  await test.step('The maintainer opens Adrien and sees the decisions, each with its id, status and title', async () => {
    await page.goto('/');
    for (const { id, status, title } of DECISIONS) {
      const card = page.getByRole('article').filter({ has: page.getByRole('link', { name: title, exact: true }) });
      await expect(card).toHaveCount(1);
      await expect(card).toContainText(id);
      await expect(card.getByText(status, { exact: true })).toBeVisible();
      await expect(card.getByRole('heading', { name: title })).toBeVisible();
    }
  });

  await test.step('The status tally shows how many decisions are in each status', async () => {
    for (const status of ['Proposed', 'Accepted', 'Rejected', 'Superseded', 'Deprecated']) {
      await expect(page.getByRole('button', { name: new RegExp(`^${status} \\d+$`) })).toBeVisible();
    }
  });

  await test.step('The maintainer keeps only the rejected decisions', async () => {
    await page.getByRole('button', { name: /^Rejected \d+$/ }).click();
    await expect(page.getByRole('button', { name: /^Rejected \d+$/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('link', { name: REJECTED_TITLE })).toBeVisible();
    await expect(page.getByRole('link', { name: BILLING.title })).toHaveCount(0);
  });

  await test.step('Then clears the filter and searches for billing instead', async () => {
    await page.getByRole('button', { name: /^Rejected \d+$/ }).click();
    await page.getByRole('searchbox', { name: 'Search' }).fill('PostgreSQL');
    await expect(page.getByRole('link', { name: BILLING.title })).toBeVisible();
    await expect(page.getByRole('link', { name: REJECTED_TITLE })).toHaveCount(0);
  });

  await test.step('The maintainer opens the billing decision and reads its binding rule', async () => {
    await page.getByRole('link', { name: BILLING.title }).click();
    await expect(page).toHaveURL(/\/adr\/ADR-0002/);
    await expect(page.getByRole('heading', { level: 1, name: BILLING.title })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'The binding rule' })).toBeVisible();
    await expect(page.getByText(RULE)).toBeVisible();
  });

  await test.step('The board groups decisions by status and says it is read-only', async () => {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Board' }).click();
    await expect(page.getByText('This board is read-only.')).toBeVisible();
    for (const status of ['Proposed', 'Accepted', 'Rejected', 'Superseded', 'Deprecated']) {
      await expect(page.getByRole('heading', { level: 2, name: new RegExp(`^${status} \\(\\d+\\)$`) })).toBeVisible();
    }
    const proposed = page.getByRole('region', { name: /^Proposed/ });
    await expect(proposed.getByRole('link', { name: 'Ship risky changes behind feature flags' })).toBeVisible();
    const accepted = page.getByRole('region', { name: /^Accepted/ });
    await expect(accepted.getByRole('link', { name: BILLING.title })).toBeVisible();
  });

  await test.step('The maintainer goes back to the billing decision and keeps it open', async () => {
    await page.goto('/#/adr/ADR-0002');
    await expect(page.getByRole('heading', { level: 1, name: BILLING.title })).toBeVisible();
  });

  await test.step('A teammate merges a change to it, and the reader is told', async () => {
    teammateMerges();
    await expect(page.getByTestId('change-toast')).toContainText('ADR-0002 changed.', { timeout: 15000 });
  });

  await test.step('The reader reloads the decision and sees the notice is settled', async () => {
    await page.getByRole('button', { name: 'Reload ADR-0002' }).click();
    await expect(page.getByTestId('change-toast')).toContainText('Updated.');
    await expect(page.getByRole('heading', { level: 1, name: BILLING.title })).toBeVisible();
  });
});
