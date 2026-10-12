/**
 * T159 · ISC-133.1 (spec 008): the visual baseline of the help page `/help` (the default workflow table as one mermaid
 * figure per spec type, and the glossary) at 390, 820 and 1440, full page, in both themes:
 *
 *   bun run test:visual -- help                 light
 *   bun run test:visual -- help --theme dark    dark
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual-help.spec.ts/` and are recorded only in the pinned
 * container (`bun run test:visual:ci -- help -u`). The clock is pinned by the fixtures (FIXED_NOW); each test runs in
 * its own stub session, reset first. The page is opened cold, so no `/w/:ws` route came before it and the figures show
 * core's default table.
 *
 * Mermaid draws in the browser from a lazy chunk, one figure after the other, and measures each in a temporary
 * `<div id="d<render id>">` it appends to `<body>`; while one is there the page is that much longer. The page redraws
 * every figure after each viewport resize, and a full-page capture resizes the viewport, so `toHaveScreenshot`'s
 * back-to-back captures land in the redraw the previous one set off and never match while a baseline is recorded.
 * Hence the page is captured once, settled and mermaid idle, and that capture is compared with `toMatchSnapshot`
 * under the same options (`maxDiffPixelRatio: 0`, animations off, caret hidden, CSS scale). A capture taken from the
 * idle page is pixel-identical to the next one taken after the redraw went idle again.
 */
import type { Page } from '@playwright/test';

import { DEFAULT_WORKFLOW } from '../../core/src/stage';
import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const CAPTURE = { fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css' } as const;
const COMPARE = { maxDiffPixelRatio: 0 } as const;
/** Mermaid's measuring container for a render id `help-workflow-<type>-<n>` (help-page.ts). */
const MEASURING = 'body > [id^="dhelp-workflow-"]';
/** Consecutive animation frames without a measuring container and with the same svg ids that count as idle. */
const IDLE_FRAMES = 10;

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-help-${info.testId}-${String(info.retry)}`;
  await page.setExtraHTTPHeaders({ [SESSION]: session });
  const reset = await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
  expect(reset.status()).toBe(204);
});

/** Mermaid is idle: for `IDLE_FRAMES` frames in a row no measuring container is in `<body>` and no svg was replaced. */
async function diagramsIdle(page: Page): Promise<void> {
  await page.evaluate(
    ([measuring, frames]) =>
      new Promise<void>((resolve) => {
        let quiet = 0;
        let last = '';
        const tick = (): void => {
          const ids = [...document.querySelectorAll('[data-diagram] > svg')].map((svg) => svg.id).join(',');
          quiet = document.querySelector(measuring) === null && ids === last ? quiet + 1 : 0;
          last = ids;
          if (quiet >= frames) resolve();
          else requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      }),
    [MEASURING, IDLE_FRAMES] as const,
  );
}

/**
 * The page is settled: network quiet, fonts loaded, no skeleton or busy notice left, the theme the run asked for, every
 * workflow figure drawn by mermaid (one `svg` per row of the default table, no render error) and mermaid idle.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('app-help-page')).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator('figure[data-workflow-figure]')).toHaveCount(DEFAULT_WORKFLOW.length);
  await expect(
    page.locator('figure[data-workflow-figure][data-rendered] [data-diagram] > svg[id^="help-workflow-"]'),
  ).toHaveCount(DEFAULT_WORKFLOW.length);
  await expect(page.locator('figure[data-workflow-figure][data-render-error]')).toHaveCount(0);
  await diagramsIdle(page);
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
