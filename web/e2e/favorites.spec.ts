/**
 * Spec 052 (T22 · ISC-298, T23 · ISC-299, T26 · ISC-302): the header's spec select lists the workspace's favourites
 * alone, in the dashboard's order, with the overview link under them; without a favourite it shows a hint and focuses
 * that link. Against the stub API's per-session `…/favorites`, one stub session per test, seeded with `PUT`s.
 * `bun run e2e -- favorites -g select|empty|stale`.
 *
 * - select: two favourites seeded in the order opposite to the dashboard's, the open spec 002 not among them; at 1440
 *   (popover) and 390 (bottom sheet) the select lists exactly those two rows in the dashboard's order, never 002.
 * - empty: no favourite leaves no row, the hint (in en and de) and the overview link, which holds the focus.
 * - stale: favourites on an archived and an unknown folder leave the empty state; one real favourite beside them is
 *   the one row.
 *
 * The expected order is read from the harbor golden the stub serves, so it follows the fixture rather than a copy.
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { workspaceRoutes } from '../../server/src/contracts/spec-routes.contract.ts';
import { atWidth, expect, headerControl, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const golden = JSON.parse(readFileSync(new URL('../../core/fixtures/harbor.golden.json', import.meta.url), 'utf8')) as {
  specs: ReadonlyArray<{ id: string; slug: string }>;
};
/** The active specs as the dashboard orders them (not by id): the order the select keeps. */
const DASHBOARD = golden.specs;
const OPEN = '002';
if (!DASHBOARD.some((spec) => spec.id === OPEN)) throw new Error(`harbor.golden.json: ${OPEN} is no longer an active spec`);
/** Seeded in sorted order; the dashboard lists 006 before 003, so a sorted list would fail the order check. */
const FAVORITES = ['003-config-loader', '006-partial-push'] as const;
const ARCHIVED = '001-manifest-sync';
const UNKNOWN = '999-not-there';
const HINT = {
  en: 'No favorites yet. Star a spec on its page or in the spec list to see it here.',
  de: 'Noch keine Favoriten. Markieren Sie eine Spec auf ihrer Seite oder in der Spec-Liste mit dem Stern, dann erscheint sie hier.',
} as const;

const idsIn = (folders: readonly string[]): string[] =>
  DASHBOARD.filter((spec) => folders.includes(spec.slug)).map((spec) => spec.id);

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `favorites-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

/** Stores `folders` as harbor's favourites for this test's session, one `PUT` each, and the language when given. */
async function seed(request: APIRequestContext, folders: readonly string[], language?: 'en' | 'de'): Promise<void> {
  const headers = { [SESSION_HEADER]: session };
  for (const folder of folders) {
    const put = await request.put(workspaceRoutes.favorite('harbor', folder), { headers });
    expect(put.ok(), folder).toBe(true);
  }
  if (language !== undefined) expect((await request.put('/api/settings', { data: { language }, headers })).ok()).toBe(true);
}

/** Opens the header's spec select on the open page; a popover from 640 px, the bottom sheet below. */
async function openSelect(page: Page, width: number): Promise<Locator> {
  await (await headerControl(page, 'spec')).click();
  const picker = page.locator('nav[data-picker="spec"]');
  await expect(picker).toBeVisible();
  await expect(picker.locator(`xpath=ancestor::${width < 640 ? 'ui-sheet' : 'ui-popover'}`)).toHaveCount(1);
  return picker;
}

const rowIds = (picker: Locator): Promise<string[]> =>
  picker.locator('[data-spec]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-spec') ?? ''));

for (const width of [WIDTHS.desktop, WIDTHS.phone] as const) {
  test.describe(`select at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`select lists exactly the favourites in the dashboard's order, not the open spec, at ${String(width)} (T22)`, async ({ page, request }) => {
      await seed(request, FAVORITES);
      const expected = idsIn(FAVORITES);
      expect(expected).toEqual(['006', '003']);
      await page.goto(`/w/harbor/s/${OPEN}`);
      const picker = await openSelect(page, width);
      await expect(picker.locator('[data-spec]')).toHaveCount(expected.length);
      expect(await rowIds(picker)).toEqual(expected);
      await expect(picker.locator(`[data-spec="${OPEN}"]`)).toHaveCount(0);
      await expect(picker.locator('.picker-empty')).toHaveCount(0);
      await expect(picker.locator('.picker-all')).toBeVisible();
      await expect(picker.locator('.picker-all')).toHaveAttribute('href', '/w/harbor/specs');
    });
  });

  test.describe(`empty at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const language of ['en', 'de'] as const) {
      test(`empty: no favourite leaves the hint in ${language} and focuses the overview link at ${String(width)} (T23)`, async ({ page, request }) => {
        await seed(request, [], language);
        await page.goto(`/w/harbor/s/${OPEN}`);
        const picker = await openSelect(page, width);
        await expect(picker.locator('.picker-empty')).toBeVisible();
        await expect(picker.locator('.picker-empty')).toHaveText(HINT[language]);
        await expect(picker.locator('[data-spec]')).toHaveCount(0);
        await expect(picker.locator('.picker-all')).toBeVisible();
        await expect(picker.locator('.picker-all')).toBeFocused();
      });
    }
  });

  test.describe(`stale at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`stale: favourites on an archived and an unknown folder leave no row and the hint at ${String(width)} (T26)`, async ({ page, request }) => {
      await seed(request, [ARCHIVED, UNKNOWN]);
      await page.goto(`/w/harbor/s/${OPEN}`);
      const picker = await openSelect(page, width);
      await expect(picker.locator('.picker-empty')).toBeVisible();
      await expect(picker.locator('[data-spec]')).toHaveCount(0);
      await expect(picker.locator('.picker-all')).toBeVisible();
    });

    test(`stale: one real favourite beside them is the one row at ${String(width)} (T26)`, async ({ page, request }) => {
      await seed(request, [ARCHIVED, UNKNOWN, FAVORITES[0]]);
      await page.goto(`/w/harbor/s/${OPEN}`);
      const picker = await openSelect(page, width);
      await expect(picker.locator('[data-spec]')).toHaveCount(1);
      expect(await rowIds(picker)).toEqual(idsIn([FAVORITES[0]]));
      await expect(picker.locator('.picker-empty')).toHaveCount(0);
      await expect(picker.locator('.picker-all')).toBeVisible();
    });
  });
}
