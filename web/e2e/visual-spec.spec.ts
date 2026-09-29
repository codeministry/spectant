/**
 * T105 · ISC-23 and T106 · ISC-23.1: the visual baseline of the spec page (Status, Claims, Tasks) for harbor 002 at
 * 390, 820 and 1440, full page. The spec page is the successor of the master's "review page" (spec 002, 2026-09-28
 * note), so the group is named `review` and the claim probes stay as written:
 *
 *   bun run test:visual -- review                 light (ISC-23)
 *   bun run test:visual -- review --theme dark    dark  (ISC-23.1); `--theme` becomes E2E_THEME → colorScheme, and
 *                                                  the stub's default theme `system` follows it (data-theme=spec-dark)
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual-spec.spec.ts/` and are recorded only in the
 * pinned container (`bun run test:visual:ci -- review -u`). The clock is pinned by the fixtures (FIXED_NOW), so every
 * relative time is frozen; each test runs in its own stub session, reset first, with the stub's default state.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const SPEC = '/w/harbor/s/002';
const TABS = ['status', 'claims', 'tasks'] as const;
const SCREENSHOT = { fullPage: true, maxDiffPixelRatio: 0 } as const;

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-spec-${info.testId}-${String(info.retry)}`;
  await page.setExtraHTTPHeaders({ [SESSION]: session });
  const reset = await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
  expect(reset.status()).toBe(204);
});

/** The page is settled: network quiet, fonts loaded, no skeleton or busy notice left, the theme the run asked for. */
async function settle(page: Page, host: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator(host)).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // The fixtures pin the clock; a relative time that moved would break the baseline, so prove it is frozen.
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

test.describe('review', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const tab of TABS) {
        test(`${tab} ${String(width)}`, async ({ page }) => {
          await page.goto(`${SPEC}/${tab}`);
          await settle(page, `app-${tab}-tab`);
          await expect(page).toHaveScreenshot(`${tab}-${String(width)}.png`, SCREENSHOT);
        });
      }
    });
  }
});
