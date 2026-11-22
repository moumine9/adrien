import { test } from '@playwright/test';
import { moveAdr, seedSettings } from './support.ts';

const THEMES = ['light', 'dark'] as const;
const SIZES = {
  desktop: { width: 1280, height: 800 },
  tablet: { width: 660, height: 800 },
  laptop: { width: 1000, height: 800 },
  phone: { width: 390, height: 844 },
  narrow: { width: 320, height: 640 },
} as const;
const PAGES = { decisions: '/', board: '/#/board', detail: '/#/adr/ADR-0002' } as const;

for (const [sizeName, viewport] of Object.entries(SIZES)) {
  for (const theme of THEMES) {
    test.describe(`${sizeName} ${theme}`, () => {
      test.use({ viewport });

      for (const [name, path] of Object.entries(PAGES)) {
        test(name, async ({ page }) => {
          await seedSettings(page, { theme, changeNotifications: false });
          await page.goto(path);
          await page.getByRole('main').getByRole('heading').first().waitFor();
          await page.waitForLoadState('networkidle');
          await page.screenshot({ path: `.shots/${name}-${theme}-${sizeName}.png` });
        });
      }

      test('toast', async ({ page }) => {
        await seedSettings(page, { theme, refreshSeconds: 5, changeNotifications: true });
        const change = await moveAdr(page);
        await page.goto('/');
        await page.getByText('Use PostgreSQL as the system of record for billing').first().waitFor();
        change();
        await page.getByText('ADR-0002 changed.').waitFor({ timeout: 15000 });
        await page.screenshot({ path: `.shots/toast-${theme}-${sizeName}.png` });
      });
    });
  }
}
