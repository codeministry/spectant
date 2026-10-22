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
 * - `bun run --cwd web e2e -- flat-tiles -g "warnings fold"` (T36, ISC-474): `/w/harbor?open=warnings` shows the
 *   warnings open (toggle expanded, list lines visible) and stays on `/w/harbor`, no redirect to the Specs page.
 *   `?open=tldr,warnings` opens both; it runs under `X-Spectant-Stub-Dense: on`, because harbor's golden TL;DR is
 *   stale and a stale brief never opens from the address (spec 058). A reload keeps both. `/w/harbor` alone shows the
 *   warnings closed, with their summary.
 *
 * All at 1440 and 390 px.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { atWidth, expect, test } from './fixtures';
import { DENSE_HEADER, LOCK_PATH, LOCKS_HEADER, RESET_PATH, SESSION_HEADER, STUB_WORKING } from './stub-api';

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

  test.describe(`warnings fold at ${String(width)}`, () => {
    test.use({ ...atWidth(width) });

    test(`warnings fold: ?open=warnings shows the list open on the dashboard, a reload keeps it (${String(width)})`, async ({ page }) => {
      await page.goto(`${DASHBOARD}?open=warnings`);
      await warningsOpen(page);
      await onDashboard(page, ['warnings']);

      await page.reload();
      await warningsOpen(page);
      await onDashboard(page, ['warnings']);
    });

    test(`warnings fold: ?open=tldr,warnings opens the TL;DR whole and the warnings, a reload keeps both (${String(width)})`, async ({ page }) => {
      // Harbor's golden TL;DR is stale and never opens from the address; the dense stub's is fresh (spec 058).
      await page.context().setExtraHTTPHeaders({ [DENSE_HEADER]: 'on' });
      await page.goto(`${DASHBOARD}?open=tldr,warnings`);
      await tldrOpen(page);
      await warningsOpen(page);
      await onDashboard(page, ['tldr', 'warnings']);

      await page.reload();
      await tldrOpen(page);
      await warningsOpen(page);
      await onDashboard(page, ['tldr', 'warnings']);
    });

    test(`warnings fold: the dashboard alone shows the warnings closed with their summary (${String(width)})`, async ({ page }) => {
      await page.goto(DASHBOARD);
      await expect(warningsToggle(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(warningsToggle(page).locator('[data-warnings-summary]')).toBeVisible();
      await expect(page.locator('#warnings-region')).toBeHidden();
      await expect(warningLines(page)).toHaveCount(0);
      await onDashboard(page, []);
    });
  });
}

/** The warnings' fold toggle inside `h2#warnings`. */
function warningsToggle(page: Page): Locator {
  return page.locator('app-warnings-panel button[data-warnings-toggle]');
}

/** The lines of the warnings list (one per warning of a spec). */
function warningLines(page: Page): Locator {
  return page.locator('[data-warnings-list] [data-warning-spec] [data-warning-kind]');
}

/** The warnings stand open: the toggle expanded, the region shown, its lines visible. */
async function warningsOpen(page: Page): Promise<void> {
  await expect(warningsToggle(page)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#warnings-region')).toBeVisible();
  await expect(warningLines(page).first()).toBeVisible();
  expect(await warningLines(page).count(), 'harbor has warnings to list').toBeGreaterThan(0);
}

/** The TL;DR stands whole: the fold expanded, the rest shown, the first section unclipped. */
async function tldrOpen(page: Page): Promise<void> {
  const card = page.locator('[data-ui="brief"]');
  await expect(card.locator('[data-brief-fold] button.summary')).toHaveAttribute('aria-expanded', 'true');
  await expect(card.locator('[data-brief-rest]')).toBeVisible();
  await expect(card.locator('[data-brief-first]')).not.toHaveAttribute('data-clipped');
}

/** The address is still the dashboard (no redirect to `/w/harbor/specs`) and `?open=` holds exactly `keys`. */
async function onDashboard(page: Page, keys: readonly string[]): Promise<void> {
  await expect(page).toHaveURL((url) => url.pathname === DASHBOARD);
  const open = new URL(page.url()).searchParams.get('open');
  expect((open ?? '').split(',').filter(Boolean).sort()).toEqual([...keys].sort());
}
