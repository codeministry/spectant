/**
 * Spec 071 (status widget) against the stub API, at 1440 px: the open widget follows a change in a registered
 * workspace over the app's own live path, without a reload (T38, ISC-587).
 *
 * - `bun run e2e -- status-widget-live -g live`: `/widget` open, its stream (`/api/events`) connected; in the test's
 *   stub session harbor 004 moves `code-review → close → done` (two board transitions) and a bump with `&spec=003`
 *   closes one of 003's claims and pushes one `update` frame, whose last view is `/api/status`. Within 2 s 003's row
 *   counter reads one more closed claim, 004's stage chip reads "Done", and the KPI tiles "closed" and "claims" each
 *   count one more; no `document` request follows the first load, a marker on `window` survives and the page's
 *   `main` is the same node.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, test } from './fixtures';
import { BUMP_PATH, RESET_PATH, SESSION_HEADER } from './stub-api';

/** ISC-587: a change reaches the open widget within 2 s, as on every live page (spec 065). */
const LIVE_BUDGET_MS = 2_000;
const EVENTS = '/api/events';
const SPECS = '/api/workspaces/harbor/specs';
/** The spec whose claim the bump closes: 003, `0/13` on harbor, open and held by no lock. */
const PROGRESS = '003';
/** The spec that moves to `done`: 004 (feature) stands in `code-review`, two listed moves before `done`, no lock on it. */
const CLOSING = '004';

type Probe = Window & { spectantNoReload?: boolean; spectantMain?: Element | null };

/** Moves harbor `id` through `stages` one board transition each, with the hash the stub last answered. */
async function moveThrough(page: Page, headers: Record<string, string>, id: string, stages: readonly string[]): Promise<void> {
  const read = await page.request.get(`${SPECS}/${id}`, { headers });
  expect(read.status()).toBe(200);
  let hash = read.headers()['x-spectant-spec-hash'] ?? '';
  for (const to of stages) {
    const res = await page.request.post(`${SPECS}/${id}/transition`, { headers, data: { to, hash } });
    expect(res.status(), `${id} → ${to}`).toBe(200);
    hash = ((await res.json()) as { hash: string }).hash;
  }
}

const row = (page: Page, id: string) => page.locator(`[data-workspace="harbor"] [data-spec="${id}"] div.entry`);
// The flat head (spec 072, T8): each figure is a `dd`, its value first, then the denominator in `span.den`.
const kpi = (page: Page, index: number) => page.locator('header.head dl.kpis > div.kpi > dd').nth(index);
const kpiValue = async (page: Page, index: number): Promise<number> => Number(((await kpi(page, index).textContent()) ?? '').split('/')[0]);
const kpiText = (value: number): RegExp => new RegExp(`^${String(value)}(/|$)`);

test.describe('status widget live at 1440', () => {
  test.use({ ...atWidth(1440), clockAt: null });

  const session = (): string => `status-widget-live-${test.info().testId}-${String(test.info().retry)}`;

  test.afterEach(async ({ request }, info) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: `status-widget-live-${info.testId}-${String(info.retry)}` } });
  });

  test(`live: changed progress and a stage on done reach the open widget within ${String(LIVE_BUDGET_MS)} ms, without reload`, async ({ page }) => {
    const headers = { [SESSION_HEADER]: session() };
    await page.context().setExtraHTTPHeaders(headers);
    expect((await page.request.post(RESET_PATH, { headers })).status()).toBe(204);

    const connected = page.waitForResponse((res) => new URL(res.url()).pathname === EVENTS && res.status() === 200);
    await page.goto('/widget');
    await connected;
    const main = page.locator('main.widget');
    await expect(row(page, PROGRESS).locator('.entry-count')).toHaveText('0/13');
    await expect(row(page, CLOSING).locator('.entry-stage')).toHaveText('Code review');
    const closed = await kpiValue(page, 1);
    const claims = await kpiValue(page, 2);

    await main.evaluate((el) => {
      const probe = window as Probe;
      probe.spectantNoReload = true;
      probe.spectantMain = el;
    });
    const documents: string[] = [];
    page.on('request', (req) => {
      if (req.resourceType() === 'document') documents.push(req.url());
    });

    // The stage move alone pushes no frame; the bump that follows does, and its `/api/status` view carries both.
    await moveThrough(page, headers, CLOSING, ['close', 'done']);
    const sent = Date.now();
    expect((await page.request.post(`${BUMP_PATH}?ws=harbor&spec=${PROGRESS}`, { headers })).status()).toBe(204);

    await expect(row(page, PROGRESS).locator('.entry-count')).toHaveText('1/13', { timeout: LIVE_BUDGET_MS });
    await expect(row(page, CLOSING).locator('.entry-stage')).toHaveText('Done', { timeout: LIVE_BUDGET_MS });
    await expect(kpi(page, 1)).toHaveText(kpiText(closed + 1), { timeout: LIVE_BUDGET_MS });
    await expect(kpi(page, 2)).toHaveText(kpiText(claims + 1), { timeout: LIVE_BUDGET_MS });
    expect(Date.now() - sent).toBeLessThanOrEqual(LIVE_BUDGET_MS);

    expect(documents, 'no document request').toEqual([]);
    const state = await main.evaluate((el) => {
      const probe = window as Probe;
      return { marker: probe.spectantNoReload, same: probe.spectantMain === el };
    });
    expect(state.marker, 'the window marker survives').toBe(true);
    expect(state.same, 'the page is the same node').toBe(true);
  });
});
