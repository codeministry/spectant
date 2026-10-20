/**
 * Spec 052 (T24, T25): the favourite star across its three places, on the e2e stub, one stub session per test.
 * `bun run e2e -- favorites -g toggle` (ISC-300) and `bun run e2e -- favorites -g unstar-in-select` (ISC-301).
 *
 * - toggle: the star in the spec head, in the workspace dashboard's spec row and in the header spec select show one
 *   state; a click in one place shows the new state in the other two, by in-app navigation only. The accessible name
 *   stays fixed and names the spec, `aria-pressed` carries the state. Zero reloads: one `load` event, and a marker set
 *   on `window` after the first load survives to the end.
 * - unstar-in-select: the star of a select row is a target of its own beside the link; unstarring navigates nowhere,
 *   keeps the select open and drops the row, focus moves to the star of the row that moves up; the last one leaves
 *   the open select in its empty state.
 *
 * Favourites are spec folder names (`003-config-loader`), the select and the dashboard key their rows by the id.
 */
import type { Locator, Page } from '@playwright/test';
import { workspaceRoutes } from '../../server/src/spec-routes.contract.ts';
import { atWidth, expect, menusReady, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const WS = 'harbor';
/**
 * The fixed accessible names of the 003 stars: they name the spec, never the state. The head takes the spec page's
 * title, the dashboard row and the select the list row's title (`SpecRowView.title`), each the title its place shows.
 */
const NAME = 'Favorite: 003 Config loader rewrite';
const ROW_NAME = 'Favorite: 003 Read the config through one loader in the CLI, the API and the console';
const MARKER = '__favoritesStarNoReload';

const picker = (page: Page): Locator => page.locator('[data-picker="spec"]');
const headStar = (page: Page): Locator => page.locator('[data-head-actions] button[ui-star-toggle]');
const rowStar = (page: Page, id: string): Locator => page.locator(`app-spec-row:has([data-spec-row="${id}"]) button[ui-star-toggle]`);

async function openSelect(page: Page): Promise<Locator> {
  await menusReady(page);
  await page.locator('header [data-control="spec"]').click();
  await expect(picker(page)).toBeVisible();
  return picker(page);
}

/** Counts the page's `load` events from the first navigation on and marks the window once it has loaded. */
async function watchReloads(page: Page, path: string): Promise<() => Promise<void>> {
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  await page.goto(path);
  await page.evaluate((key) => Object.assign(window, { [key]: true }), MARKER);
  return async () => {
    expect(loads).toBe(1);
    expect(await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], MARKER)).toBe(true);
  };
}

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `favorites-star-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
  test.describe(`favorites star: toggle at ${width}`, () => {
    test.use(atWidth(width));

    test('the head, the dashboard row and the select show one state, a click in one place moves all three (T24, ISC-300)', async ({ page }) => {
      const noReload = await watchReloads(page, `/w/${WS}/s/003`);

      // Head: fixed name naming 003, not pressed in a fresh session.
      const head = headStar(page);
      await expect(head).toHaveAttribute('aria-pressed', 'false');
      await expect(head).toHaveAccessibleName(NAME);

      await head.click();
      await expect(head).toHaveAttribute('aria-pressed', 'true');
      await expect(head).toHaveAccessibleName(NAME);

      // Select: the 003 row is listed, its star pressed and named like the head's.
      const select = await openSelect(page);
      await expect(select.locator('[data-spec]')).toHaveCount(1);
      await expect(select.locator('[data-spec="003"]')).toBeVisible();
      await expect(select.locator('.picker-empty')).toHaveCount(0);
      const selectStar = select.locator('[data-star="003"]');
      await expect(selectStar).toHaveAttribute('aria-pressed', 'true');
      await expect(selectStar).toHaveAccessibleName(ROW_NAME);

      // In-app to the dashboard through the select's all-specs link: the 003 row's star is pressed.
      await select.locator('.picker-all').click();
      await expect(page).toHaveURL(new RegExp(`/w/${WS}(#specs)?$`));
      const row = rowStar(page, '003');
      await expect(row).toHaveAttribute('aria-pressed', 'true');
      await expect(row).toHaveAccessibleName(ROW_NAME);
      await expect(rowStar(page, '002')).toHaveAttribute('aria-pressed', 'false');

      // Unstar it there, then back in-app on 003: the head star is released and the select is empty.
      await row.click();
      await expect(row).toHaveAttribute('aria-pressed', 'false');
      await expect(row).toHaveAccessibleName(ROW_NAME);
      await page.goBack();
      await expect(page).toHaveURL(new RegExp(`/w/${WS}/s/003$`));
      await expect(headStar(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(headStar(page)).toHaveAccessibleName(NAME);
      const again = await openSelect(page);
      await expect(again.locator('.picker-empty')).toBeVisible();
      await expect(again.locator('[data-spec]')).toHaveCount(0);

      await noReload();
    });
  });

  test.describe(`favorites star: unstar-in-select at ${width}`, () => {
    test.use(atWidth(width));

    test('a select row star unstars in place: no navigation, the select stays open, then the empty state (T25, ISC-301)', async ({ page, request }) => {
      for (const folder of ['002-web-console', '004-retention-policies']) {
        const put = await request.put(workspaceRoutes.favorite(WS, folder), { headers: { [SESSION_HEADER]: session } });
        expect(put.status()).toBe(200);
      }
      const noReload = await watchReloads(page, `/w/${WS}/s/003`);
      const url = page.url();

      const select = await openSelect(page);
      await expect(select.locator('[data-spec]')).toHaveCount(2);
      await expect(select.locator('.picker-empty')).toHaveCount(0);

      await select.locator('[data-star="002"]').click();
      expect(page.url()).toBe(url);
      await expect(select).toBeVisible();
      await expect(select.locator('[data-spec]')).toHaveCount(1);
      await expect(select.locator('[data-spec="004"]')).toBeVisible();
      await expect(select.locator('[data-star="004"]')).toBeFocused();

      await select.locator('[data-star="004"]').click();
      expect(page.url()).toBe(url);
      await expect(select).toBeVisible();
      await expect(select.locator('[data-spec]')).toHaveCount(0);
      await expect(select.locator('.picker-empty')).toBeVisible();
      await expect(select.locator('.picker-all')).toBeFocused();

      await noReload();
    });
  });
}
