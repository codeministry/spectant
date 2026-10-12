/**
 * T27 · ISC-50 and T28 · ISC-50.1 (spec 023): the visual baselines of the workspace tech page `/w/harbor/tech` — the
 * Status tab and the Architecture tab — at 390, 820 and 1440, full page, in both themes:
 *
 *   bun run test:visual -- tech                 light (ISC-50)
 *   bun run test:visual -- tech --theme dark    dark  (ISC-50.1)
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual-tech.spec.ts/` and are recorded only in the pinned
 * container (`bun run test:visual:ci -- tech -u`). The clock is pinned by the fixtures (FIXED_NOW); each test runs in
 * its own stub session, reset first. The page is settled once the panel holds its content: the Status table (or the
 * stacked rows at compact) or the Architecture figure with its rendered `svg`.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const CAPTURE = { fullPage: true, animations: 'disabled', caret: 'hide', scale: 'css' } as const;
const COMPARE = { maxDiffPixelRatio: 0 } as const;
const TABS = ['status', 'architecture'] as const;

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-tech-${info.testId}-${String(info.retry)}`;
  await page.setExtraHTTPHeaders({ [SESSION]: session });
  const reset = await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
  expect(reset.status()).toBe(204);
});

/** Network quiet, fonts loaded, no skeleton or busy notice, the run's theme, and the tab's own content drawn. */
async function settle(page: Page, tab: (typeof TABS)[number]): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('app-tech-page')).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  if (tab === 'status') {
    await expect(page.locator('app-tech-status-tab :is(table tr[data-spec], ul[data-stacked] a.row[data-spec])').first()).toBeVisible();
  } else {
    await expect(page.locator('app-tech-docs-tab figure.mermaid-figure .mermaid-svg svg').first()).toBeVisible();
  }
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

test.describe('tech', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const tab of TABS) {
        test(`tech ${tab} ${String(width)}`, async ({ page }) => {
          await page.goto(`/w/harbor/tech/${tab}`);
          await settle(page, tab);
          expect(await page.screenshot(CAPTURE)).toMatchSnapshot(`tech-${tab}-${String(width)}.png`, COMPARE);
        });
      }
    });
  }
});
