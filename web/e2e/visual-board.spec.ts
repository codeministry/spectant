/**
 * T107 · ISC-49 and T108 · ISC-49.1: the visual baseline of the live board (Lanes and Flow) for harbor 002 at 390,
 * 820 and 1440, full page. The board is the successor of the master's "report page" (spec 002), so the group is named
 * `report` and the claim probes stay as written:
 *
 *   bun run test:visual -- report                 light (ISC-49)
 *   bun run test:visual -- report --theme dark    dark  (ISC-49.1)
 *
 * T157 · ISC-129.3 and T158 · ISC-129.4 (spec 008): the workspace board `/w/harbor/board` at 390 (the compact tier with
 * the segmented column switch), 820 and 1440 (stubs and the horizontal scroller), full page:
 *
 *   bun run test:visual -- "workspace board"                 light (ISC-129.3)
 *   bun run test:visual -- "workspace board" --theme dark    dark  (ISC-129.4)
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual-board.spec.ts/` and are recorded only in the
 * pinned container (`bun run test:visual:ci -- report -u`, `… -- "workspace board" -u`). The clock is pinned by the
 * fixtures (FIXED_NOW) and the visual suite runs with reduced motion, so the live frame's pulses and agent timers stand
 * still.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const BOARD = '/w/harbor/s/002/board';
const WORKSPACE_BOARD = '/w/harbor/board';
const VIEWS = ['lanes', 'flow'] as const;
const SCREENSHOT = { fullPage: true, maxDiffPixelRatio: 0 } as const;

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-board-${info.testId}-${String(info.retry)}`;
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
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

test.describe('report', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const view of VIEWS) {
        test(`board ${view} ${String(width)}`, async ({ page }) => {
          await page.goto(view === 'lanes' ? BOARD : `${BOARD}?view=${view}`);
          await settle(page, 'app-board-tab');
          await expect(page).toHaveScreenshot(`board-${view}-${String(width)}.png`, SCREENSHOT);
        });
      }
    });
  }
});

test.describe('workspace board', () => {
  // The tier each width must land in, and the layout that proves it: the column switch at compact, the scroller else.
  const TIERS = [
    { width: WIDTHS.phone, tier: 'compact', layout: '.colswitch ui-segmented' },
    { width: WIDTHS.tablet, tier: 'medium', layout: '.scroller' },
    { width: WIDTHS.desktop, tier: 'wide', layout: '.scroller' },
  ] as const;

  for (const { width, tier, layout } of TIERS) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`workspace board ${String(width)}`, async ({ page }) => {
        await page.goto(WORKSPACE_BOARD);
        await settle(page, 'app-board-page');
        await expect(page.locator('app-board-page')).toHaveAttribute('data-tier', tier);
        await expect(page.locator(`app-board-page ${layout}`)).toBeVisible();
        await expect(page).toHaveScreenshot(`workspace-board-${String(width)}.png`, SCREENSHOT);
      });
    });
  }
});
