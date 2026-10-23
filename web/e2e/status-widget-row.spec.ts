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
 *
 * Spec 072 (T13, ISC-601): `bun run e2e -- status-widget-row -g copy`. A click on a row's copy chip copies its command
 * and nothing else: the opener keeps its URL and receives no `spectant:navigate`, the widget stays on `/widget` and no
 * page opens; in tab mode (no opener) the tab stays on `/widget`. No row holds a button inside its link (`a button`),
 * and every chip sits outside its row's `a.entry-link`.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, headerControl, menusReady, test } from './fixtures';

test.use(atWidth(1440));

/** The available screen width every page of the context reports: a desktop screen wider than the widget popup. */
const DESKTOP_SCREEN_WIDTH = 1920;

/** Opens the widget from the app's live popover and returns its page, once its rows have rendered. */
async function openWidgetFrom(app: Page): Promise<Page> {
  await (await headerControl(app, 'live')).click();
  const [widget] = await Promise.all([app.waitForEvent('popup'), app.locator('button[data-live-widget]').click()]);
  await widget.locator('[data-workspace="lantern"] [data-spec] a.entry-link').first().waitFor();
  return widget;
}

/** The copy button of the first unlocked command chip in harbor's rows (the stub's harbor rows carry `nextCommand`). */
const harborCopyButton = (widget: Page): Locator =>
  widget.locator('[data-workspace="harbor"] [data-spec] ui-command-chip button.copy:not([data-locked])').first();

/** Every row's chip stands outside its link: no button inside any `a`, no chip inside any `a.entry-link`. */
async function expectChipsOutsideLinks(widget: Page): Promise<void> {
  expect(await widget.locator('[data-spec] ui-command-chip').count(), 'rows carry copy chips').toBeGreaterThan(0);
  expect(await widget.locator('a button, a [role=button]').count(), 'no button inside a link').toBe(0);
  expect(await widget.locator('a.entry-link ui-command-chip').count(), 'no chip inside a row link').toBe(0);
}

/** Clicks `button` over a cleared clipboard, waits for its copied state and returns the chip's command and the clipboard. */
async function copyFrom(widget: Page, button: Locator): Promise<{ command: string; clipboard: string }> {
  const command = (await button.locator('xpath=ancestor::ui-command-chip[1]//code').textContent())?.trim() ?? '';
  await widget.evaluate(() => navigator.clipboard.writeText(''));
  await button.click();
  await expect(button, 'the chip confirms the copy').toHaveAttribute('data-copied', '');
  return { command, clipboard: await widget.evaluate(() => navigator.clipboard.readText()) };
}

/** Counts the main-frame navigations of `page` from now on. */
function navigationsOf(page: Page): () => number {
  let count = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) count += 1;
  });
  return () => count;
}

test.describe('status widget row', () => {
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('copy chip of a row copies its command in popup mode: no opener navigation, no message, the widget stays', async ({ page, context }) => {
    await context.addInitScript((width) => {
      Object.defineProperty(Screen.prototype, 'availWidth', { configurable: true, get: () => width });
    }, DESKTOP_SCREEN_WIDTH);
    await page.goto('/w/harbor');
    await menusReady(page);
    const openerUrl = page.url();
    await page.evaluate(() => {
      const w = window as Window & { __messages?: unknown[] };
      w.__messages = [];
      window.addEventListener('message', (event) => w.__messages?.push(event.data));
    });
    const openerNavigations = navigationsOf(page);

    const widget = await openWidgetFrom(page);
    await expect(widget).toHaveURL(/\/widget$/);
    expect(await widget.evaluate(() => window.outerWidth < screen.availWidth), 'widget in popup mode').toBe(true);
    await expectChipsOutsideLinks(widget);
    const widgetNavigations = navigationsOf(widget);
    const pagesBefore = context.pages().length;

    const { command, clipboard } = await copyFrom(widget, harborCopyButton(widget));
    expect(command, 'the chip shows a command').toMatch(/^\/spec \S/);
    expect(clipboard, 'the clipboard holds exactly the command').toBe(command);
    // A posted message or a router move lands within a frame or two; give it the time before counting.
    await widget.waitForTimeout(300);
    expect(page.url(), 'the opener keeps its URL').toBe(openerUrl);
    expect(openerNavigations(), 'the opener does not navigate').toBe(0);
    expect(await page.evaluate(() => (window as Window & { __messages?: unknown[] }).__messages), 'no message reaches the opener').toEqual([]);
    await expect(widget).toHaveURL(/\/widget$/);
    expect(widgetNavigations(), 'the widget does not navigate').toBe(0);
    expect(context.pages(), 'no page opens').toHaveLength(pagesBefore);
  });

  test('copy chip of a row copies its command in tab mode: the tab stays on /widget', async ({ page, context }) => {
    await page.goto('/widget');
    await page.locator('[data-workspace="harbor"] [data-spec] a.entry-link').first().waitFor();
    expect(await page.evaluate(() => window.opener === null), 'widget without opener').toBe(true);
    await expectChipsOutsideLinks(page);
    const navigations = navigationsOf(page);
    const pagesBefore = context.pages().length;

    const { command, clipboard } = await copyFrom(page, harborCopyButton(page));
    expect(command, 'the chip shows a command').toMatch(/^\/spec \S/);
    expect(clipboard, 'the clipboard holds exactly the command').toBe(command);
    await page.waitForTimeout(300);
    await expect(page).toHaveURL(/\/widget$/);
    expect(navigations(), 'the tab does not navigate').toBe(0);
    expect(context.pages(), 'no page opens').toHaveLength(pagesBefore);
  });

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
    const row = widget.locator('[data-workspace="lantern"] [data-spec] a.entry-link').first();
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
