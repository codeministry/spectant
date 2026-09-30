/**
 * T107 · ISC-49 and T108 · ISC-49.1: the visual baseline of the live board (Lanes and Flow) for harbor 002 at 390,
 * 820 and 1440, full page. The board is the successor of the master's "report page" (spec 002), so the group is named
 * `report` and the claim probes stay as written:
 *
 *   bun run test:visual -- report                 light (ISC-49)
 *   bun run test:visual -- report --theme dark    dark  (ISC-49.1)
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual-board.spec.ts/` and are recorded only in the
 * pinned container (`bun run test:visual:ci -- report -u`). The clock is pinned by the fixtures (FIXED_NOW) and the
 * visual suite runs with reduced motion, so the live frame's pulses and agent timers stand still.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const BOARD = '/w/harbor/s/002/board';
const VIEWS = ['lanes', 'flow'] as const;
const SCREENSHOT = { fullPage: true, maxDiffPixelRatio: 0 } as const;

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-board-${info.testId}-${String(info.retry)}`;
  await page.setExtraHTTPHeaders({ [SESSION]: session });
  const reset = await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
  expect(reset.status()).toBe(204);
});

/** The page is settled: network quiet, fonts loaded, no skeleton or busy notice left, the theme the run asked for. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('app-board-tab')).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

test.describe('report', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const view of VIEWS) {
        test(`board ${view} ${String(width)}`, async ({ page }) => {
          await page.goto(view === 'lanes' ? BOARD : `${BOARD}?view=${view}`);
          await settle(page);
          await expect(page).toHaveScreenshot(`board-${view}-${String(width)}.png`, SCREENSHOT);
        });
      }
    });
  }
});
