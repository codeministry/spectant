/**
 * ISC-62 (T68): the auto-refresh against the stub API. The stub's bump hook (`POST /api/__stub/bump?ws=`) changes a
 * number of harbor's dashboard between two polls; Playwright's clock fires the refresh timer, and the node that held
 * the number shows the new one, with no navigation. `bun run e2e -- refresh -g in-place`.
 */
import { atWidth, expect, FIXED_NOW, test } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
/** `DEFAULT_SETTINGS.refreshSeconds` in `src/app/core/settings.service.ts`, plus a second of slack. */
const PAST_ONE_POLL_MS = 31_000;

test.describe('refresh', () => {
  // The spec installs its own fake timers, so the fixture's pinned clock is off.
  test.use({ ...atWidth(1440), clockAt: null });

  test('in-place: the timer swaps a changed KPI value inside the same DOM node, with no navigation', async ({ page, request }, info) => {
    const session = `refresh-${info.testId}-${String(info.retry)}`;
    const headers = { [SESSION]: session };
    await page.setExtraHTTPHeaders(headers);
    await request.post('/api/__stub/reset', { headers });
    await page.clock.install({ time: new Date(FIXED_NOW) });

    await page.goto('/w/harbor');
    const value = page.locator('[data-kpi="claims"] .value');
    await expect(value).toHaveText('55');
    const node = await value.elementHandle();

    let navigations = 0;
    page.on('framenavigated', () => {
      navigations += 1;
    });
    expect((await request.post('/api/__stub/bump?ws=harbor', { headers })).status()).toBe(204);

    await page.clock.fastForward(PAST_ONE_POLL_MS);

    await expect.poll(() => node.evaluate((el) => el.textContent.trim())).toBe('56');
    expect(await node.evaluate((el) => el.isConnected)).toBe(true);
    await expect(value).toHaveText('56');
    expect(navigations).toBe(0);
  });
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
        await expect(value).toHaveText('55');
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

        await expect(value).toHaveText('56');
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
