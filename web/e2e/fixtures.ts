/**
 * The one import every spec under `web/e2e/` uses instead of `@playwright/test` (T28 seam):
 *
 *   import { test, expect, atWidth, awaitReady } from './fixtures';   // `../fixtures` from `browser/`
 *
 * - The clock is pinned to `FIXED_NOW` before every test (option `clockAt`; `null` opts out, e.g. for a refresh
 *   spec that installs its own fake timers with `page.clock.install()`).
 * - `awaitReady(page)` is the only readiness wait: the app sets `data-ready="true"` on `<body>` once the first
 *   dashboard model is rendered and the fonts are loaded. Never wait on a timeout.
 * - `atWidth(width)` gives the `test.use` block for one of the baseline widths (390 / 820 / 1440) or any other.
 */
import { test as base, expect, type Page } from '@playwright/test';

import { theme } from './env';

export { expect, theme };

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
