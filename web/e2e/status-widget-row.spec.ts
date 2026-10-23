/**
 * Spec 071 (T37, ISC-586, ISC-586.1): a click on a status widget row opens `/w/<ws>/s/<id>` of its workspace in the app
 * window that opened the widget, through that window's router (no reload), and the widget stays open on `/widget`; once
 * that window is gone, the row navigates the widget's own tab instead, never a new one.
 * `bun run e2e -- status-widget -g row`. Against the stub API: the app on `/w/harbor` opens the widget from the live
 * popover, and the row clicked belongs to the second workspace, lantern.
 *
 * Headless Chromium sizes the popup to its `window.open` features and emulates a screen of exactly that size, so the
 * popup's `outerWidth` equals `screen.availWidth` and the widget would take tab mode (ISC-586.1). An init script on
 * the context gives every page a 1920 px wide desktop screen instead, so the 480 px popup runs in popup mode.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, headerControl, menusReady, test } from './fixtures';

test.use(atWidth(1440));

/** The available screen width every page of the context reports: a desktop screen wider than the widget popup. */
const DESKTOP_SCREEN_WIDTH = 1920;

/** Opens the widget from the app's live popover and returns its page, once its rows have rendered. */
async function openWidgetFrom(app: Page): Promise<Page> {
  await (await headerControl(app, 'live')).click();
  const [widget] = await Promise.all([app.waitForEvent('popup'), app.locator('button[data-live-widget]').click()]);
  await widget.locator('[data-workspace="lantern"] [data-spec] a.entry').first().waitFor();
  return widget;
}

test.describe('status widget row', () => {
  test('row of a second workspace navigates the opener without a reload, then its own tab once the opener is gone', async ({ page, context }) => {
    await context.addInitScript((width) => {
      Object.defineProperty(Screen.prototype, 'availWidth', { configurable: true, get: () => width });
    }, DESKTOP_SCREEN_WIDTH);
    await page.goto('/w/harbor');
    await menusReady(page);
    // A marker on the opener's window survives a router navigation and dies with a document load.
    await page.evaluate(() => {
      (window as Window & { __noReload?: boolean }).__noReload = true;
    });
    let openerDocuments = 0;
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) openerDocuments += 1;
    });

    const widget = await openWidgetFrom(page);
    await expect(widget).toHaveURL(/\/widget$/);
    expect(await widget.evaluate(() => window.outerWidth < screen.availWidth), 'widget in popup mode').toBe(true);
    const row = widget.locator('[data-workspace="lantern"] [data-spec] a.entry').first();
    const target = await row.getAttribute('href');
    expect(target).toMatch(/^\/w\/lantern\/s\/[^/]+$/);

    // Popup mode: the opener follows the row, the widget stays where it is.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`${String(target)}$`));
    expect(await page.evaluate(() => (window as Window & { __noReload?: boolean }).__noReload)).toBe(true);
    expect(openerDocuments).toBe(0);
    await expect(widget).toHaveURL(/\/widget$/);
    expect(widget.isClosed()).toBe(false);

    // Opener closed: the row navigates the widget's own tab, no new tab opens.
    await page.close();
    const pagesBefore = context.pages().length;
    await row.click();
    await expect(widget).toHaveURL(new RegExp(`${String(target)}$`));
    expect(context.pages()).toHaveLength(pagesBefore);
    expect(widget.isClosed()).toBe(false);
  });
});
