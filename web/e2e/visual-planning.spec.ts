/**
 * T45 · ISC-108 and T46 · ISC-108.1: the visual baseline of the Features and Milestones pages (spec 003) on harbor
 * (rows, the late and the upcoming milestone, the archived 001) and lantern (rows without a milestone anywhere; the
 * Milestones page absent) at 390, 820 and 1440, full page:
 *
 *   bun run test:visual -- planning                 light (ISC-108)
 *   bun run test:visual -- planning --theme dark    dark  (ISC-108.1); `--theme` becomes E2E_THEME → colorScheme
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual-planning.spec.ts/` and are recorded only in the
 * pinned container (`bun run test:visual:ci -- planning -u`). The clock is pinned by the fixtures (FIXED_NOW), so the
 * milestone day counts are frozen; each test runs in its own stub session, reset first, with the stub's default state.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';
const SCREENSHOT = { fullPage: true, maxDiffPixelRatio: 0 } as const;

const PAGES = [
  { name: 'harbor-features', url: '/w/harbor/features', host: 'app-features-page' },
  { name: 'harbor-milestones', url: '/w/harbor/milestones', host: 'app-milestones-page' },
  { name: 'lantern-features', url: '/w/lantern/features', host: 'app-features-page' },
  { name: 'lantern-milestones', url: '/w/lantern/milestones', host: 'app-milestones-page' },
] as const;

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-planning-${info.testId}-${String(info.retry)}`;
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
  // The fixtures pin the clock; a day count that moved would break the baseline, so prove it is frozen.
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

test.describe('planning', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const target of PAGES) {
        test(`${target.name} ${String(width)}`, async ({ page }) => {
          await page.goto(target.url);
          await settle(page, target.host);
          await expect(page).toHaveScreenshot(`${target.name}-${String(width)}.png`, SCREENSHOT);
        });
      }
    });
  }
});
