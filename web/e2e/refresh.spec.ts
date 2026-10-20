/**
 * ISC-62 (T68): the auto-refresh against the stub API. The stub's bump hook (`POST /api/__stub/bump?ws=`) changes a
 * number of harbor's dashboard between two polls; Playwright's clock fires the fallback poll, and the node that held
 * the number shows the new one, with no navigation. `bun run e2e -- refresh -g in-place`.
 */
import { readFileSync } from 'node:fs';

import { atWidth, expect, FIXED_NOW, test } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const HARBOR = JSON.parse(readFileSync(new URL('../../core/fixtures/harbor.golden.json', import.meta.url), 'utf8')) as {
  kpis: { claims: { closed: number } };
};
/** The claims tile before and after one bump: the stub's `bumpDashboard` raises `kpis.claims.closed` by 1. */
const BEFORE = String(HARBOR.kpis.claims.closed);
const AFTER = String(HARBOR.kpis.claims.closed + 1);
/**
 * One fallback poll: `FALLBACK_POLL_MS` (60 s) in `src/app/core/refresh.service.ts`, plus a second of slack. Written out,
 * not imported: that module brings Angular's injector into Playwright's loader.
 */
const PAST_ONE_POLL_MS = 61_000;
/** The live update stream (`EVENTS_PATH`, `server/src/spec-routes.contract.ts`). */
const EVENTS = '/api/events';

test.describe('refresh', () => {
  // The spec installs its own fake timers, so the fixture's pinned clock is off.
  test.use({ ...atWidth(1440), clockAt: null });

  test('in-place: the timer swaps a changed KPI value inside the same DOM node, with no navigation', async ({ page, request }, info) => {
    const session = `refresh-${info.testId}-${String(info.retry)}`;
    const headers = { [SESSION]: session };
    await page.setExtraHTTPHeaders(headers);
    await request.post('/api/__stub/reset', { headers });
    // The bump pushes down the live stream too, and the app polls only while that stream is down (spec 030); refused
    // before the first load, only the fallback poll can move the page (spec 042).
    await page.route(`**${EVENTS}`, (route) => route.fulfill({ status: 204 }));
    await page.clock.install({ time: new Date(FIXED_NOW) });

    await page.goto('/w/harbor');
    const value = page.locator('[data-kpi="claims"] .value');
    await expect(value).toHaveText(BEFORE);
    const node = await value.elementHandle();

    let navigations = 0;
    page.on('framenavigated', () => {
      navigations += 1;
    });
    expect((await request.post('/api/__stub/bump?ws=harbor', { headers })).status()).toBe(204);

    await page.clock.fastForward(PAST_ONE_POLL_MS);

    await expect.poll(() => node.evaluate((el) => el.textContent.trim())).toBe(AFTER);
    expect(await node.evaluate((el) => el.isConnected)).toBe(true);
    await expect(value).toHaveText(AFTER);
    expect(navigations).toBe(0);
  });
});

/** The open workspace's dashboard read, the one `RefreshService` revalidates against the primed ETag cache. */
const DASHBOARD = '/api/workspaces/harbor/dashboard';
/** ISC-28: a change reaches an open page within 2 s. */
const LIVE_BUDGET_MS = 2_000;

/** One read the page sent after the bump: its path, the ETag it revalidated with, and the answer's status. */
type Read = { path: string; ifNoneMatch: string | undefined; status: number };

/**
 * ISC-28 (spec 030, T19): the live update stream at browser level. The fallback poll is a fixed 60 s and no clock is
 * faked, so only the push can move a page inside 2 s. Each case opens one page of harbor, waits for its `GET /api/events`, sets a
 * marker on `window`, bumps harbor for its session and measures until the page holds the bumped dashboard: the
 * dashboard shows the new KPI value in the same DOM node; the board and the spec page show no KPI, so there the proof
 * is the shell's dashboard read revalidating with the bumped ETag (primed from the frame) and answered 304, beside the
 * page's own view (planning tree, spec page) revalidated to a 304 too. After it the marker is still set and no frame
 * navigated: no reload. `bun run e2e -- refresh -g live`.
 */
