/**
 * Spec 052 (T22 · ISC-298, T23 · ISC-299, T26 · ISC-302), moved onto the header's favourites select by spec 069 (T21):
 * the select lists the workspace's favourites alone, in the dashboard's order; without a favourite it shows a hint
 * and keeps the focus inside the select. Spec 069 adds (T16 · ISC-552) where its trigger stands, (T17 · ISC-556) that
 * it is on every page with the same favourites of every workspace, and (T18 · ISC-559) that a row's star unsets the
 * favourite in that row's own workspace. Against the stub API's per-session `…/favorites`, one stub session per test,
 * seeded with `PUT`s. `bun run e2e -- favorites -g select|empty|stale|position|everywhere|unstar`.
 *
 * - select: two favourites seeded in the order opposite to the dashboard's, the open spec 002 not among them; at 1440
 *   (popover) and 390 (bottom sheet) the select lists exactly those two rows in the dashboard's order, never 002, and
 *   no link to the spec overview.
 * - empty: no favourite leaves no row and the hint (in en and de); the focus stays inside the open select.
 * - stale: favourites on an archived and an unknown folder leave the empty state; one real favourite beside them is
 *   the one row.
 * - position: at 390, 820 and 1440 on `/`, `/w/harbor` and `/w/harbor/s/002` the trigger shares the palette's row,
 *   ends before it and no other control lies between them.
 * - everywhere: favourites in harbor and lantern; the trigger and the same set of rows on six pages.
 * - unstar: open on `/w/harbor`, a lantern row's star sends one DELETE to lantern, keeps URL and select, drops the row,
 *   then lantern's head, and the last favourite leaves the empty state while the select stays open.
 *
 * The expected order is read from the harbor golden the stub serves, so it follows the fixture rather than a copy.
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Locator, Page, Request } from '@playwright/test';
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
/** lantern's two active specs (lantern golden), the second workspace's favourites. */
const LANTERN = ['001-reading-list', '002-duplicate-links'] as const;
/** A story harbor's dashboard lists (harbor golden `ideas`). */
const HARBOR_IDEA = 'console-audit-log';
const HINT = {
  en: 'No favorites yet. Star a spec or an idea on its page to see it here.',
  de: 'Noch keine Favoriten. Markieren Sie eine Spec oder eine Idee auf ihrer Seite mit dem Stern, dann erscheint sie hier.',
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

/** Stores `folders` as the favourites of `ws` for this test's session, one `PUT` each, and the language when given. */
async function seed(request: APIRequestContext, folders: readonly string[], language?: 'en' | 'de', ws = 'harbor'): Promise<void> {
  const headers = { [SESSION_HEADER]: session };
  for (const folder of folders) {
    const put = await request.put(workspaceRoutes.favorite(ws, folder), { headers });
    expect(put.ok(), `${ws}/${folder}`).toBe(true);
  }
  if (language !== undefined) expect((await request.put('/api/settings', { data: { language }, headers })).ok()).toBe(true);
}

/** Stores the story `slug` as a favourite idea of `ws` for this test's session. */
async function seedIdea(request: APIRequestContext, ws: string, slug: string): Promise<void> {
  const put = await request.put(workspaceRoutes.ideaFavorite(ws, slug), { headers: { [SESSION_HEADER]: session } });
  expect(put.ok(), `${ws}/idea/${slug}`).toBe(true);
}

/** Opens the header's favourites select on the open page; a popover from 640 px, the bottom sheet below. */
async function openSelect(page: Page, width: number): Promise<Locator> {
  await (await headerControl(page, 'favorites')).click();
  const picker = page.locator('nav[data-picker="favorites"]');
  await expect(picker).toBeVisible();
  await expect(picker.locator(`xpath=ancestor::${width < 640 ? 'ui-sheet' : 'ui-popover'}`)).toHaveCount(1);
  return picker;
}

/** harbor's spec rows in the order the select shows them. */
const rowIds = (picker: Locator): Promise<string[]> =>
  picker.locator('[data-favorites-group="harbor"] [data-spec]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-spec') ?? ''));

