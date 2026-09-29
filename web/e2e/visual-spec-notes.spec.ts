/**
 * T109 · ISC-96 and T110 · ISC-96.1: the visual baseline of the spec dashboard and the Notes area (list, and one
 * seeded note open) for harbor 002 at 390, 820 and 1440, full page. The claims' probes:
 *
 *   bun run test:visual -- spec notes                 light (ISC-96)
 *   bun run test:visual -- spec notes --theme dark    dark  (ISC-96.1); `--theme` becomes E2E_THEME → colorScheme, and
 *                                                     the stub's default theme `system` follows it
 *
 * `-g` also matches the file name, so `spec notes` selects every `*.spec.ts` of the visual suite; the group name
 * `dashboard-notes` selects only this file. Baselines live under
 * `__screenshots__/chromium/{light,dark}/visual-spec-notes.spec.ts/`, recorded only in the pinned container. The clock
 * is pinned (FIXED_NOW) and each test runs in its own stub session, reset first, with the stub's seeded notes.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';
import { STUB_NOTES } from './stub-api';

const SESSION = 'X-Spectant-Stub-Session';
const SPEC = '/w/harbor/s/002';
const SCREENSHOT = { fullPage: true, maxDiffPixelRatio: 0 } as const;

// The newest seeded harbor 002 note: the one the list shows first, opened in the editor.
const OPENED = STUB_NOTES.find((note) => note.workspace === 'harbor' && note.anchor?.spec === '002');
if (!OPENED) throw new Error('STUB_NOTES holds no harbor 002 note');

const PAGES = [
  { name: 'dashboard', path: SPEC, host: 'app-spec-dashboard' },
  { name: 'notes', path: `${SPEC}/notes`, host: 'app-notes-area' },
  { name: 'note', path: `${SPEC}/notes/${OPENED.id}`, host: 'app-notes-area' },
] as const;

test.beforeEach(async ({ page, request }, info) => {
  const session = `visual-notes-${info.testId}-${String(info.retry)}`;
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

test.describe('spec dashboard-notes', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const view of PAGES) {
        test(`${view.name} ${String(width)}`, async ({ page }) => {
          await page.goto(view.path);
          await settle(page, view.host);
          await expect(page).toHaveScreenshot(`${view.name}-${String(width)}.png`, SCREENSHOT);
        });
      }
    });
  }
});
