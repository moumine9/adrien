import { expect, test } from '@playwright/test';
import { moveAdr, seedSettings } from './support.ts';

const TITLE = 'Use PostgreSQL as the system of record for billing';

test('the decisions page lists decisions with their status and title', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText(TITLE).first()).toBeVisible();
  await expect(page.getByText('Retry outbound payment calls with exponential backoff').first()).toBeVisible();
  await expect(page.getByText(/accepted/i).first()).toBeVisible();
});

test('the board shows its columns', async ({ page }) => {
  await page.goto('/#/board');
  for (const name of ['Proposed', 'Accepted', 'Rejected', 'Superseded', 'Deprecated']) {
    await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
  }
});

test('a decision opens from the list', async ({ page }) => {
  await page.goto('/');
  await page
    .getByRole('link', { name: new RegExp(TITLE) })
    .first()
    .click();
  await expect(page).toHaveURL(/\/adr\/ADR-0002/);
  await expect(page.getByRole('heading', { name: TITLE }).first()).toBeVisible();
});

test('the change toast appears when a decision changes', async ({ page }) => {
  await seedSettings(page, { theme: 'light', refreshSeconds: 5, changeNotifications: true });
  const change = await moveAdr(page);
  await page.goto('/');
  await expect(page.getByText(TITLE).first()).toBeVisible();
  change();
  await expect(page.getByTestId('change-toast')).toContainText('ADR-0002 changed.', { timeout: 15000 });
});
