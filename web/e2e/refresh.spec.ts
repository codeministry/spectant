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
