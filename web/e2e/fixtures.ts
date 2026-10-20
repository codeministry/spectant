/**
 * The one import every spec under `web/e2e/` uses instead of `@playwright/test` (T28 seam):
 *
 *   import { test, expect, atWidth, awaitReady, headerControl } from './fixtures';   // `../fixtures` from `browser/`
 *
 * - The clock is pinned to `FIXED_NOW` before every test (option `clockAt`; `null` opts out, e.g. for a refresh
 *   spec that installs its own fake timers with `page.clock.install()`).
 * - Readiness waits, never a timeout: `awaitReady(page)` once the app sets `data-ready="true"` on `<body>` (the first
 *   dashboard model rendered, fonts loaded); `headerControl(page, name)` waits for the deferred menus (`menusReady`)
 *   before it returns a header control (before they mount, a click on a picker or the settings button takes its
 *   fallback route).
 * - `atWidth(width)` gives the `test.use` block for one of the baseline widths (390 / 820 / 1440) or any other.
 */
import { test as base, expect, type Locator, type Page } from '@playwright/test';

import { theme } from './env';
import { MIDNIGHT_HEADER, STUB_MIDNIGHT, STUB_MILESTONE } from './stub-api';

export { expect, theme, STUB_MIDNIGHT, STUB_MILESTONE };

/**
 * `test.use(atMidnight('east'))` (spec 006, T4, ISC-114 / ISC-114.3): the browser in `STUB_MIDNIGHT.zones[side]`
 * (Tokyo east of UTC, Los Angeles west of it) and the stub's near-midnight fixture on, so harbor 002 shows
 * `STUB_MIDNIGHT.instant` on its reviewed mark, newest round, reviewed event and library spec.md; the zone's `day` and
 * `hour` are what each must read. The clock stays `FIXED_NOW`, which lies after the instant.
 */
export function atMidnight(side: keyof typeof STUB_MIDNIGHT.zones): { timezoneId: string; extraHTTPHeaders: Record<string, string> } {
  return { timezoneId: STUB_MIDNIGHT.zones[side].timezoneId, extraHTTPHeaders: { [MIDNIGHT_HEADER]: 'on' } };
}

/** The instant every test sees as "now", unless it sets `clockAt`. A fixed offset keeps it DST-proof. */
export const FIXED_NOW = '2026-09-01T10:00:00+02:00';

/** The baseline widths of ISC-16.1 … ISC-17.1, plus the cmux side panel of ISC-63. */
export const WIDTHS = { phone: 390, tablet: 820, desktop: 1440, panel: 600 } as const;

const HEIGHTS: Readonly<Record<number, number>> = { 390: 844, 600: 900, 820: 1180, 1440: 900 };

/** `test.use(atWidth(390))`: a viewport of that width with the height of the matching reference device. */
export function atWidth(width: number): { viewport: { width: number; height: number } } {
  return { viewport: { width, height: HEIGHTS[width] ?? 900 } };
}

/** Freeze `Date.now()` and `new Date()` at `iso`; timers keep running. Call before `page.goto`. */
// spec 024: one-row header, overflow menu below 1120 (principal 2026-10-13): below 1120 px the area, zen, settings and help
// controls are entries of the header's overflow menu `⋯` (`data-tool="more"`), each carrying the same hook. Opens the
// menu there and returns the control (`data-control`, or `data-tool` for help and assistant), ready to click or check.
// It waits for the deferred header menus first (`menusReady`, spec 057 ISC-384), so a click opens the menu rather than
// taking the control's fallback route.
export async function headerControl(page: Page, name: string): Promise<Locator> {
  await menusReady(page);
  const hook = name === 'help' || name === 'assistant' ? 'data-tool' : 'data-control';
  const control = page.locator(`header [${hook}="${name}"]`);
  if ((page.viewportSize()?.width ?? 1440) < 1120 && ['area', 'zen', 'settings', 'help', 'assistant'].includes(name)) {
    await page.locator('header [data-tool="more"]').click();
    await expect(control).toBeVisible();
  }
  return control;
}

/**
 * The header's menus (pickers, settings panel, area, PAGE and overflow menus) live in a deferred block; before it mounts
 * a plain click on a picker or the settings button takes its fallback route instead of opening the panel. This waits
 * for the block's own mount signal (spec 057, ISC-382): `ShellNav` sets `data-menus-mounted` once its reference to the
 * mounted menus resolves, the one its click handler reads. `headerControl` calls it, so a test never needs to.
 */
export async function menusReady(page: Page): Promise<void> {
  await page.locator('app-shell-nav[data-menus-mounted]').first().waitFor({ state: 'attached' });
}

export async function pinClock(page: Page, iso: string = FIXED_NOW): Promise<void> {
  await page.clock.setFixedTime(new Date(iso));
}

/** Resolve once the app reports it has rendered its first model: `<body data-ready="true">`. */
export async function awaitReady(page: Page): Promise<void> {
  await page.locator('body[data-ready="true"]').waitFor({ state: 'attached' });
}

type Options = { clockAt: string | null };

export const test = base.extend<Options & { pinnedClock: undefined }>({
  clockAt: [FIXED_NOW, { option: true }],
  pinnedClock: [
    async ({ page, clockAt }, use) => {
      if (clockAt !== null) await pinClock(page, clockAt);
      await use(undefined);
    },
    { auto: true },
  ],
});
