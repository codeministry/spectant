/**
 * Spec 021 (density and readability), the density setting group (T56 · ISC-254, `bun run e2e -- density -g setting`):
 *
 * - The settings page sets the density through its `ui-segmented[data-setting="density"]`: one `PUT /api/settings`
 *   goes out, and a reload of the settings page shows the stored value.
 * - With the setting at `compact`, the board's cards (Lanes and Flow view) and the Specs page's spec rows render
 *   compact by default (a spec row carries it as `data-density`; it shows no description line at either density).
 * - `?density=comfortable` on the board overrides the setting for that view only: the cards render comfortable while
 *   `GET /api/settings` still answers `compact`, and no `PUT /api/settings` goes out. The board head's density switch
 *   rewrites `?density=` alone and sends no PUT either.
 *
 * "A restart keeps it" is the server's half of the claim (`bun test ./tests/settings.test.ts -t density`). Every test
 * runs in its own stub session (`X-Spectant-Stub-Session`), reset after the test, so a stored density never leaks.
 */
import type { Page, Request } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const SETTINGS = '/api/settings';
const BOARD = '/w/harbor/s/002/board';
/** The spec list's page (spec 058: the list left the dashboard for `/w/<ws>/specs`). */
const SPECS = '/w/harbor/specs';
const sessionOf = (testId: string): string => `density-setting-${testId}`;

const isSettingsPut = (req: Request): boolean => req.method() === 'PUT' && new URL(req.url()).pathname === SETTINGS;

/** Collects every `PUT /api/settings` the page sends from now on. */
function watchPuts(page: Page): Request[] {
  const puts: Request[] = [];
  page.on('request', (req) => {
    if (isSettingsPut(req)) puts.push(req);
  });
  return puts;
}

/** The stored density of this test's session, read straight from the API. */
async function storedDensity(page: Page, session: string): Promise<unknown> {
  const answer = await page.request.get(SETTINGS, { headers: { [SESSION]: session } });
  expect(answer.ok()).toBe(true);
  return ((await answer.json()) as { density?: unknown }).density;
}

/** Stores `density` for this test's session, as the settings page would. */
async function storeDensity(page: Page, session: string, density: 'comfortable' | 'compact'): Promise<void> {
  const answer = await page.request.put(SETTINGS, { headers: { [SESSION]: session, 'Content-Type': 'application/json' }, data: { density } });
  expect(answer.ok(), `PUT ${SETTINGS} answered ${answer.status()}`).toBe(true);
  expect(await storedDensity(page, session)).toBe(density);
}

/**
 * The task cards of the board (Lanes) and of the flow view, and the Specs page's spec rows; with `notAt`, only those
 * NOT at that density. The operator steps' cards keep their own fixed `step` density whatever the setting, so they
 * are left out.
 */
const TASK_CARD = 'app-board-card[data-density]:not([data-density="step"])';
const notAtDensity = (density?: string): string => (density === undefined ? '' : `:not([data-density="${density}"])`);
const boardCards = (page: Page, notAt?: string) => page.locator(`app-board-tab ${TASK_CARD}${notAtDensity(notAt)}`);
const flowCards = (page: Page, notAt?: string) => page.locator(`app-flow-view ${TASK_CARD}${notAtDensity(notAt)}`);
const specRows = (page: Page, notAt?: string) => page.locator(`app-spec-row[data-density]${notAtDensity(notAt)}`);