/** Every row of the open select as `<ws>/spec/<id>` or `<ws>/idea/<slug>`, sorted. */
const rowKeys = (picker: Locator): Promise<string[]> =>
  picker.locator('[data-favorites-group] a[data-spec], [data-favorites-group] a[data-idea]').evaluateAll((rows) =>
    rows
      .map((row) => {
        const ws = row.closest('[data-favorites-group]')?.getAttribute('data-favorites-group') ?? '';
        const spec = row.getAttribute('data-spec');
        return spec === null ? `${ws}/idea/${row.getAttribute('data-idea') ?? ''}` : `${ws}/spec/${spec}`;
      })
      .sort(),
  );

/** No link to a workspace's spec overview: the favourites select has none (spec 069). */
async function expectNoOverviewLink(picker: Locator): Promise<void> {
  await expect(picker.locator('.picker-all')).toHaveCount(0);
  await expect(picker.locator('a[href$="/specs"]')).toHaveCount(0);
}

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
      await expectNoOverviewLink(picker);
    });
  });

  test.describe(`empty at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const language of ['en', 'de'] as const) {
      test(`empty: no favourite leaves the hint in ${language} and keeps the focus in the select at ${String(width)} (T23)`, async ({ page, request }) => {
        await seed(request, [], language);
        await page.goto(`/w/harbor/s/${OPEN}`);
        const picker = await openSelect(page, width);
        await expect(picker.locator('.picker-empty')).toBeVisible();
        await expect(picker.locator('.picker-empty')).toHaveText(HINT[language]);
        await expect(picker.locator('[data-spec]')).toHaveCount(0);
        await expectNoOverviewLink(picker);
        const overlay = width < 640 ? 'ui-sheet' : 'ui-popover';
        await expect
          .poll(() => picker.evaluate((nav, tag) => nav.closest(tag)?.contains(document.activeElement) === true, overlay))
          .toBe(true);
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
      await expectNoOverviewLink(picker);
    });

    test(`stale: one real favourite beside them is the one row at ${String(width)} (T26)`, async ({ page, request }) => {
      await seed(request, [ARCHIVED, UNKNOWN, FAVORITES[0]]);
      await page.goto(`/w/harbor/s/${OPEN}`);
      const picker = await openSelect(page, width);
      await expect(picker.locator('[data-spec]')).toHaveCount(1);
      expect(await rowIds(picker)).toEqual(idsIn([FAVORITES[0]]));
      await expect(picker.locator('.picker-empty')).toHaveCount(0);
      await expectNoOverviewLink(picker);
    });
  });
}

for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop] as const) {
  test.describe(`position at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const path of ['/', '/w/harbor', `/w/harbor/s/${OPEN}`]) {
      test(`position: the trigger stands directly left of the palette on ${path} at ${String(width)} (T16)`, async ({ page }) => {
        await page.goto(path);
        const trigger = page.locator('header [data-control="favorites"]');
        const palette = page.locator('header [data-control="palette"]');
        await expect(trigger).toBeVisible();
        await expect(palette).toBeVisible();
        const t = await trigger.boundingBox();
        const p = await palette.boundingBox();
        if (t === null || p === null) throw new Error('trigger or palette has no box');
        // One row: the boxes overlap vertically and their centres lie within 4 px.
        expect(Math.min(t.y + t.height, p.y + p.height) - Math.max(t.y, p.y)).toBeGreaterThan(0);
        expect(Math.abs(t.y + t.height / 2 - (p.y + p.height / 2))).toBeLessThanOrEqual(4);
        expect(t.x + t.width).toBeLessThanOrEqual(p.x + 0.5);
        const between = await page.locator('header').evaluate((header) => {
          const trig = header.querySelector('[data-control="favorites"]');
          const pal = header.querySelector('[data-control="palette"]');
          if (!trig || !pal) return ['missing'];
          const tr = trig.getBoundingClientRect();
          const pr = pal.getBoundingClientRect();
          return [...header.querySelectorAll('[data-control], [data-tool], button, a, input, [role="button"]')]
            .filter((el) => el !== trig && el !== pal && !trig.contains(el) && !pal.contains(el) && !el.contains(trig) && !el.contains(pal))
            .filter((el) => {
              const r = el.getBoundingClientRect();
              const style = getComputedStyle(el);
              if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') return false;
              const inGap = r.right > tr.right + 0.5 && r.left < pr.left - 0.5;
              const inRow = Math.min(r.bottom, pr.bottom) - Math.max(r.top, pr.top) > 0;
              return inGap && inRow;
            })
            .map((el) => el.outerHTML.slice(0, 120));
        });
        expect(between).toEqual([]);
      });
    }
  });
}

