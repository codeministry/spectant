/**
 * Spec 071 (status widget) against the stub API: the widget's own window and its shell-free page.
 *
 * - `bun run e2e -- status-widget -g open` (ISC-581): at 1440 px the header's live trigger opens the status popover;
 *   "Open status widget" (`[data-live-widget]`) opens exactly one new page on `/widget` and closes the popover. A
 *   second click, from the reopened popover, re-targets that window (it navigates again) and opens no second one.
 * - `bun run e2e -- status-widget -g layout` (ISC-582): `/widget` at 360, 480 and 820 px renders the widget alone, with
 *   the stub's default workspaces so KPIs, heads and rows stand, without the app's shell, header controls, nav or
 *   sidebar, and without horizontal scrolling.
 *
 * Spec 072 (widget head):
 *
 * - `bun run e2e -- status-widget-window -g header` (ISC-602): at 360, 480 and 820 px, in English and German, the head
 *   is one flat row at most 48 px high: the brand mark first, the three figures (`dl.kpis` > `div.kpi`) right of it on
 *   the same line, no `ui-kpi-tile` card, nothing wrapping or overflowing.
 */
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { atWidth, expect, headerControl, test } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

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
      await expect(page.locator('app-status-widget-page header.head .kpi')).toHaveCount(3);
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

type Language = 'en' | 'de';
/** The three figure labels of the head, in order, per language (`statusWidget.kpi`). */
function kpiLabels(lang: Language): string[] {
  const catalogue = JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8')) as {
    statusWidget: { kpi: { repos: string; closed: string; claims: string } };
  };
  const { repos, closed, claims } = catalogue.statusWidget.kpi;
  return [repos, closed, claims];
}
/** The head may be at most this high (ISC-602). */
const HEAD_MAX = 48;
/** Tolerance in px for "same row": the figures' tops, and the vertical centres of mark and figures. */
const ROW_SLACK = 2;

type Box = { x: number; y: number; width: number; height: number };
type HeadGeometry = {
  head: Box;
  mark: Box;
  kpis: Box;
  figures: Box[];
  firstChild: string;
  overflow: Array<{ scrollWidth: number; clientWidth: number }>;
};

/** Measures the head in one pass: the boxes of head, mark, figure list and figures, its first child and its overflow. */
async function measureHead(page: Page): Promise<HeadGeometry> {
  return page.locator('app-status-widget-page header.head').evaluate((head) => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const mark = head.querySelector('ui-brand-mark');
    const kpis = head.querySelector('dl.kpis');
    if (!mark || !kpis) throw new Error('head without ui-brand-mark or dl.kpis');
    const figures = [...kpis.querySelectorAll(':scope > div.kpi')];
    return {
      head: box(head),
      mark: box(mark),
      kpis: box(kpis),
      figures: figures.map(box),
      firstChild: head.firstElementChild?.localName ?? '',
      overflow: [head, kpis, ...figures].map((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth })),
    };
  });
}

const centre = (b: Box): number => b.y + b.height / 2;

for (const width of [360, 480, 820] as const) {
  test.describe(`status-widget header at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const lang of ['en', 'de'] as const) {
      test(`header: one flat row, brand mark before the figures, at most 48 px, at ${String(width)} (${lang})`, async ({ page }, info) => {
        const headers = { [SESSION_HEADER]: `widget-header-${lang}-${info.testId}` };
        await page.context().setExtraHTTPHeaders(headers);
        await page.request.post(RESET_PATH, { headers });
        const saved = await page.request.put('/api/settings', { data: { language: lang }, headers });
        expect(saved.ok()).toBe(true);

        await page.goto(WIDGET);
        await expect(page.locator('app-status-widget-page li.row[data-spec]').first()).toBeVisible();
        const head = page.locator('app-status-widget-page header.head');
        await expect(head.locator('dl.kpis > div.kpi > dt')).toHaveText(kpiLabels(lang));
        await expect(page.locator('app-status-widget-page ui-kpi-tile')).toHaveCount(0);

        const g = await measureHead(page);
        info.annotations.push({ type: 'head-height', description: `${String(width)} ${lang}: ${String(g.head.height)} px` });
        // The brand mark is the head's first element; the figures stand right of it, on the same line.
        expect(g.firstChild).toBe('ui-brand-mark');
        expect(g.mark.width).toBeGreaterThan(0);
        expect(g.mark.x + g.mark.width).toBeLessThanOrEqual(g.kpis.x);
        expect(Math.abs(centre(g.mark) - centre(g.kpis))).toBeLessThanOrEqual(ROW_SLACK);
        // Three figures side by side in one row, each inside the head.
        expect(g.figures).toHaveLength(3);
        const top = g.figures[0]?.y ?? 0;
        for (const [i, figure] of g.figures.entries()) {
          const name = `figure ${String(i)}`;
          expect(Math.abs(figure.y - top), `${name} top`).toBeLessThanOrEqual(ROW_SLACK);
          const before = g.figures[i - 1];
          if (before) expect(figure.x, `${name} after the one before`).toBeGreaterThanOrEqual(before.x + before.width);
          expect(figure.y, `${name} inside the head`).toBeGreaterThanOrEqual(g.head.y);
          expect(figure.y + figure.height, `${name} inside the head`).toBeLessThanOrEqual(g.head.y + g.head.height);
          expect(figure.x + figure.width, `${name} inside the head`).toBeLessThanOrEqual(g.head.x + g.head.width);
        }
        expect(g.head.height).toBeLessThanOrEqual(HEAD_MAX);
        for (const [i, o] of g.overflow.entries()) expect(o.scrollWidth, `overflow of box ${String(i)}`).toBeLessThanOrEqual(o.clientWidth);

        await page.request.post(RESET_PATH, { headers });
      });
    }
  });
}
