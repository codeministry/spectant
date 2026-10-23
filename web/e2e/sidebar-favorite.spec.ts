/**
 * Spec 067 · T26 · ISC-532 (`bun run e2e -- sidebar -g "favorite"`): the detail sidebar's head carries the favourite star
 * for a spec and an idea. Pressing it sets the favourite, pressing it again releases it, and the new state shows without
 * a reload in the sidebar, on the item's row star in the Specs list and in the header spec select: `aria-pressed` is the
 * same at all three places. The select lists favourites only, so a released favourite is absent there.
 *
 * At 1440 the sidebar docks beside the list, the list row and the select are read with the sidebar open. At 390 the
 * sidebar is the modal bottom sheet: the test closes it before it reads the list and the select, and reopens it from the
 * row to release the star.
 *
 * Zero reloads: no document request after the first navigation, one `load` event, and a marker set on `window` after
 * the first load survives to the end. One stub session per test, reset before and after (favourites live per session).
 */
import type { Locator, Page, Request } from '@playwright/test';
import { atWidth, expect, headerControl, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const WS = 'harbor';
const SPEC = '002';
const IDEA = 'console-audit-log';
const MARKER = '__sidebarFavoriteNoReload';

/** One item the sidebar can star: how to choose it in the list, its list star, its select entry and select star. */
interface Item {
  readonly name: string;
  readonly ref: string;
  readonly choose: (page: Page) => Locator;
  readonly rowStar: (page: Page) => Locator;
  readonly entry: (picker: Locator) => Locator;
  readonly selectStar: (picker: Locator) => Locator;
}

const ITEMS: readonly Item[] = [
  {
    name: `spec ${SPEC}`,
    ref: `spec:${SPEC}`,
    choose: (page) => page.locator(`a.row-link[data-ref="spec:${SPEC}"]`),
    rowStar: (page) => page.locator(`app-spec-row:has([data-spec-row="${SPEC}"]) button[ui-star-toggle]`),
    entry: (picker) => picker.locator(`[data-spec="${SPEC}"]`),
    selectStar: (picker) => picker.locator(`[data-star="${SPEC}"]`),
  },
  {
    name: `idea ${IDEA}`,
    ref: `idea:${IDEA}`,
    choose: (page) => page.locator(`app-spec-table app-idea-row[data-idea="${IDEA}"] a.link`),
    rowStar: (page) => page.locator(`app-idea-row[data-idea="${IDEA}"] span.rstar[data-cell="star"] button`),
    entry: (picker) => picker.locator(`a[data-idea="${IDEA}"]`),
    selectStar: (picker) => picker.locator(`[data-star="idea:${IDEA}"]`),
  },
];

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const sidebarStar = (page: Page): Locator => sidebar(page).locator('button[ui-star-toggle].star');
const picker = (page: Page): Locator => page.locator('nav[data-picker="spec"]');

async function openSelect(page: Page): Promise<Locator> {
  await (await headerControl(page, 'spec')).click();
  await expect(picker(page)).toBeVisible();
  return picker(page);
}

async function closeSelect(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(picker(page)).toBeHidden();
}

/** The select shows the item with its star pressed, or lists it no more once it is released. */
async function expectSelect(page: Page, item: Item, pressed: boolean): Promise<void> {
  const select = await openSelect(page);
  if (pressed) {
    await expect(item.entry(select)).toBeVisible();
    await expect(item.selectStar(select)).toHaveAttribute('aria-pressed', 'true');
  } else {
    await expect(item.entry(select)).toHaveCount(0);
    await expect(item.selectStar(select)).toHaveCount(0);
  }
  await closeSelect(page);
}

/** Opens the Specs list and counts every document request and `load` event from then on. */
async function watchReloads(page: Page): Promise<() => Promise<void>> {
  const documents: string[] = [];
  let loads = 0;
  await page.goto(`/w/${WS}/specs`);
  await page.evaluate((key) => Object.assign(window, { [key]: true }), MARKER);
  page.on('request', (req: Request) => {
    if (req.resourceType() === 'document') documents.push(req.url());
  });
  page.on('load', () => {
    loads += 1;
  });
  return async () => {
    expect(documents).toEqual([]);
    expect(loads).toBe(0);
    expect(await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], MARKER)).toBe(true);
  };
}

async function chooseInList(page: Page, item: Item, presentation: string): Promise<void> {
  await item.choose(page).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(item.ref);
  await expect(sidebar(page)).toHaveAttribute('data-presentation', presentation);
}

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `sidebar-favorite-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

test.describe(`sidebar favorite at ${String(WIDTHS.desktop)}`, () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const item of ITEMS) {
    test(`sidebar favorite: the star of ${item.name} sets and releases it in the sidebar, the list and the header select without a reload (T26, ISC-532)`, async ({ page }) => {
      const noReload = await watchReloads(page);
      await chooseInList(page, item, 'docked');
      const star = sidebarStar(page);
      await expect(star).toHaveAttribute('aria-pressed', 'false');
      await expect(item.rowStar(page)).toHaveAttribute('aria-pressed', 'false');

      await star.click();
      await expect(star).toHaveAttribute('aria-pressed', 'true');
      await expect(item.rowStar(page)).toHaveAttribute('aria-pressed', 'true');
      await expectSelect(page, item, true);

      await star.click();
      await expect(star).toHaveAttribute('aria-pressed', 'false');
      await expect(item.rowStar(page)).toHaveAttribute('aria-pressed', 'false');
      await expectSelect(page, item, false);

      await noReload();
    });
  }
});

test.describe(`sidebar favorite at ${String(WIDTHS.phone)}`, () => {
  test.use(atWidth(WIDTHS.phone));

  for (const item of ITEMS) {
    test(`sidebar favorite: the sheet's star of ${item.name} sets and releases it in the sheet, the list and the header select without a reload (T26, ISC-532)`, async ({ page }) => {
      const noReload = await watchReloads(page);
      await chooseInList(page, item, 'sheet');
      await expect(sidebarStar(page)).toHaveAttribute('aria-pressed', 'false');

      await sidebarStar(page).click();
      await expect(sidebarStar(page)).toHaveAttribute('aria-pressed', 'true');
      await sidebar(page).locator('[data-close]').click();
      await expect(sidebar(page)).toHaveCount(0);
      await expect(item.rowStar(page)).toHaveAttribute('aria-pressed', 'true');
      await expectSelect(page, item, true);

      await chooseInList(page, item, 'sheet');
      await expect(sidebarStar(page)).toHaveAttribute('aria-pressed', 'true');
      await sidebarStar(page).click();
      await expect(sidebarStar(page)).toHaveAttribute('aria-pressed', 'false');
      await sidebar(page).locator('[data-close]').click();
      await expect(sidebar(page)).toHaveCount(0);
      await expect(item.rowStar(page)).toHaveAttribute('aria-pressed', 'false');
      await expectSelect(page, item, false);

      await noReload();
    });
  }
});
