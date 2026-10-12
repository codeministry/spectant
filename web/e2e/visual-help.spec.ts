/**
 * T159 · ISC-133.1 (spec 008): the visual baseline of the help page `/help` (the default workflow table as one inline
 * SVG figure per spec type, T161, and the glossary) at 390, 820 and 1440, full page, in both themes:
 *
 *   bun run test:visual -- help                 light
 *   bun run test:visual -- help --theme dark    dark
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual-help.spec.ts/` and are recorded only in the pinned
 * container (`bun run test:visual:ci -- help -u`). The clock is pinned by the fixtures (FIXED_NOW); each test runs in
 * its own stub session, reset first. The page is opened cold, so no `/w/:ws` route came before it and the figures show
 * core's default table.
 *
 * The figures are drawn synchronously from the layout model (no render run, no measuring container), so the page is
 * settled once every figure holds its `svg` with the catalogue words. The capture is still taken once and compared
 * with `toMatchSnapshot` under the same options (`maxDiffPixelRatio: 0`, animations off, caret hidden, CSS scale).
 */
import type { Page } from '@playwright/test';

import { DEFAULT_WORKFLOW } from '../../core/src/stage';
import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const CAPTURE = { fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css' } as const;
const COMPARE = { maxDiffPixelRatio: 0 } as const;

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-help-${info.testId}-${String(info.retry)}`;
  await page.setExtraHTTPHeaders({ [SESSION]: session });
  const reset = await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
  expect(reset.status()).toBe(204);
});

/**
 * The page is settled: network quiet, fonts loaded, no skeleton or busy notice left, the theme the run asked for, and
 * every workflow figure drawn (one rendered `svg` per row of the default table, its nodes labelled, no catalogue key).
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('app-help-page')).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator('figure[data-workflow-figure]')).toHaveCount(DEFAULT_WORKFLOW.length);
  await expect(page.locator('figure[data-workflow-figure] [data-diagram][data-rendered] > .canvas > svg[role="img"]')).toHaveCount(
    DEFAULT_WORKFLOW.length,
  );
  await expect(page.locator('figure[data-workflow-figure="feature"] [data-diagram] g[data-stage] text').first()).not.toHaveText(/^stages\./);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

test.describe('help', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`help ${String(width)}`, async ({ page }) => {
        await page.goto('/help');
        await settle(page);
        expect(await page.screenshot(CAPTURE)).toMatchSnapshot(`help-${String(width)}.png`, COMPARE);
      });
    });
  }
});
