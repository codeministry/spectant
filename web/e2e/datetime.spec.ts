/**
 * Spec 006: every date and time in the browser's time zone, through the shared formatter (`shared/time/`).
 * `bun run e2e -- datetime -g zone`, `-g format`. The stub's near-midnight overlay (`atMidnight`, T4) puts
 * `STUB_MIDNIGHT.instant` on harbor 002; a zone east of UTC sees it on the next day, a zone west of it at another hour.
 */
import type { Locator, Page } from '@playwright/test';
import { atMidnight, atWidth, expect, STUB_MIDNIGHT, test, WIDTHS } from './fixtures';
import { MIDNIGHT_HEADER, RESET_PATH, SESSION_HEADER } from './stub-api';

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

/**
 * The overlay instant as Tokyo reads it (1 September 2026, 08:30), in each app language's one format (ISC-114.1):
 * date and time, the date alone, the time alone. German writes the hour with two digits (decision 2026-10-17).
 */
const TOKYO = {
  en: { instant: '09/01/2026, 8:30 AM', date: '09/01/2026', clock: '8:30 AM' },
  de: { instant: '01.09.2026, 08:30', date: '01.09.2026', clock: '08:30' },
} as const;

/** Intl may put a narrow no-break space before the day period; compare on plain spaces. */
async function shown(locator: Locator): Promise<string> {
  return (await locator.innerText()).replace(/[  ]/g, ' ').trim();
}

for (const lang of ['en', 'de'] as const) {
  test.describe(`format in ${lang} (ISC-114.1)`, () => {
    test.use({ timezoneId: STUB_MIDNIGHT.zones.east.timezoneId });
    let session = '';
    test.beforeEach(async ({ page, request }, info) => {
      session = `datetime-${lang}-${info.testId}`;
      await page.context().setExtraHTTPHeaders({ [MIDNIGHT_HEADER]: 'on', [SESSION_HEADER]: session });
      const saved = await request.put('/api/settings', { data: { language: lang }, headers: { [SESSION_HEADER]: session } });
      expect(saved.ok()).toBe(true);
    });
    test.afterEach(async ({ request }) => {
      await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
    });

    test(`format: the gate button and the status tab show date and time as ${TOKYO[lang].instant}`, async ({ page }) => {
      await page.goto(STUB_MIDNIGHT.routes.status);
      const hint = page.locator('[data-gate-hint]').locator(midnightTimes(page));
      await expect(hint.first()).toBeVisible();
      for (const one of await hint.all()) expect(await shown(one)).toBe(TOKYO[lang].instant);
      const rows = page.locator('app-status-tab').locator(midnightTimes(page));
      await expect(rows).not.toHaveCount(0);
      for (const row of await rows.all()) expect(await shown(row)).toBe(TOKYO[lang].instant);
    });

    test('format: the timeline shows the date alone in its day head and the time alone only under it', async ({ page }) => {
      await page.goto(STUB_MIDNIGHT.routes.timeline);
      const day = page.locator(`app-timeline-tab li.day[data-day="${STUB_MIDNIGHT.zones.east.day}"]`);
      await expect(day).toHaveCount(1);
      expect(await shown(day.locator('h3 time'))).toBe(TOKYO[lang].date);
      const clocks = day.locator('.entries').locator(midnightTimes(page));
      await expect(clocks).toHaveCount(STUB_MIDNIGHT.timeline.length);
      for (const clock of await clocks.all()) expect(await shown(clock)).toBe(TOKYO[lang].clock);
      // Every row time of the strand sits in a day whose head shows a date.
      for (const group of await page.locator('app-timeline-tab li.day').all()) {
        if ((await group.locator('.entries time').count()) > 0) await expect(group.locator('h3 time')).toHaveCount(1);
      }
    });
  });
}
