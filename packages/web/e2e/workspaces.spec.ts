import { expect, test } from '@playwright/test';
import { seedSettings } from './support.ts';

// Runs against the `workspaces` mock variant (two workspaces, see playwright.config.ts).

test('the chooser at the root offers one link per workspace', async ({ page }) => {
  await seedSettings(page, { changeNotifications: false });
  await page.goto('/');
  const main = page.getByRole('main');
  await expect(main.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
  await expect(main.getByRole('link')).toHaveCount(2);
});

test('picking a workspace in the chooser lands on its decisions', async ({ page }) => {
  await seedSettings(page, { changeNotifications: false });
  await page.goto('/');
  await page
    .getByRole('main')
    .getByRole('link', { name: /common/ })
    .click();
  await expect(page).toHaveURL(/#\/w\/common$/);
  await expect(page.getByRole('heading', { name: 'Decisions', exact: true })).toBeVisible();
});

test('the header names the open workspace and leads back to the chooser', async ({ page }) => {
  await seedSettings(page, { changeNotifications: false });
  await page.goto('/#/w/adrien');
  const link = page.getByRole('link', { name: 'Workspace: adrien' });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page.getByRole('heading', { name: 'Choose a workspace' })).toBeVisible();
});

// The main navigation keeps its layout with the workspace link beside the name: one row from 1024 px, two rows of three below.
for (const width of [320, 390, 640, 1024]) {
  test(`the main navigation keeps its layout beside the workspace link at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await seedSettings(page, { changeNotifications: false });
    await page.goto('/#/w/adrien');
    const nav = page.getByRole('navigation', { name: 'Main' });
    await nav.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const rows = await nav
      .getByRole('link')
      .evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().y)));
    const perRow = [...new Set(rows)].map((y) => rows.filter((row) => row === y).length);
    expect(perRow).toEqual(width >= 1024 ? [6] : [3, 3]);
  });
}

for (const width of [320, 390, 640, 1024]) {
  test(`the workspace pages do not scroll sideways at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await seedSettings(page, { changeNotifications: false });
    for (const path of ['/#/', '/#/w/adrien']) {
      await page.goto(path);
      await expect(page.getByRole('main')).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        width: window.innerWidth,
      }));
      expect(scroll.scrollWidth, path).toBeLessThanOrEqual(scroll.width);
    }
  });
}
