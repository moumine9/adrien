import { expect, test } from '@playwright/test';
import { seedSettings } from './support.ts';

// The three flaws found on the screenshots, checked as geometry: no tab, button label or badge may be cut or wrapped.

test('on a phone, every navigation tab fits inside the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSettings(page, { changeNotifications: false });
  await page.goto('/');
  for (const name of ['Decisions', 'Board', 'Graph', 'Files', 'Health', 'Settings']) {
    const box = await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name }).boundingBox();
    expect(box?.x).toBeGreaterThanOrEqual(0);
    expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(390);
  }
});

// Five columns are at their narrowest at 1024 px (12.5rem each, the board then scrolls sideways): the labels must fit there too.
for (const width of [1024, 1280]) {
  test.describe(`board at ${width} px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test.beforeEach(async ({ page }) => {
      await seedSettings(page, { changeNotifications: false });
      await page.goto('/#/board');
      await page.getByRole('main').getByRole('heading').first().waitFor();
    });

    test('"How to approve" is one line and its chevron stays inside the button', async ({ page }) => {
      const summary = page.locator('summary', { hasText: 'How to approve' }).first();
      const box = await summary.boundingBox();
      const chevron = await summary.locator('svg').boundingBox();
      expect(box?.height).toBeLessThanOrEqual(40);
      // The label itself is one line: its text is as tall as one line of 14 px type, not two.
      const labelHeight = await summary.evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el.firstChild as Node);
        return range.getBoundingClientRect().height;
      });
      expect(labelHeight).toBeLessThan(26);
      // The chevron ends inside the content box: it does not run into the end padding.
      const inset = await summary.evaluate((el) => {
        const style = getComputedStyle(el);
        return Number.parseFloat(style.paddingRight) + Number.parseFloat(style.borderRightWidth);
      });
      expect((chevron?.x ?? 0) + (chevron?.width ?? 0)).toBeLessThanOrEqual(
        (box?.x ?? 0) + (box?.width ?? 0) - inset + 0.5,
      );
    });

    test('the checkout badge sits inside its card, whole', async ({ page }) => {
      const badge = page.locator('[data-local-edit="deleted"]').first();
      await badge.waitFor();
      const box = await badge.boundingBox();
      const row = await badge.locator('xpath=..').boundingBox();
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual((row?.x ?? 0) + (row?.width ?? 0));
      // And the label inside it is not clipped by the badge's own edge.
      expect(await badge.evaluate((el) => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(
        true,
      );
    });
  });
}
