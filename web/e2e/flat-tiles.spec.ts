/**
 * Spec 064 (flat dashboard tiles) against the stub API. One describe per claim and width, so `-g "<words>"` selects it:
 *
 * - `bun run --cwd web e2e -- flat-tiles -g "working more"` (T24, ISC-471): under `X-Spectant-Stub-Locks: working`
 *   harbor has the four specs of `STUB_WORKING` in work, one more than the block's tile limit. `/w/harbor` shows the
 *   "In progress" block with three tiles and "Show all 4"; the link lands on `/w/harbor/specs?working=1`, whose list
 *   holds exactly those four specs, and a reload of that address shows the same list.
 * - `bun run --cwd web e2e -- flat-tiles -g "working live"` (T26, ISC-468): with the default locks harbor's dashboard
 *   body holds no `taken` entry, so the block is absent. With `/w/harbor` open and its `/api/events` stream connected,
 *   a stub lock on 003 (`POST /api/__stub/lock`) makes the 003 tile appear without navigation, and its release makes
 *   the block disappear again.
 *
 * Both at 1440 and 390 px.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { atWidth, expect, test } from './fixtures';
import { LOCK_PATH, LOCKS_HEADER, RESET_PATH, SESSION_HEADER, STUB_WORKING } from './stub-api';

const WS = STUB_WORKING.workspace;
const DASHBOARD = `/w/${WS}`;
const FILTERED = `/w/${WS}/specs?working=1`;
const TILE_LIMIT = 3;
/** The claim the live case takes and releases: 003 is the only harbor spec with open claims outside the fixture. */
const LIVE_LOCK = { spec: '003', claim: 'ISC-81', session: 'a:claude:stub-live' } as const;

/** The "In progress" block on the workspace dashboard. */
const workingBlock = (page: Page): Locator => page.locator('ui-working-block');
/** The ids its tiles show, in order. */
const tileIds = (page: Page): Locator => workingBlock(page).locator('ui-flat-tile [data-id]');
/** The spec ids the Specs list shows, in order (spec rows only: ideas and archived rows carry other hooks). */
const listIds = (page: Page): Promise<string[]> =>
  page.locator('app-spec-table a.row-link[data-spec-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-spec-row') ?? ''));
/** The stub session of one live test run. */
const liveSession = (info: { testId: string; retry: number }): string => `flat-tiles-live-${info.testId}-${String(info.retry)}`;

/** Gives the page its own stub session and drops whatever an earlier run of it left. */
async function ownSession(page: Page, request: APIRequestContext, session: string): Promise<Record<string, string>> {
  const headers = { [SESSION_HEADER]: session };
  await page.context().setExtraHTTPHeaders(headers);
  expect((await request.post(RESET_PATH, { headers })).status()).toBe(204);
  return headers;
}

for (const width of [1440, 390] as const) {
  test.describe(`working more at ${String(width)}`, () => {
    test.use({ ...atWidth(width), extraHTTPHeaders: { [LOCKS_HEADER]: 'working' } });

    test(`working more: "Show all 4" leads to the filtered Specs list, which a reload keeps (${String(width)})`, async ({ page }) => {
      await page.goto(DASHBOARD);
      const block = workingBlock(page);
      await expect(block.getByRole('heading', { name: 'In progress' })).toBeVisible();
      await expect(tileIds(page)).toHaveText(STUB_WORKING.specs.slice(0, TILE_LIMIT));

      const more = block.locator('a.more[data-show-all]');
      await expect(more).toHaveText(`Show all ${String(STUB_WORKING.specs.length)}`);
      await more.click();
      await expect(page).toHaveURL(FILTERED);
      await expect.poll(() => listIds(page)).toEqual([...STUB_WORKING.specs]);

      await page.reload();
      await expect(page).toHaveURL(FILTERED);
      await expect.poll(() => listIds(page)).toEqual([...STUB_WORKING.specs]);
    });
  });

  test.describe(`working live at ${String(width)}`, () => {
    test.use({ ...atWidth(width) });

    test.afterEach(async ({ request }, info) => {
      await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: liveSession(info) } });
    });

    test(`working live: a claim taken and released shows and drops the tile without navigation (${String(width)})`, async ({ page, request }, info) => {
      const headers = await ownSession(page, request, liveSession(info));

      const stream = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/events' && res.status() === 200);
      await page.goto(DASHBOARD);
      await stream;
      await expect(page.locator('[data-lists]')).toBeVisible();
      // The default locks put no `taken` into harbor's dashboard body: no block at all.
      await expect(workingBlock(page).locator('section')).toHaveCount(0);

      let navigations = 0;
      page.on('framenavigated', () => {
        navigations += 1;
      });

      expect((await request.post(`${LOCK_PATH}?ws=${WS}`, { headers, data: LIVE_LOCK })).status()).toBe(204);
      await expect(tileIds(page)).toHaveText([LIVE_LOCK.spec]);
      await expect(workingBlock(page).locator('ui-flat-tile [data-agent]')).toHaveText(LIVE_LOCK.session);

      expect((await request.post(`${LOCK_PATH}?ws=${WS}`, { headers, data: { ...LIVE_LOCK, release: true } })).status()).toBe(204);
      await expect(workingBlock(page).locator('section')).toHaveCount(0);
      expect(navigations, 'no navigation while the tile came and went').toBe(0);
      await expect(page).toHaveURL(DASHBOARD);
    });
  });
}
