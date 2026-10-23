/**
 * Spec 071 (status widget) against the stub API: the widget's own window and its shell-free page.
 *
 * - `bun run e2e -- status-widget -g open` (ISC-581): at 1440 px the header's live trigger opens the status popover;
 *   "Open status widget" (`[data-live-widget]`) opens exactly one new page on `/widget` and closes the popover. A
 *   second click, from the reopened popover, re-targets that window (it navigates again) and opens no second one.
 * - `bun run e2e -- status-widget -g layout` (ISC-582): `/widget` at 360, 480 and 820 px renders the widget alone, with
 *   the stub's default workspaces so KPIs, heads and rows stand, without the app's shell, header controls, nav or
 *   sidebar, and without horizontal scrolling.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, headerControl, test } from './fixtures';

/** The widget's route (`WIDGET_PATH`). */
const WIDGET = '/widget';
/** The fixed window name every open targets (`WIDGET_WINDOW_NAME`). */
const WINDOW_NAME = 'spectant-status';
/** The popover's widget entry. */
const WIDGET_BUTTON = '[data-live-widget]';
/** Everything of the app's shell that must not render on the widget's route. */
const SHELL = ['app-shell', 'app-shell-header', 'app-shell-nav', 'header [data-control]', 'nav', 'aside', 'app-detail-sidebar'] as const;

/** Opens the status popover from the header's live trigger and returns the trigger. */
async function openPopover(page: Page): ReturnType<typeof headerControl> {
  const live = await headerControl(page, 'live');
  await live.click();
  await expect(live).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator(WIDGET_BUTTON)).toBeVisible();
  return live;
}

test.describe('status-widget open', () => {
  test.use(atWidth(1440));

  test('open: two clicks open one window on /widget and close the popover', async ({ page, context }) => {
    await page.goto('/');
    let opened = 0;
    context.on('page', () => {
      opened += 1;
    });

    const live = await openPopover(page);
    const [popup] = await Promise.all([context.waitForEvent('page'), page.locator(WIDGET_BUTTON).click()]);
    await popup.waitForURL((url) => url.pathname === WIDGET);
    expect(await popup.evaluate(() => window.name)).toBe(WINDOW_NAME);
    await expect(live).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(WIDGET_BUTTON)).toBeHidden();

    // The second click re-targets the named window: it loads `/widget` again, and no other page appears.
    await openPopover(page);
    await Promise.all([popup.waitForEvent('load'), page.locator(WIDGET_BUTTON).click()]);
    await expect(live).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator(WIDGET_BUTTON)).toBeHidden();
    expect(new URL(popup.url()).pathname).toBe(WIDGET);
    expect(opened).toBe(1);
    expect(context.pages()).toHaveLength(2);
  });
});

for (const width of [360, 480, 820] as const) {
  test.describe(`status-widget layout at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`layout: /widget at ${String(width)} without the shell and without horizontal scrolling`, async ({ page }) => {
      await page.goto(WIDGET);
      await expect(page.locator('app-status-widget-page ui-kpi-tile')).toHaveCount(3);
      await expect(page.locator('app-status-widget-page .group-head').first()).toBeVisible();
      await expect(page.locator('app-status-widget-page li.row[data-spec]').first()).toBeVisible();

      for (const selector of SHELL) await expect(page.locator(selector), selector).toHaveCount(0);
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    });
  });
}
