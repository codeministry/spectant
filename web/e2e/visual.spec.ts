/**
 * The visual smoke set: six representative pages, light at 390, 820 and 1440 (one width per tier), dark at 1440 only,
 * since the dark theme changes colours, not layout. 24 baselines that catch an unintended visual change (a cascade
 * side effect, a broken tier, a theme token) without pinning every view of every spec; behaviour and structure stay
 * with the e2e and browser tiers.
 *
 *   bun run test:visual                       light, 18 baselines
 *   bun run test:visual -- --theme dark       dark, 6 baselines
 *   bun run test:visual -- board              one page (the group names below)
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual.spec.ts/` and are recorded only in the pinned
 * linux/arm64 container (`bun run test:visual:ci -- -u`). The clock is pinned by the fixtures (FIXED_NOW), the suite
 * runs with reduced motion, and each test runs in its own stub session, reset first.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';
import { STATE_HEADER, STUB_LIBRARY } from './stub-api';

const SESSION = 'X-Spectant-Stub-Session';
const SCREENSHOT = { fullPage: true, maxDiffPixelRatio: 0 } as const;

interface View {
  readonly name: string;
  readonly path: string;
  /** The page's host element; visible once the route rendered. */
  readonly host: string;
  /** The stub's `X-Spectant-Stub-State`, when the page needs one. */
  readonly state?: string;
  /** What must be drawn beyond the host before the capture (a late SVG, the first table row). */
  readonly drawn?: (page: Page) => Promise<void>;
}

const VIEWS: readonly View[] = [
  { name: 'overview', path: '/', host: 'app-overview-page', state: 'two-workspaces' },
  { name: 'dashboard', path: '/w/harbor', host: 'app-dashboard-page' },
  { name: 'board', path: '/w/harbor/s/002/board', host: 'app-board-tab' },
  { name: 'status', path: '/w/harbor/s/002/status', host: 'app-status-tab' },
  {
    name: 'help',
    path: '/help',
    host: 'app-help-page',
    // The one rendered workflow figure (the type select's pick, feature), its nodes labelled from the catalogue.
    drawn: async (page) => {
      await expect(page.locator('figure[data-workflow-figure] [data-diagram][data-rendered] > .canvas > svg[role="img"]')).toHaveCount(1);
      await expect(page.locator('figure[data-workflow-figure="feature"] [data-diagram] g[data-stage] text').first()).not.toHaveText(
        /^stages\./,
      );
    },
  },
  {
    name: 'library',
    // The stub's prototype picked and the list narrowed to its spec, so the group head stands above the fold of the
    // list's own scroll: at 1440 the list (control counts, the spec's group head) sits beside the reader with the
    // prototype card; below the wide tier the reader takes the list's place, and the image shows the card alone.
    path: `/w/harbor/library?spec=${STUB_LIBRARY.prototype.path.slice(0, 3)}#${STUB_LIBRARY.prototype.path}`,
    host: 'app-library-page',
    drawn: async (page) => {
      const preview = page.locator('[data-library-prototype] [data-library-prototype-preview] img');
      await expect(preview).toBeVisible();
      await expect.poll(() => preview.evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0))).toBeGreaterThan(0);
      if ((page.viewportSize()?.width ?? 0) < WIDTHS.desktop) return;
      await expect(page.locator('[data-library-controls] [data-library-control] [data-library-control-count]')).toHaveCount(2);
      await expect(page.locator('[data-library-group-head] [data-library-head="claims"]').first()).toBeVisible();
    },
  },
];

const widths = theme === 'dark' ? [WIDTHS.desktop] : [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop];

/** The page is settled: network quiet, fonts loaded, no skeleton or busy notice left, the theme the run asked for. */
async function settle(page: Page, view: View): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator(view.host)).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  await view.drawn?.(page);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // A relative time that moved would break the baseline, so prove the clock is frozen.
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

for (const view of VIEWS) {
  test.describe(view.name, () => {
    for (const width of widths) {
      test.describe(`at ${String(width)}`, () => {
        test.use(atWidth(width));

        test(`${view.name} ${String(width)}`, async ({ page, request }, info) => {
          const session = `visual-${view.name}-${info.testId}-${String(info.retry)}`;
          await page.setExtraHTTPHeaders({ [SESSION]: session, ...(view.state === undefined ? {} : { [STATE_HEADER]: view.state }) });
          const reset = await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
          expect(reset.status()).toBe(204);
          await page.goto(view.path);
          await settle(page, view);
          await expect(page).toHaveScreenshot(`${view.name}-${String(width)}.png`, SCREENSHOT);
        });
      });
    }
  });
}
