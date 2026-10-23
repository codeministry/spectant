/**
 * Spec 052 (T24, T25): the favourite star across its three places, on the e2e stub, one stub session per test.
 * `bun run e2e -- favorites -g toggle` (ISC-300) and `bun run e2e -- favorites -g unstar-in-select` (ISC-301).
 *
 * - toggle: the star in the spec head, in the Specs list's spec row and in the header favourites select (spec 069) show
 *   one state; a click in one place shows the new state in the others, by in-app navigation only (the Specs list is
 *   reached through the page select). A star set in the spec head lists the row in the favourites select, and a star
 *   released in the select releases the head star (spec 069 T25, ISC-560, ISC-300 held). The accessible name stays
 *   fixed and names the spec, `aria-pressed` carries the state. Zero reloads: one `load` event, no `document` request
 *   after the first navigation, and a marker set on `window` after the first load survives to the end.
 * - unstar-in-select: the star of a select row is a target of its own beside the link; unstarring navigates nowhere,
 *   keeps the select open and drops the row, focus moves to the star of the row that moves up; the last one leaves
 *   the open select in its empty state, which takes the focus (the favourites select has no "Spec overview" link).
 * - bracket keys (T28, ISC-331; `bun run e2e -- favorites -g "bracket keys"`), at 1440 only: with two favourites that
 *   are no neighbours in harbor's row order, `]` / `[` from a favourite and from a spec without a star go to the
 *   nearest favourite that way, on the same tab; without favourites they step to the neighbouring row as
 *   `keyboard.spec.ts` does. The targets come from the dashboard's real order, never from hard-coded ids.
 *
 * Favourites are spec folder names (`003-config-loader`), the select and the dashboard key their rows by the id.
 */
import type { APIRequestContext, Locator, Page, Request } from '@playwright/test';
import { SPEC_API_ROOT, workspaceRoutes } from '../../server/src/contracts/spec-routes.contract.ts';
import { atWidth, expect, headerControl, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const WS = 'harbor';
/**
 * The fixed accessible names of the 003 stars: they name the spec, never the state. The head takes the spec page's
 * title, the dashboard row and the select the list row's title (`SpecRowView.title`), each the title its place shows.
 */
const NAME = 'Favorite: 003 Config loader rewrite';
const ROW_NAME = 'Favorite: 003 Read the config through one loader in the CLI, the API and the console';
const MARKER = '__favoritesStarNoReload';

const picker = (page: Page): Locator => page.locator('nav[data-picker="favorites"]');
const headStar = (page: Page): Locator => page.locator('[data-head-actions] button[ui-star-toggle]');
const rowStar = (page: Page, id: string): Locator => page.locator(`app-spec-row:has([data-spec-row="${id}"]) button[ui-star-toggle]`);

async function openSelect(page: Page): Promise<Locator> {
  await (await headerControl(page, 'favorites')).click();
  await expect(picker(page)).toBeVisible();
  return picker(page);
}

async function closeSelect(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
}

/** In-app to the workspace's Specs list through the page select (spec 024), as a viewer goes there. */
async function toSpecsList(page: Page): Promise<void> {
  await (await headerControl(page, 'page')).click();
  const pages = page.getByRole('navigation', { name: 'Pages' });
  await expect(pages).toBeVisible();
  await pages.locator('[data-page="specs"]').click();
  await expect(page).toHaveURL(new RegExp(`/w/${WS}/specs$`));
}

/**
 * Counts the page's `load` events from the first navigation on, marks the window once it has loaded and collects every
 * `document` request after it.
 */
async function watchReloads(page: Page, path: string): Promise<() => Promise<void>> {
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  await page.goto(path);
  await page.evaluate((key) => Object.assign(window, { [key]: true }), MARKER);
  const documents: string[] = [];
  page.on('request', (req: Request) => {
    if (req.resourceType() === 'document') documents.push(req.url());
  });
  return async () => {
    expect(documents).toEqual([]);
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

    test('the head, the dashboard row and the select show one state, a click in one place moves all three (T24, ISC-300; spec 069 T25, ISC-560)', async ({ page }) => {
      const noReload = await watchReloads(page, `/w/${WS}/s/003`);

      // Head: fixed name naming 003, not pressed in a fresh session.
      const head = headStar(page);
      await expect(head).toHaveAttribute('aria-pressed', 'false');
      await expect(head).toHaveAccessibleName(NAME);

      await head.click();
      await expect(head).toHaveAttribute('aria-pressed', 'true');
      await expect(head).toHaveAccessibleName(NAME);

      // Favourites select (ISC-560): the 003 row is listed in harbor's group, its star pressed and named like the list row's.
      const select = await openSelect(page);
      await expect(select.locator('[data-spec]')).toHaveCount(1);
      await expect(select.locator(`[data-favorites-group="${WS}"] [data-spec="003"]`)).toBeVisible();
      await expect(select.locator('.picker-empty')).toHaveCount(0);
      const selectStar = select.locator('[data-star="003"]');
      await expect(selectStar).toHaveAttribute('aria-pressed', 'true');
      await expect(selectStar).toHaveAccessibleName(ROW_NAME);

      // Released in the select (ISC-560): the row leaves it, and the head star follows without a reload.
      await selectStar.click();
      await expect(select.locator('[data-spec]')).toHaveCount(0);
      await expect(select.locator('.picker-empty')).toBeVisible();
      await closeSelect(page);
      await expect(page).toHaveURL(new RegExp(`/w/${WS}/s/003$`));
      await expect(headStar(page)).toHaveAttribute('aria-pressed', 'false');
      await expect(headStar(page)).toHaveAccessibleName(NAME);

      // Set again in the head, then in-app to the Specs page (spec 058) through the page select: the 003 row's star is pressed.
      await headStar(page).click();
      await expect(headStar(page)).toHaveAttribute('aria-pressed', 'true');
      await toSpecsList(page);
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
      await expect(select.locator('[data-favorites-group]')).toHaveCount(0);
      await expect(select.locator('.picker-empty')).toBeFocused();

      await noReload();
    });
  });
}

