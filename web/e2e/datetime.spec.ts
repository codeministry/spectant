/**
 * Spec 006: every date and time in the browser's time zone, through the shared formatter (`shared/time/`).
 * `bun run e2e -- datetime -g zone`. The stub's near-midnight overlay (`atMidnight`, T4) puts `STUB_MIDNIGHT.instant`
 * on harbor 002; a zone east of UTC sees it on the next day, a zone west of it at another hour.
 */
import type { Locator, Page } from '@playwright/test';
import { atMidnight, atWidth, expect, STUB_MIDNIGHT, test, WIDTHS } from './fixtures';

test.use(atWidth(WIDTHS.desktop));

type Side = keyof typeof STUB_MIDNIGHT.zones;

/** Day of month and `h:mm` clock of an instant in one zone, as `en` (the e2e locale) writes them in any form. */
function wallClock(iso: string, timeZone: string): { readonly day: string; readonly clock: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, day: 'numeric', hour: 'numeric', minute: '2-digit' }).formatToParts(Date.parse(iso));
  const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find((p) => p.type === type)?.value ?? '';
  return { day: part('day'), clock: `${part('hour')}:${part('minute')}` };
}

/** Every `<time>` on the page that carries the overlay instant. */
function midnightTimes(page: Page): Locator {
  return page.locator(`time[datetime="${STUB_MIDNIGHT.instant}"]`);
}

/** Each such element shows the zone's day and hour, and not UTC's. */
async function expectZone(times: Locator, side: Side): Promise<void> {
  const zone = wallClock(STUB_MIDNIGHT.instant, STUB_MIDNIGHT.zones[side].timezoneId);
  const utc = wallClock(STUB_MIDNIGHT.instant, 'UTC');
  await expect(times.first()).toBeVisible();
  for (const text of await times.allInnerTexts()) {
    const shown = text.replace(/\s+/g, ' ');
    expect(shown, `${side}: ${shown}`).toMatch(new RegExp(`(^|\\D)0?${zone.day}(\\D|$)`));
    expect(shown, `${side}: ${shown}`).toContain(zone.clock);
    expect(shown, `${side}: ${shown}`).not.toContain(utc.clock);
  }
}

for (const side of ['east', 'west'] as const) {
  test.describe(`zone ${side} of UTC (ISC-114)`, () => {
    test.use(atMidnight(side));

    test(`zone: the library list shows the document's date in the ${side} zone`, async ({ page }) => {
      await page.goto(STUB_MIDNIGHT.routes.library);
      await expectZone(page.locator(`[data-library-entry="${STUB_MIDNIGHT.doc}"] .lib-date`).locator(midnightTimes(page)), side);
    });

    test(`zone: the reader shows the document's update in the ${side} zone`, async ({ page }) => {
      await page.goto(STUB_MIDNIGHT.routes.reader);
      await expectZone(page.locator('app-library-reader').locator(midnightTimes(page)), side);
    });

    test(`zone: the status tab shows the newest round and the reviewed event in the ${side} zone`, async ({ page }) => {
      await page.goto(STUB_MIDNIGHT.routes.status);
      const times = page.locator('app-status-tab').locator(midnightTimes(page));
      await expect(times).not.toHaveCount(0);
      await expectZone(times, side);
    });
  });
}
