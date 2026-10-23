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
 * - `bun run e2e -- status-widget-window -g layout` (ISC-607): the layout tests above, in light and dark theme, with
 *   the head, the filter (`section.widget-filter`, two `ui-filter-chips`) and the command lines (`div.entry-cmd` >
 *   `ui-command-chip`): nothing scrolls sideways (page, filter, chip rows, rows), every row's title and copy chip stay
 *   inside its `div.entry` (1 px), and the stub's long row `STUB_STATUS_LONG` keeps its command chip inside the row
 *   and ends its title in an ellipsis at 360 px.
 */
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { atWidth, expect, headerControl, test } from './fixtures';
import { RESET_PATH, SESSION_HEADER, STUB_STATUS_LONG } from './stub-api';

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

/** Tolerance in px for "inside the row" (ISC-607). */
const INSIDE_SLACK = 1;

type Rect = { left: number; right: number; top: number; bottom: number };
type Overflow = { name: string; scrollWidth: number; clientWidth: number };
type RowGeometry = {
  workspace: string;
  spec: string;
  entry: Rect;
  parts: Array<{ name: string; rect: Rect }>;
  command: string | null;
  title: { scrollWidth: number; clientWidth: number; textOverflow: string };
};
type LayoutGeometry = { overflow: Overflow[]; rows: RowGeometry[] };

/** Measures the widget in one pass: the overflow of page, filter, chip rows and rows, and every row's parts. */
async function measureLayout(page: Page): Promise<LayoutGeometry> {
  return page.locator('app-status-widget-page').evaluate((host) => {
    const rect = (el: Element): Rect => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const overflowOf = (name: string, el: Element): Overflow => ({ name, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth });
    const overflow: Overflow[] = [overflowOf('html', document.documentElement)];
    for (const filter of host.querySelectorAll('section.widget-filter')) overflow.push(overflowOf('section.widget-filter', filter));
    for (const [i, chips] of [...host.querySelectorAll('ui-filter-chips')].entries()) {
      overflow.push(overflowOf(`ui-filter-chips ${String(i)}`, chips));
      for (const row of chips.querySelectorAll('.row')) overflow.push(overflowOf(`ui-filter-chips ${String(i)} .row`, row));
    }
    const rows: RowGeometry[] = [];
    for (const li of host.querySelectorAll('li.row[data-spec]')) {
      const workspace = li.closest('[data-workspace]')?.getAttribute('data-workspace') ?? '';
      const spec = li.getAttribute('data-spec') ?? '';
      const at = `${workspace}/${spec}`;
      overflow.push(overflowOf(`li.row ${at}`, li));
      const entry = li.querySelector('div.entry');
      const title = li.querySelector('.entry-title');
      const link = li.querySelector('a.entry-link');
      if (!entry || !title || !link) throw new Error(`row ${at} without div.entry, a.entry-link or .entry-title`);
      overflow.push(overflowOf(`div.entry ${at}`, entry));
      const parts = [
        { name: 'a.entry-link', rect: rect(link) },
        { name: '.entry-title', rect: rect(title) },
      ];
      const cmd = entry.querySelector('div.entry-cmd');
      const chip = cmd?.querySelector('ui-command-chip');
      if (cmd) parts.push({ name: 'div.entry-cmd', rect: rect(cmd) });
      if (chip) parts.push({ name: 'ui-command-chip', rect: rect(chip) });
      rows.push({
        workspace,
        spec,
        entry: rect(entry),
        parts,
        command: chip?.querySelector('code')?.textContent.trim() ?? null,
        title: { scrollWidth: title.scrollWidth, clientWidth: title.clientWidth, textOverflow: getComputedStyle(title).textOverflow },
      });
    }
    return { overflow, rows };
  });
}

for (const width of [360, 480, 820] as const) {
  for (const theme of ['light', 'dark'] as const) {
    test.describe(`status-widget layout at ${String(width)}, ${theme}`, () => {
      test.use({ ...atWidth(width), colorScheme: theme });

      test(`layout: /widget at ${String(width)}, ${theme}: head, filter and command rows, no shell, no horizontal scrolling`, async ({ page }, info) => {
        await page.goto(WIDGET);
        await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
        const widget = page.locator('app-status-widget-page');
        await expect(widget.locator('header.head .kpi')).toHaveCount(3);
        await expect(widget.locator('section.widget-filter')).toHaveCount(1);
        await expect(widget.locator('section.widget-filter ui-filter-chips')).toHaveCount(2);
        await expect(widget.locator('.group-head').first()).toBeVisible();
        await expect(widget.locator('li.row[data-spec]').first()).toBeVisible();
        await expect(widget.locator('li.row div.entry-cmd > ui-command-chip').first()).toBeVisible();

        for (const selector of SHELL) await expect(page.locator(selector), selector).toHaveCount(0);

        const g = await measureLayout(page);
        for (const o of g.overflow) expect(o.scrollWidth, `${o.name}: scrollWidth <= clientWidth`).toBeLessThanOrEqual(o.clientWidth);

        expect(g.rows.length).toBeGreaterThan(0);
        for (const row of g.rows) {
          for (const { name, rect } of row.parts) {
            const where = `${row.workspace}/${row.spec} ${name} inside div.entry`;
            expect(rect.left, where).toBeGreaterThanOrEqual(row.entry.left - INSIDE_SLACK);
            expect(rect.right, where).toBeLessThanOrEqual(row.entry.right + INSIDE_SLACK);
            expect(rect.top, where).toBeGreaterThanOrEqual(row.entry.top - INSIDE_SLACK);
            expect(rect.bottom, where).toBeLessThanOrEqual(row.entry.bottom + INSIDE_SLACK);
          }
        }

        // The stub's long row: its command on the chip, inside the row (above); at 360 px its title ends in an ellipsis.
        const long = g.rows.find((row) => row.workspace === STUB_STATUS_LONG.workspace && row.spec === STUB_STATUS_LONG.spec);
        expect(long, 'the long row STUB_STATUS_LONG').toBeDefined();
        if (!long) return;
        expect(long.command).toBe(STUB_STATUS_LONG.command);
        expect(long.parts.map((part) => part.name)).toContain('ui-command-chip');
        expect(long.title.textOverflow).toBe('ellipsis');
        info.annotations.push({ type: 'long-title', description: `${String(width)} ${theme}: ${String(long.title.scrollWidth)} / ${String(long.title.clientWidth)} px` });
        if (width === 360) expect(long.title.scrollWidth, 'the long title is cut with an ellipsis').toBeGreaterThan(long.title.clientWidth);
      });
    });
  }
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