/** A dashboard spec row: the id the URL takes and the folder name a favourite stores. */
interface Row {
  readonly id: string;
  readonly slug: string;
}

/** Harbor's active spec rows in the dashboard's row order, the order `[` / `]` walk. */
async function harborRows(request: APIRequestContext): Promise<Row[]> {
  const answer = await request.get(`${SPEC_API_ROOT}/${WS}/dashboard`, { headers: { [SESSION_HEADER]: session } });
  expect(answer.status()).toBe(200);
  const body = (await answer.json()) as { specs?: Array<{ id: string; slug?: string }> };
  return (body.specs ?? []).map((spec) => ({ id: spec.id, slug: spec.slug ?? spec.id }));
}

/** Opens a harbor spec route and waits until the shell holds the dashboard order and the favourite set. */
async function openSpec(page: Page, path: string): Promise<void> {
  const loaded = (route: string) => page.waitForResponse((response) => response.url().endsWith(`/${WS}/${route}`) && response.ok());
  const both = Promise.all([loaded('dashboard'), loaded('favorites')]);
  await page.goto(path);
  await both;
  await expect(page.locator('#spec-title')).toBeVisible();
}

const onTab = (id: string): RegExp => new RegExp(`/w/${WS}/s/${id}/claims$`);

test.describe(`favorites star: bracket keys at ${WIDTHS.desktop}`, () => {
  test.use(atWidth(WIDTHS.desktop));

  /**
   * Two favourites that are no neighbours in the row order: `before` precedes both, `mid` and `mid2` stand between
   * them, so a favourite step lands elsewhere than a plain step to the neighbouring row.
   */
  async function seed(request: APIRequestContext) {
    const rows = await harborRows(request);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    const [before, a, mid, mid2, b] = rows as [Row, Row, Row, Row, Row];
    for (const folder of [a.slug, b.slug]) {
      const put = await request.put(workspaceRoutes.favorite(WS, folder), { headers: { [SESSION_HEADER]: session } });
      expect(put.status()).toBe(200);
    }
    return { before, a, mid, mid2, b };
  }

  test('] and [ from a favourite step to the next and previous favourite on the same tab (T28, ISC-331)', async ({ page, request }) => {
    const { a, b } = await seed(request);
    await openSpec(page, `/w/${WS}/s/${a.id}/claims`);
    await expect(headStar(page)).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press(']');
    await expect(page).toHaveURL(onTab(b.id));
    await expect(page.locator('#spec-title')).toBeVisible();
    await expect(headStar(page)).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('[');
    await expect(page).toHaveURL(onTab(a.id));
    await expect(page.locator('#spec-title')).toBeVisible();
  });

  test('] and [ from a spec without a star step to the nearest favourite that way on the same tab (T28, ISC-331)', async ({ page, request }) => {
    const { before, a, mid, mid2, b } = await seed(request);

    await openSpec(page, `/w/${WS}/s/${mid.id}/claims`);
    await expect(headStar(page)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press(']');
    await expect(page).toHaveURL(onTab(b.id));
    await expect(page.locator('#spec-title')).toBeVisible();

    await openSpec(page, `/w/${WS}/s/${mid2.id}/claims`);
    await expect(headStar(page)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('[');
    await expect(page).toHaveURL(onTab(a.id));
    await expect(page.locator('#spec-title')).toBeVisible();

    await openSpec(page, `/w/${WS}/s/${before.id}/claims`);
    await page.keyboard.press(']');
    await expect(page).toHaveURL(onTab(a.id));
    await expect(page.locator('#spec-title')).toBeVisible();
  });

  test('without favourites ] and [ step to the neighbouring spec row on the same tab, as before (T28, ISC-331)', async ({ page, request }) => {
    const [, , mid, mid2] = (await harborRows(request)) as [Row, Row, Row, Row];
    await openSpec(page, `/w/${WS}/s/${mid.id}/claims`);

    await page.keyboard.press(']');
    await expect(page).toHaveURL(onTab(mid2.id));
    await expect(page.locator('#spec-title')).toBeVisible();

    await page.keyboard.press('[');
    await expect(page).toHaveURL(onTab(mid.id));
    await expect(page.locator('#spec-title')).toBeVisible();
  });
});
