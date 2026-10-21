/**
 * Spec 058 · T39 · ISC-397: the workspace has two pages, reached through the header's page menu and stable on reload.
 *
 *   bun run e2e -- workspace-split -g "dashboard and specs"
 *
 * At 1440 and 390 px, against the stub API: `/w/harbor` shows the dashboard (its title, the KPI band) and no spec list;
 * the PAGE select (`header [data-control="page"]`, a popover at 1440, a bottom sheet at 390) opens the page menu
 * (`nav[aria-label="Pages"]`), whose Specs entry leads to `/w/harbor/specs`, where the list (`[data-panel="specs"]`)
 * and its first row show; a reload keeps that URL and that view. The menu's Dashboard entry leads back, and a reload
 * there shows the dashboard again, still without the list.
 *
 * The real-Chromium layout checks of the same split (ISC-392, ISC-393, ISC-398) live in `browser/workspace-split.spec.ts`;
 * the e2e suite ignores `browser/`, so the file filter `workspace-split` selects only this file here.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, headerControl, test, WIDTHS } from './fixtures';

/** The spec list: the spec table's host and its rows (`spec-table.ts`). */
const LIST = '[data-panel="specs"]';
const ROW = `${LIST} [data-spec-row]`;

/** The dashboard's title and its first block (`dashboard-page.html`). */
async function expectDashboard(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/w\/harbor$/);
  await expect(page.locator('app-dashboard-page h1')).toHaveText('Dashboard · harbor');
  await expect(page.locator('app-dashboard-page app-kpi-band')).toBeVisible();
  await expect(page.locator(LIST)).toHaveCount(0);
}

/** The spec list page: its URL, the list and its first row visible. */
async function expectSpecs(page: Page): Promise<void> {
  await expect(page).toHaveURL(/\/w\/harbor\/specs$/);
  await expect(page.locator('app-specs-page h1')).toHaveText('Specs · harbor');
  await expect(page.locator(LIST)).toBeVisible();
  await expect(page.locator(ROW).first()).toBeVisible();
  await expect(page.locator('app-dashboard-page')).toHaveCount(0);
}

/** Open the page menu from the PAGE select and follow one of its entries. */
async function viaPageMenu(page: Page, id: 'dashboard' | 'specs'): Promise<void> {
  await (await headerControl(page, 'page')).click();
  const entry = page.locator(`nav[aria-label="Pages"] a.entry[data-page="${id}"]`);
  await expect(entry).toBeVisible();
  await entry.click();
}

for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
  test.describe(`dashboard and specs (ISC-397) · ${String(width)} px`, () => {
    test.use(atWidth(width));

    test(`dashboard, page menu to Specs, reload both at ${String(width)} px`, async ({ page }) => {
      await page.goto('/w/harbor');
      await expectDashboard(page);

      await viaPageMenu(page, 'specs');
      await expectSpecs(page);
      await page.reload();
      await expectSpecs(page);

      await viaPageMenu(page, 'dashboard');
      await expectDashboard(page);
      await page.reload();
      await expectDashboard(page);
    });
  });
}
