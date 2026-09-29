/**
 * ISC-76: the area menu and the tab bar of the spec page against the stub API. `bun run e2e -- spec -g "deep link"` is
 * the claim's probe: `/w/harbor/s/002/claims` selects the Data area and the Claims tab from the URL alone, the area
 * menu marks Data `aria-current="page"`, and the tab bar shows only Claims · Tasks · Evidence with the counts the spec
 * model carries. Live and Notes are disabled entries with their reason while their views are not built.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SpecPageModel } from '../../core/src/files.ts';
import { atWidth, expect, test } from './fixtures';

const GOLDEN = fileURLToPath(new URL('../../core/fixtures/harbor.spec.golden.json', import.meta.url));
const HARBOR_002 = (JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, SpecPageModel>)['specs/002-web-console'];
if (!HARBOR_002) throw new Error('harbor.spec.golden.json holds no specs/002-web-console');
const { claims, tasks } = HARBOR_002.areas.data;

const REASON = "Comes with this spec's later tasks";
const TIERS = [
  { width: 390, tier: 'compact' },
  { width: 820, tier: 'medium' },
  { width: 1440, tier: 'wide' },
] as const;

for (const { width, tier } of TIERS) {
  test.describe(`spec at ${String(width)}`, () => {
    test.use(atWidth(width));

    test('deep link selects the Data area and the Claims tab', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims');
      await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);

      const trigger = page.locator('header [data-control="area"]');
      await expect(trigger).toHaveAccessibleName('Area: Data');
      await expect(trigger).toContainText('Data');

      const tabs = page.locator('app-tab-bar a');
      await expect(tabs).toHaveCount(3);
      expect(await tabs.evaluateAll((links) => links.map((link) => link.getAttribute('data-tab')))).toEqual(['claims', 'tasks', 'evidence']);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'claims');
      await expect(page.locator('app-tab-bar [data-count="claims"]')).toHaveText(`${String(claims.closed)}/${String(claims.total)}`);
      if (tasks) await expect(page.locator('app-tab-bar [data-count="tasks"]')).toHaveText(`${String(tasks.landed)}/${String(tasks.total)}`);
      await expect(page.locator('app-tab-bar [data-count="evidence"]')).toHaveCount(0);

      await trigger.click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(menu.locator('[data-area]')).toHaveCount(6);
      await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-area', 'data');
      await expect(menu.locator('[role="menu"], [role="menuitem"]')).toHaveCount(0);
    });

    test('area menu shows Live and Notes disabled with their reason', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      await page.locator('header [data-control="area"]').click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();

      for (const area of ['live', 'notes']) {
        const entry = menu.locator(`[data-area="${area}"]`);
        await expect(entry, area).toHaveAttribute('aria-disabled', 'true');
        await expect(entry, area).toContainText(REASON);
        await expect(entry, area).not.toHaveAttribute('href', /.*/);
      }
      await menu.locator('[data-area="live"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/status$/);

      const rows = await menu.locator('[data-area]').evaluateAll((entries) => entries.map((entry) => entry.getBoundingClientRect().height));
      for (const height of rows) expect(height).toBeGreaterThanOrEqual(tier === 'compact' ? 56 : 44);
      if (tier === 'compact') {
        await expect(page.locator('dialog[open]')).toHaveCount(1);
        await expect(page.locator('dialog[open]')).toContainText('Claims');
      } else {
        await expect(page.locator(':popover-open')).toHaveCount(1);
      }
    });

    test('switching the tab bar changes the URL', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims');
      await page.locator('app-tab-bar a[data-tab="tasks"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/tasks$/);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'tasks');
      await expect(page.locator('header [data-control="area"]')).toHaveAccessibleName('Area: Data');

      await page.locator('app-tab-bar a[data-tab="evidence"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/evidence$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/tasks$/);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'tasks');
    });
  });
}
