/**
 * ISC-73 (T35 structure, T40 fills it): every route renders inside one shell with one header and its controls, the
 * shell reports its container tier, and the tab bar sits in the header at compact and in main above.
 * `bun run e2e -- shell` (`-g header` for the claim's probe). Against the stub API: the spec routes are not served
 * yet (T52), so a known spec shows its placeholder and an unknown one the not-found page, decided from the dashboard.
 */
import { atWidth, expect, test } from './fixtures';

const ROUTES = ['/', '/w/harbor', '/w/harbor/s/002', '/w/harbor/s/002/status', '/w/harbor/s/999'] as const;
const CONTROLS = ['brand', 'workspace', 'spec', 'area', 'palette', 'live', 'zen', 'settings'] as const;
const TIERS = [
  { width: 390, tier: 'compact', tabBar: 'header' },
  { width: 820, tier: 'medium', tabBar: 'main' },
  { width: 1440, tier: 'wide', tabBar: 'main' },
] as const;

for (const { width, tier, tabBar } of TIERS) {
  test.describe(`shell at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const route of ROUTES) {
      test(`one header with every control on ${route}`, async ({ page }) => {
        await page.goto(route);
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);
        await expect(page.locator('header')).toHaveCount(1);
        for (const control of CONTROLS) {
          await expect(page.locator(`header [data-control="${control}"]`), control).toBeVisible();
        }
      });
    }

    test(`tab bar in ${tabBar} on a spec tab`, async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      await expect(page.locator('app-tab-bar')).toHaveCount(1);
      await expect(page.locator(`${tabBar} app-tab-bar`)).toHaveCount(1);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'status');
    });

    test('not-found page for a spec the dashboard does not list', async ({ page }) => {
      await page.goto('/w/harbor/s/999');
      await expect(page.locator('[data-page="not-found"]')).toBeVisible();
      await expect(page.locator('app-tab-bar')).toHaveCount(0);
    });

    test('placeholder, never not-found, for a tab whose view is not built yet', async ({ page }) => {
      // The stub serves the spec route (T52), so the spec head renders and the tab shows the area placeholder.
      await page.goto('/w/harbor/s/002/status');
      const placeholder = page.locator('[data-page="placeholder"]');
      await expect(placeholder).toHaveAttribute('data-tab', 'status');
      await expect(placeholder).toContainText('comes with a later task');
      await expect(page.locator('[data-page="not-found"]')).toHaveCount(0);
    });
  });
}
