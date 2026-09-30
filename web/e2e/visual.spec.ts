/**
 * Spec 001's visual baselines, ported to the Lovable prototype (tasks ⑤, principal 2026-09-29):
 *
 *   bun run test:visual -- dashboard                  T79 · ISC-17    the workspace dashboard `/w/harbor`, light
 *   bun run test:visual -- dashboard --theme dark     T80 · ISC-17.1  the same, dark
 *   bun run test:visual -- overview                   T81 · ISC-16.1  the overview `/` in three states, light
 *   bun run test:visual -- overview --theme dark      T82 · ISC-16.2  the same, dark
 *
 * Each at 390, 820 and 1440, full page. Baselines live under `__screenshots__/chromium/{light,dark}/visual.spec.ts/`
 * and are recorded only in the pinned container (`bun run test:visual:ci -- dashboard overview -u`). The clock is
 * pinned by the fixtures (FIXED_NOW); each test runs in its own stub session, reset first; the overview's states come
 * from the stub's `X-Spectant-Stub-State` header (two workspaces, empty, one unreadable workspace).
 */
import type { APIRequestContext, Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';
import { STATE_HEADER } from './stub-api';

const SESSION = 'X-Spectant-Stub-Session';
const SCREENSHOT = { fullPage: true, maxDiffPixelRatio: 0 } as const;
const STATES = ['two-workspaces', 'empty', 'unreadable'] as const;

async function session(page: Page, request: APIRequestContext, name: string, state?: string): Promise<void> {
  const headers: Record<string, string> = { [SESSION]: name };
  if (state !== undefined) headers[STATE_HEADER] = state;
  await page.setExtraHTTPHeaders(headers);
  const reset = await request.post('/api/__stub/reset', { headers: { [SESSION]: name } });
  expect(reset.status()).toBe(204);
}

/** The page is settled: network quiet, fonts loaded, no skeleton or busy notice left, the theme the run asked for. */
async function settle(page: Page, host: string): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator(host)).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

const widths = [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop];

test.describe('dashboard', () => {
  for (const width of widths) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`dashboard ${String(width)}`, async ({ page, request }, info) => {
        await session(page, request, `visual-dashboard-${info.testId}-${String(info.retry)}`);
        await page.goto('/w/harbor');
        await settle(page, 'app-dashboard-page');
        await expect(page).toHaveScreenshot(`dashboard-${String(width)}.png`, SCREENSHOT);
      });
    });
  }
});

test.describe('overview', () => {
  for (const width of widths) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const state of STATES) {
        test(`overview ${state} ${String(width)}`, async ({ page, request }, info) => {
          await session(page, request, `visual-overview-${info.testId}-${String(info.retry)}`, state);
          await page.goto('/');
          await settle(page, 'app-overview-page');
          await expect(page).toHaveScreenshot(`overview-${state}-${String(width)}.png`, SCREENSHOT);
        });
      }
    });
  }
});