test.describe('refresh live', () => {
  test.use({ ...atWidth(1440), clockAt: null });

  const PAGES = [
    { name: 'dashboard', url: '/w/harbor', ready: '[data-kpi="claims"] .value', view: DASHBOARD },
    { name: 'board', url: '/w/harbor/board', ready: 'app-board-card', view: '/api/workspaces/harbor/planning' },
    { name: 'spec page', url: '/w/harbor/s/002', ready: 'app-spec-dashboard', view: '/api/workspaces/harbor/specs/002' },
  ] as const;

  for (const { name, url, ready, view } of PAGES) {
    test(`live: a bump reaches the open ${name} over the stream within 2 s, with no poll and no reload`, async ({ page, request }, info) => {
      const session = `refresh-live-${info.testId}-${String(info.retry)}`;
      const headers = { [SESSION]: session };
      await page.setExtraHTTPHeaders(headers);
      await request.post('/api/__stub/reset', { headers });

      const stream = page.waitForResponse((res) => new URL(res.url()).pathname === EVENTS && res.status() === 200);
      await page.goto(url);
      await stream;
      await expect(page.locator(ready).first()).toBeVisible();
      const value = page.locator('[data-kpi="claims"] .value');
      const node = name === 'dashboard' ? await value.elementHandle() : null;
      if (node !== null) await expect(value).toHaveText(BEFORE);

      await page.evaluate(() => {
        (window as unknown as { __live?: string }).__live = 'kept';
      });
      let navigations = 0;
      page.on('framenavigated', () => {
        navigations += 1;
      });
      const reads: Read[] = [];
      page.on('response', (res) => {
        const path = new URL(res.url()).pathname;
        if (path.startsWith('/api/') && path !== EVENTS) reads.push({ path, ifNoneMatch: res.request().headers()['if-none-match'], status: res.status() });
      });
      const revalidated = (path: string): Promise<unknown> =>
        page.waitForResponse((res) => new URL(res.url()).pathname === path && res.status() === 304, { timeout: LIVE_BUDGET_MS });
      const dashboardRead = revalidated(DASHBOARD);
      const viewRead = revalidated(view);

      const started = Date.now();
      expect((await request.post('/api/__stub/bump?ws=harbor', { headers })).status()).toBe(204);
      if (node !== null) await expect.poll(() => node.evaluate((el) => el.textContent.trim()), { timeout: LIVE_BUDGET_MS }).toBe(AFTER);
      await Promise.all([dashboardRead, viewRead]);
      const elapsed = Date.now() - started;
      expect(elapsed, `the bump took ${String(elapsed)} ms to reach the ${name}`).toBeLessThan(LIVE_BUDGET_MS);

      // The page holds the bumped dashboard: every read of it since the bump revalidated with the bumped ETag, a 304.
      const bumped = (await request.get(DASHBOARD, { headers })).headers()['etag'];
      expect(bumped).toBeTruthy();
      const dashboardReads = reads.filter((read) => read.path === DASHBOARD);
      expect(dashboardReads.length).toBeGreaterThan(0);
      expect(dashboardReads).toEqual(dashboardReads.map((read) => ({ ...read, ifNoneMatch: bumped, status: 304 })));
      if (node !== null) {
        expect(await node.evaluate((el) => el.isConnected)).toBe(true);
        await expect(value).toHaveText(AFTER);
      }
      expect(await page.evaluate(() => (window as unknown as { __live?: string }).__live)).toBe('kept');
      expect(navigations).toBe(0);
    });
  }
});

/** One `layout-shift` entry without recent input, with the nodes it moved (for the failure message). */
type Shift = { value: number; nodes: string[] };
type ClsProbe = { __cls: () => Shift[] };

/**
 * ISC-62.1 (T72): the same refresh shifts nothing. A PerformanceObserver collects `layout-shift` entries without recent
 * input from just before the bump until the refreshed value and its tint have been painted; their sum is the
 * cumulative layout shift, and it must be exactly 0. The refresh has to render its mark (the claims tile's tint), and
 * the KPI band and the Specs panel have to be in the viewport, or a 0 would prove nothing. Run at the wide and the
 * medium tier. `bun run e2e -- refresh -g cls`.
 */
test.describe('refresh cls', () => {
  test.use({ clockAt: null });

  for (const width of [1440, 820]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('cls: a refresh that changes a KPI value and marks it shifts no layout (CLS 0)', async ({ page, request }, info) => {
        const session = `refresh-cls-${info.testId}-${String(info.retry)}`;
        const headers = { [SESSION]: session };
        await page.setExtraHTTPHeaders(headers);
        await request.post('/api/__stub/reset', { headers });
        await page.clock.install({ time: new Date(FIXED_NOW) });

        await page.goto('/w/harbor');
        const tile = page.locator('.band [data-kpi="claims"]');
        const value = tile.locator('.value');
        await expect(value).toHaveText(BEFORE);
        // Spec 020 T17: below wide the section #waiting opens the page before the KPI band; the band moves to the top
        // so the tile and the first spec row both stand in the viewport the shifts are measured in.
        if (width < 1120) await tile.evaluate((el) => el.scrollIntoView({ block: 'start' }));
        await expect(tile).toBeInViewport();
        await expect(page.locator('[data-spec-row]').first()).toBeInViewport();
        await page.evaluate(() => document.fonts.ready);

        // From here on every shift counts: the observer starts once the first paint has settled.
        await page.evaluate(() => {
          type Entry = PerformanceEntry & { value: number; hadRecentInput: boolean; sources?: ReadonlyArray<{ node?: Node | null }> };
          const seen: Shift[] = [];
          const describe = (node: Node | null | undefined): string =>
            node instanceof Element ? [node.tagName.toLowerCase(), ...node.classList].join('.') : String(node?.nodeName);
          const take = (entries: PerformanceEntryList): void => {
            for (const entry of entries as Entry[]) {
              if (!entry.hadRecentInput) seen.push({ value: entry.value, nodes: (entry.sources ?? []).map(({ node }) => describe(node)) });
            }
          };
          const observer = new PerformanceObserver((list) => take(list.getEntries()));
          observer.observe({ type: 'layout-shift' });
          (window as unknown as ClsProbe).__cls = () => {
            take(observer.takeRecords());
            return seen;
          };
        });

        expect((await request.post('/api/__stub/bump?ws=harbor', { headers })).status()).toBe(204);
        await page.clock.fastForward(PAST_ONE_POLL_MS);

        await expect(value).toHaveText(AFTER);
        await expect(tile).toHaveAttribute('data-tint', /^[ab]$/);
        // A screenshot needs a freshly painted frame, so any shift the swap or its mark caused has been reported.
        await page.screenshot();

        const shifts = await page.evaluate(() => (window as unknown as ClsProbe).__cls());
        const cls = shifts.reduce((sum, shift) => sum + shift.value, 0);
        expect(cls, `layout shifts during the refresh: ${JSON.stringify(shifts)}`).toBe(0);
      });
    });
  }
});
