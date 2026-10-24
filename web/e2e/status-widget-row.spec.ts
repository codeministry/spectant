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
 *
 * Spec 075 (C9-C11, ISC-638, ISC-639, ISC-640): `bun run e2e -- status-widget-row -g "dot inside ring"`. On `/widget`
 * under `X-Spectant-Stub-Locks: runs` (beacon's 003 and 005 carry an open run), at 360, 480 and 820 px: the ring
 * of every row measures 32 px, stands vertically centred in its row (top and bottom gap equal ±1 px, one- and two-line
 * rows alike), keeps ≥ 8 px to the row's top, bottom and start edge and ≥ 12 px to the spec number; the agent dot of
 * a running row (its own 8 px box; the ping halo is an animation and not measured) is centred on the ring ±1 px and
 * lies wholly inside its inner circle, with and without reduced motion. Geometry is theme-independent; the light
 * theme runs.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, headerControl, menusReady, test } from './fixtures';
import { LOCKS_HEADER } from './stub-api';

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

/** The ring size, its stroke and the row clearances of spec 075 (ISC-638, ISC-640). */
const RING = { size: 32, stroke: 3, edge: 8, toNumber: 12 } as const;

type Box = { top: number; bottom: number; left: number; right: number; width: number; height: number };

test.describe('dot inside ring', () => {
  test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'runs' } });

  for (const width of [360, 480, 820] as const) {
    test.describe(`at ${width} px`, () => {
      test.use(atWidth(width));

      test(`ring in row (ISC-639, ISC-640): 32 px, centred, clear of the edges and the number · ${width}`, async ({ page }) => {
        await page.goto('/widget');
        await page.locator('[data-spec] a.entry-link').first().waitFor();
        const rows = await page.locator('[data-spec] .entry').evaluateAll((entries) =>
          entries.map((entry) => {
            const box = (el: Element | null): Box | null => {
              if (el === null) return null;
              const r = el.getBoundingClientRect();
              return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
            };
            return {
              id: entry.closest('[data-spec]')?.getAttribute('data-spec') ?? '?',
              twoLine: entry.getBoundingClientRect().height > 52,
              row: box(entry),
              ring: box(entry.querySelector('ui-ring')),
              num: box(entry.querySelector('.entry-id')),
            };
          }),
        );
        expect(rows.length, 'the widget lists rows').toBeGreaterThan(0);
        expect(rows.some((r) => r.twoLine), 'a two-line row').toBe(true);
        if (width === 820) expect(rows.some((r) => !r.twoLine), 'a one-line row').toBe(true);
        for (const { id, row, ring, num } of rows) {
          if (row === null || ring === null || num === null) throw new Error(`row ${id} lacks a part`);
          const top = ring.top - row.top;
          const bottom = row.bottom - ring.bottom;
          expect.soft([ring.width, ring.height], `row ${id}: ring size`).toEqual([RING.size, RING.size]);
          expect.soft(Math.abs(top - bottom), `row ${id}: |top ${top} − bottom ${bottom}|`).toBeLessThanOrEqual(1);
          expect.soft(Math.min(top, bottom), `row ${id}: ring to top/bottom edge`).toBeGreaterThanOrEqual(RING.edge);
          expect.soft(ring.left - row.left, `row ${id}: ring to start edge`).toBeGreaterThanOrEqual(RING.edge);
          expect.soft(num.left - ring.right, `row ${id}: ring to number`).toBeGreaterThanOrEqual(RING.toNumber);
        }
      });

      for (const motion of ['no-preference', 'reduce'] as const) {
        test(`dot inside ring (ISC-638): the agent dot centred in the ring's inner circle · ${width} · ${motion}`, async ({ page }) => {
          await page.emulateMedia({ reducedMotion: motion });
          await page.goto('/widget');
          const running = page.locator('[data-workspace="beacon"] [data-spec] .entry:has(ui-agent-dot)');
          await running.first().waitFor();
          const seen = await running.evaluateAll((entries) =>
            entries.map((entry) => {
              const host = entry.querySelector('ui-agent-dot');
              const ring = entry.querySelector('ui-ring')?.getBoundingClientRect();
              // The dot's own 8 px box; its ping halo `.ring` is an animation and is not measured.
              const dot = host?.getBoundingClientRect();
              return {
                id: entry.closest('[data-spec]')?.getAttribute('data-spec') ?? '?',
                ring: ring && { x: ring.left + ring.width / 2, y: ring.top + ring.height / 2 },
                dot: dot && { x: dot.left + dot.width / 2, y: dot.top + dot.height / 2, w: dot.width, h: dot.height },
                visible: host !== null && dot !== undefined && dot.width > 0 && getComputedStyle(host).visibility === 'visible',
              };
            }),
          );
          expect(seen.length, 'running rows').toBeGreaterThan(0);
          const inner = (RING.size - 2 * RING.stroke) / 2;
          for (const { id, ring, dot, visible } of seen) {
            if (!ring || !dot) throw new Error(`row ${id} lacks ring or dot`);
            expect.soft(visible, `row ${id}: the dot is visible`).toBe(true);
            expect.soft(Math.abs(dot.x - ring.x), `row ${id}: dot centre x off ring centre`).toBeLessThanOrEqual(1);
            expect.soft(Math.abs(dot.y - ring.y), `row ${id}: dot centre y off ring centre`).toBeLessThanOrEqual(1);
            // The dot is a circle in its box: its farthest point from the ring centre stays inside the inner radius.
            const reach = Math.hypot(dot.x - ring.x, dot.y - ring.y) + Math.max(dot.w, dot.h) / 2;
            expect.soft(reach, `row ${id}: dot reach ${reach} within inner radius ${inner}`).toBeLessThan(inner);
          }
        });
      }
    });
  }
});