test.describe('everywhere', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('everywhere: the trigger and the same favourites of every workspace on every page (T17)', async ({ page, request }) => {
    await seed(request, FAVORITES);
    await seedIdea(request, 'harbor', HARBOR_IDEA);
    await seed(request, [LANTERN[0]], undefined, 'lantern');
    const expected = ['harbor/idea/console-audit-log', 'harbor/spec/003', 'harbor/spec/006', 'lantern/spec/001'];
    for (const path of ['/', '/settings', '/help', '/w/harbor', '/w/harbor/specs', `/w/harbor/s/${OPEN}`]) {
      await page.goto(path);
      await expect(page.locator('header [data-control="favorites"]'), path).toBeVisible();
      const picker = await openSelect(page, WIDTHS.desktop);
      await expect(picker.locator('[data-favorites-group] a[data-spec], [data-favorites-group] a[data-idea]'), path).toHaveCount(expected.length);
      expect(await rowKeys(picker), path).toEqual(expected);
      await expectNoOverviewLink(picker);
    }
  });
});

test.describe('unstar', () => {
  test.use(atWidth(WIDTHS.desktop));

  test("unstar: a row's star unsets the favourite in its own workspace and keeps the select open (T18)", async ({ page, request }) => {
    await seed(request, [FAVORITES[0]]);
    await seed(request, LANTERN, undefined, 'lantern');
    await page.goto('/w/harbor');
    const url = page.url();
    const lanternDeletes: string[] = [];
    const isLanternDelete = (req: Request): boolean =>
      req.method() === 'DELETE' && new URL(req.url()).pathname.startsWith(`${workspaceRoutes.favorites('lantern')}/`);
    page.on('request', (req) => {
      if (isLanternDelete(req)) lanternDeletes.push(new URL(req.url()).pathname);
    });
    const picker = await openSelect(page, WIDTHS.desktop);
    const lantern = picker.locator('[data-favorites-group="lantern"]');
    await expect(lantern.locator('a[data-spec]')).toHaveCount(2);
    await expect(picker.locator('[data-favorites-group="harbor"] a[data-spec]')).toHaveCount(1);

    const first = page.waitForResponse((res) => isLanternDelete(res.request()));
    await lantern.locator('[data-star="001"]').click();
    expect((await first).ok()).toBe(true);
    expect(lanternDeletes).toEqual([workspaceRoutes.favorite('lantern', LANTERN[0])]);
    expect(page.url()).toBe(url);
    await expect(picker).toBeVisible();
    await expect(lantern.locator('a[data-spec="001"]')).toHaveCount(0);
    await expect(lantern.locator('a[data-spec]')).toHaveCount(1);
    await expect(lantern.locator('.group-head')).toBeVisible();

    const second = page.waitForResponse((res) => isLanternDelete(res.request()));
    await lantern.locator('[data-star="002"]').click();
    expect((await second).ok()).toBe(true);
    expect(lanternDeletes).toHaveLength(2);
    expect(page.url()).toBe(url);
    await expect(picker).toBeVisible();
    await expect(picker.locator('[data-favorites-group="lantern"]')).toHaveCount(0);
    await expect(picker.locator('.picker-empty')).toHaveCount(0);

    await picker.locator('[data-favorites-group="harbor"] [data-star="003"]').click();
    await expect(picker).toBeVisible();
    await expect(picker.locator('[data-favorites-group]')).toHaveCount(0);
    await expect(picker.locator('.picker-empty')).toBeVisible();
    expect(page.url()).toBe(url);
  });
});
