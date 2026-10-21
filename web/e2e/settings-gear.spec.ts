/**
 * The header gear (spec 057): at 1440 and 820 it opens the settings popover in place, without leaving the page, and
 * the panel stays open, visible and focused with its theme setting and Help link. `bun run e2e -- settings-gear` runs
 * this file.
 */
import { atWidth, expect, headerControl, test } from './fixtures';
import { openSettings } from './harbor-fixtures';

test.describe('settings', () => {
  for (const width of [1440, 820] as const) {
    test.describe(`gear at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`openSettings opens the settings popover at ${String(width)}`, async ({ page }) => {
        await page.goto('/w/harbor');
        await openSettings(page);
        const panel = page.locator('[data-menu="settings"]');
        await expect(panel).toBeVisible();
        await expect(panel.locator('xpath=ancestor::ui-popover')).toHaveCount(1);
        await expect(page).toHaveURL((url) => url.pathname === '/w/harbor');
      });

      test(`the gear leaves the settings panel open, visible and focused, at ${String(width)}`, async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        await (await headerControl(page, 'settings')).click();
        const panel = page.locator('[data-menu="settings"]');
        await expect(panel).toBeVisible();
        await expect(panel.locator('[data-setting="theme"]')).toBeVisible();
        await expect(panel.locator('[data-settings-link="help"]')).toBeVisible();
        await expect.poll(() => panel.evaluate((el) => el.contains(el.ownerDocument.activeElement))).toBe(true);
        await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/s/002');
      });
    });
  }
});
