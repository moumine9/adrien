import type { Page } from '@playwright/test';

/** Stores the settings before the app starts, so the theme and the poll interval are known. */
export async function seedSettings(page: Page, settings: Record<string, unknown>) {
  await page.addInitScript((value) => {
    localStorage.setItem('adrien.settings', JSON.stringify(value));
  }, settings);
}

/**
 * Makes the decision list report a new revision for ADR-0002 once the returned function is called, the way a file
 * edited on disk would, so the app's next poll shows the change toast.
 */
export async function moveAdr(page: Page): Promise<() => void> {
  let moved = false;
  await page.route(/\/api\/adrs(\?.*)?$/, async (route) => {
    const response = await route.fetch();
    if (!moved) return route.fulfill({ response });
    const body = await response.json();
    for (const row of body.results) if (row.id === 'ADR-0002') row.revision = 'abcdefabcdef';
    return route.fulfill({ response, json: body });
  });
  return () => {
    moved = true;
  };
}