test.describe('density setting', () => {
  test.use(atWidth(1440));

  test.beforeEach(async ({ page }, info) => {
    await page.setExtraHTTPHeaders({ [SESSION]: sessionOf(info.testId) });
  });
  test.afterEach(async ({ request }, info) => {
    await request.post('/api/__stub/reset', { headers: { [SESSION]: sessionOf(info.testId) } });
  });

  test('density setting: the settings page stores compact with one PUT, and a reload shows it', async ({ page }, info) => {
    const session = sessionOf(info.testId);
    expect(await storedDensity(page, session)).toBe('comfortable');
    await page.goto('/settings');
    const control = page.locator('ui-segmented[data-setting="density"]');
    const compact = control.locator('[role="radio"]').nth(1);
    const comfortable = control.locator('[role="radio"]').nth(0);
    await expect(comfortable).toHaveAttribute('aria-checked', 'true');
    await expect(compact).toHaveAttribute('aria-checked', 'false');

    const put = page.waitForRequest(isSettingsPut);
    await compact.click();
    const sent = await put;
    expect(sent.postDataJSON()).toMatchObject({ density: 'compact' });
    await expect(compact).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => storedDensity(page, session)).toBe('compact');

    await page.reload();
    await expect(control.locator('[role="radio"]').nth(1)).toHaveAttribute('aria-checked', 'true');
    await expect(control.locator('[role="radio"]').nth(0)).toHaveAttribute('aria-checked', 'false');
  });

  test('density setting: compact is the default of the board, the flow view and the spec rows', async ({ page }, info) => {
    const session = sessionOf(info.testId);
    await storeDensity(page, session, 'compact');
    const puts = watchPuts(page);

    await page.goto(BOARD);
    await expect(boardCards(page).first()).toBeVisible();
    expect(await boardCards(page).count()).toBeGreaterThan(0);
    await expect(boardCards(page, 'compact')).toHaveCount(0);
    await expect(page.locator('app-board-tab button[data-density]')).toHaveAttribute('aria-pressed', 'true');
    expect(new URL(page.url()).searchParams.get('density')).toBeNull();

    await page.goto(`${BOARD}?view=flow`);
    await expect(flowCards(page).first()).toBeVisible();
    await expect(flowCards(page, 'compact')).toHaveCount(0);

    await page.goto(SPECS);
    await expect(specRows(page).first()).toBeVisible();
    expect(await specRows(page).count()).toBeGreaterThan(0);
    await expect(specRows(page, 'compact')).toHaveCount(0);

    // `?density=comfortable` reaches the rows for this view; neither density shows a description line.
    await page.goto(`${SPECS}?density=comfortable`);
    await expect(specRows(page).first()).toHaveAttribute('data-density', 'comfortable');
    await expect(page.locator('app-spec-row .d, app-spec-row [id^="desc-"]')).toHaveCount(0);

    expect(puts.map((p) => p.url())).toEqual([]);
    expect(await storedDensity(page, session)).toBe('compact');
  });

  test('density setting: ?density=comfortable overrides the board only, and the head switch rewrites only the address', async ({ page }, info) => {
    const session = sessionOf(info.testId);
    await storeDensity(page, session, 'compact');
    const puts = watchPuts(page);

    await page.goto(`${BOARD}?density=comfortable`);
    await expect(boardCards(page).first()).toBeVisible();
    await expect(boardCards(page, 'comfortable')).toHaveCount(0);
    const toggle = page.locator('app-board-tab button[data-density]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await storedDensity(page, session)).toBe('compact');

    // Back to the setting's value: the override leaves the address, the cards follow, nothing is stored.
    await toggle.click();
    await expect(page).toHaveURL((url) => !url.searchParams.has('density'));
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(boardCards(page, 'compact')).toHaveCount(0);

    // Away from it again: only `?density=` changes.
    await toggle.click();
    await expect(page).toHaveURL((url) => url.searchParams.get('density') === 'comfortable');
    await expect(boardCards(page, 'comfortable')).toHaveCount(0);

    // A reload keeps the override in the address and the setting where it was.
    await page.reload();
    await expect(boardCards(page).first()).toHaveAttribute('data-density', 'comfortable');
    await page.goto(BOARD);
    await expect(boardCards(page).first()).toHaveAttribute('data-density', 'compact');

    expect(puts.map((p) => p.url())).toEqual([]);
    expect(await storedDensity(page, session)).toBe('compact');
  });
});
