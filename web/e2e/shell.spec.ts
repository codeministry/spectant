/**
 * ISC-73 (T35 structure, T40 fills it): every route renders inside one shell with one header and its controls, the
 * shell reports its container tier, and the tab bar sits in the header at compact and in main above.
 * `bun run e2e -- shell` (`-g header` for the claim's probe). Against the stub API: the spec routes are not served
 * yet (T52), so a known spec shows its placeholder and an unknown one the not-found page, decided from the dashboard.
 */
import { atWidth, expect, test } from './fixtures';

const ROUTES = ['/', '/w/harbor', '/w/harbor/s/002', '/w/harbor/s/002/status', '/w/harbor/s/999', '/settings'] as const;
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

    test('header controls lead where they say: workspace, spec, area menu, live, settings', async ({ page }) => {
      const control = (name: string) => page.locator(`header [data-control="${name}"]`);

      // A plain click opens the picker; its entries are the links.
      await page.goto('/w/harbor/s/002');
      await control('workspace').click();
      await page.locator('[data-picker="workspace"] [data-workspace="harbor"]').click();
      await expect(page).toHaveURL(/\/w\/harbor$/);

      await control('spec').click();
      await page.locator('[data-picker="spec"] .picker-all').click();
      await expect(page).toHaveURL(/\/w\/harbor#specs$/);
      await expect(page.locator('#specs')).toBeFocused();

      await page.goto('/w/harbor/s/002/status');
      const area = control('area');
      await area.click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();
      await expect(menu.locator('[data-area]')).toHaveCount(6);
      await expect(menu.locator('[data-area][aria-disabled="true"]')).toHaveCount(2);
      await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-area', 'status');
      await menu.locator('[data-area="data"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);
      await expect(menu).toBeHidden();
      await expect(area).toBeFocused();

      await area.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(area).toBeFocused();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);

      await control('live').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/board$/);

      await control('settings').click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.locator('[data-page="settings"] h1')).toBeVisible();
      await expect(page.locator('header')).toHaveCount(1);
    });

    test('header pickers open real lists: choose a workspace, then a spec (T36)', async ({ page }) => {
      const control = (name: string) => page.locator(`header [data-control="${name}"]`);
      await page.goto('/w/harbor/s/002');

      const workspace = control('workspace');
      await workspace.click();
      await expect(workspace).toHaveAttribute('aria-expanded', 'true');
      const workspaces = page.locator('[data-picker="workspace"]');
      await expect(workspaces).toBeVisible();
      await expect(workspaces.locator('[data-workspace]')).toHaveCount(2);
      await expect(workspaces.locator('[aria-current="true"]')).toHaveAttribute('data-workspace', 'harbor');
      await expect(workspaces.locator('[aria-current="true"]')).toBeFocused();
      await expect(workspaces.locator('[data-picker-footer]')).toHaveAttribute('href', '/settings');
      await workspaces.locator('[data-workspace="lantern"]').click();
      await expect(page).toHaveURL(/\/w\/lantern$/);
      await expect(workspaces).toBeHidden();

      await page.goto('/w/harbor/s/002');
      const spec = control('spec');
      await spec.click();
      const specs = page.locator('[data-picker="spec"]');
      await expect(specs).toBeVisible();
      await expect(specs.locator('[aria-current="true"]')).toHaveAttribute('data-spec', '002');
      await expect(specs.locator('[aria-current="true"]')).toBeFocused();
      const other = specs.locator('[data-spec]:not([aria-current])').first();
      const otherId = await other.getAttribute('data-spec');
      await expect(other.locator('ui-chip')).toBeVisible();
      await other.click();
      await expect(page).toHaveURL(new RegExp(`/w/harbor/s/${otherId ?? ''}$`));
      await expect(specs).toBeHidden();
    });

    test('a modified click on a picker leaves the picker shut and keeps the href (T36)', async ({ page }) => {
      await page.goto('/w/harbor/s/002');
      const workspace = page.locator('header [data-control="workspace"]');
      await expect(workspace).toHaveAttribute('href', '/w/harbor');
      await page.locator('[data-picker="workspace"]').first().waitFor({ state: 'attached' });
      await workspace.click({ button: 'middle' });
      await expect(workspace).toHaveAttribute('aria-expanded', 'false');
    });

    test('one header row at medium and wide, two at compact; the pill hugs its 40 px segments (T36)', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const header = page.locator('header');
      await expect(header).toHaveCount(1);
      const box = async (selector: string) => (await page.locator(selector).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      const head = await box('header');
      const brand = await box('header [data-control="brand"]');
      const area = await box('header [data-control="area"]');
      const pickers = await box('header .pickers');
      if (width < 640) {
        expect(head.height).toBeGreaterThanOrEqual(92);
        expect(head.height).toBeLessThanOrEqual(93);
        expect(area.y).toBeGreaterThanOrEqual(brand.y + brand.height - 1);
        expect(pickers.height).toBeLessThanOrEqual(42);
      } else {
        expect(head.height).toBeGreaterThanOrEqual(64);
        expect(head.height).toBeLessThanOrEqual(65);
        expect(Math.abs(area.y - brand.y)).toBeLessThan(12);
      }
      const palette = await box('header [data-control="palette"]');
      expect(Math.round(palette.width)).toBe(width >= 1280 ? 240 : 40);
      await expect(page.locator('header .palette-key')).toBeVisible({ visible: width >= 1280 });
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
