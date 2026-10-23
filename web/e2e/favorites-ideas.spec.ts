/**
 * Spec 064 (T55 · ISC-499): an idea favourite in the real browser, at 1440 and 390 px, on the e2e stub, one stub session
 * per test (the stub keeps idea favourites per session). `bun run e2e -- favorites-ideas -g "idea favorite"`.
 *
 * On `/w/harbor/specs` the star of an idea row presses in place: no `?sel=`, no navigation, no reload. The header's
 * favourites select (spec 069) then lists the idea in harbor's group under the favourite spec, behind the hairline, with
 * the lightbulb and the idea page's
 * link; after `page.reload()` it is still there. Unstarring it in the select drops it from the select and releases the
 * list row's star, and a reload keeps it gone.
 *
 * The idea comes from the harbor golden the stub serves, so it follows the fixture rather than a copy.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { workspaceRoutes } from '../../server/src/contracts/spec-routes.contract.ts';
import { atWidth, expect, headerControl, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const golden = JSON.parse(readFileSync(new URL('../../core/fixtures/harbor.golden.json', import.meta.url), 'utf8')) as {
  ideas: { list: ReadonlyArray<{ slug: string; title: string }> };
};
const WS = 'harbor';
const FIRST_IDEA = golden.ideas.list[0];
if (FIRST_IDEA === undefined) throw new Error('harbor.golden.json: no idea left to star');
const IDEA: { slug: string; title: string } = FIRST_IDEA;
/** A spec favourite seeded beside the idea, so "under the specs" is an order the test can see. */
const SPEC_FAVORITE = { folder: '003-config-loader', id: '003' } as const;
const MARKER = '__favoritesIdeasNoReload';

const ideaRow = (page: Page): Locator =>
  page.locator('ol.rows > li > app-idea-row').filter({ has: page.locator(`a.link[href="/w/${WS}/ideas/${IDEA.slug}"]`) });
const rowStar = (page: Page): Locator => ideaRow(page).locator('span.rstar[data-cell="star"] button');

/** The header favourites select (spec 069) that took over from the spec select. */
async function openSelect(page: Page): Promise<Locator> {
  await (await headerControl(page, 'favorites')).click();
  const picker = page.locator('nav[data-picker="favorites"]');
  await expect(picker).toBeVisible();
  return picker;
}

async function closeSelect(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('nav[data-picker="favorites"]')).toBeHidden();
}

/**
 * The idea entry of the open select: in harbor's group, listed after every spec row, behind the hairline, lightbulb and
 * idea link.
 */
async function expectListed(outer: Locator): Promise<void> {
  const picker = outer.locator(`[data-favorites-group="${WS}"]`);
  const entry = picker.locator(`a[data-idea="${IDEA.slug}"]`);
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute('href', `/w/${WS}/ideas/${IDEA.slug}`);
  await expect(entry.locator('ui-icon[name="lightbulb"]')).toHaveCount(1);
  await expect(entry).toContainText(IDEA.title);
  await expect(picker.locator('[data-favorites-sep]')).toHaveCount(1);
  const order = await picker
    .locator('[data-spec], [data-favorites-sep], a[data-idea]')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-spec') ?? node.getAttribute('data-idea') ?? 'sep'));
  expect(order).toEqual([SPEC_FAVORITE.id, 'sep', IDEA.slug]);
}

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `favorites-ideas-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  const put = await request.put(workspaceRoutes.favorite(WS, SPEC_FAVORITE.folder), { headers: { [SESSION_HEADER]: session } });
  expect(put.ok()).toBe(true);
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
  test.describe(`idea favorite at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`idea favorite: the list star lists the idea in the header select, across a reload, until it is unstarred, at ${String(width)} (T55, ISC-499)`, async ({ page }) => {
      let loads = 0;
      page.on('load', () => {
        loads += 1;
      });
      await page.goto(`/w/${WS}/specs`);
      await page.evaluate((key) => Object.assign(window, { [key]: true }), MARKER);
      const star = rowStar(page);
      await expect(star).toHaveAttribute('aria-pressed', 'false');

      // Before the star: the select holds the spec favourite and no idea.
      const before = await openSelect(page);
      await expect(before.locator(`[data-spec="${SPEC_FAVORITE.id}"]`)).toBeVisible();
      await expect(before.locator('a[data-idea]')).toHaveCount(0);
      await closeSelect(page);

      // The star presses in place: no selection, no navigation, no reload.
      await star.click();
      await expect(star).toHaveAttribute('aria-pressed', 'true');
      await expect(page).toHaveURL(`/w/${WS}/specs`);
      expect(new URL(page.url()).searchParams.has('sel')).toBe(false);
      expect(loads).toBe(1);
      expect(await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], MARKER)).toBe(true);

      await expectListed(await openSelect(page));
      await closeSelect(page);

      // Stored, not page state: a reload lists it again.
      await page.reload();
      await expect(rowStar(page)).toHaveAttribute('aria-pressed', 'true');
      const picker = await openSelect(page);
      await expectListed(picker);

      // Unstar in the select: the entry goes, the spec favourite and the list star follow.
      await picker.locator(`[data-star="idea:${IDEA.slug}"]`).click();
      await expect(picker.locator(`a[data-idea="${IDEA.slug}"]`)).toHaveCount(0);
      await expect(picker.locator('[data-favorites-sep]')).toHaveCount(0);
      await expect(picker.locator(`[data-spec="${SPEC_FAVORITE.id}"]`)).toBeVisible();
      await closeSelect(page);
      await expect(rowStar(page)).toHaveAttribute('aria-pressed', 'false');

      await page.reload();
      const after = await openSelect(page);
      await expect(after.locator(`[data-spec="${SPEC_FAVORITE.id}"]`)).toBeVisible();
      await expect(after.locator('a[data-idea]')).toHaveCount(0);
    });
  });
}
