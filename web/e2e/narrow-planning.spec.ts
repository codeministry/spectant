/**
 * T38 · ISC-103.1: the planning tree (spec 026 retired the Features and Milestones pages) in a narrow container. `bun run e2e -- narrow-planning` is the
 * claim's probe. At the 600 px cmux panel (and the 390 phone for good measure), on harbor (rows) and lantern (the
 * Features rows and the absent Milestones page):
 *
 * - the page has no horizontal overflow: `document.scrollingElement.scrollWidth === clientWidth`;
 * - nothing on the page is wider than the viewport: every card, chip row, chip and meter ends inside it;
 * - no element on the page is a horizontal scroll container with content past its box.
 *
 * The chip rows wrap (`flex-wrap`) rather than scroll, and the card grids use `minmax(0, 1fr)`; this file proves
 * both hold with the real fixture names and counts.
 *
 * The second block below is spec 026's ISC-171.2: all three planning lenses with the detail sidebar closed and open.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, pinClock, test, WIDTHS } from './fixtures';

const PAGES = [
  { name: 'harbor planning tree', url: '/w/harbor/planning/tree', host: 'app-planning-page' },
  { name: 'lantern planning tree (no milestones)', url: '/w/lantern/planning/tree', host: 'app-planning-page' },
] as const;

interface Layout {
  readonly scroll: number;
  readonly client: number;
  readonly viewport: number;
  /** Elements whose right edge lies past the viewport, as `tag.class` with the overshoot. */
  readonly wide: readonly string[];
  /** Horizontal scroll containers with content past their box. */
  readonly scrollers: readonly string[];
}

async function layout(page: Page, host: string): Promise<Layout> {
  return page.evaluate((selector) => {
    const root = document.scrollingElement ?? document.documentElement;
    const viewport = window.innerWidth;
    const scrolls = (value: string): boolean => value === 'auto' || value === 'scroll';
    const name = (el: Element): string => {
      const first = typeof el.className === 'string' ? (el.className.split(' ')[0] ?? '') : '';
      return first === '' ? el.tagName.toLowerCase() : `${el.tagName.toLowerCase()}.${first}`;
    };
    const wide: string[] = [];
    const scrollers: string[] = [];
    const page = document.querySelector<HTMLElement>(selector);
    for (const el of page ? [page, ...page.querySelectorAll<HTMLElement>('*')] : []) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.right > viewport + 0.5) wide.push(`${name(el)} +${Math.round(rect.right - viewport)}`);
      const style = getComputedStyle(el);
      if (scrolls(style.overflowX) && el.scrollWidth > el.clientWidth) scrollers.push(name(el));
    }
    return { scroll: root.scrollWidth, client: root.clientWidth, viewport, wide, scrollers };
  }, host);
}

for (const width of [WIDTHS.panel, WIDTHS.phone]) {
  test.describe(`planning pages at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const target of PAGES) {
      test(`${target.name}: no horizontal overflow, nothing past the viewport`, async ({ page }) => {
        await pinClock(page);
        await page.goto(target.url);
        const host = page.locator(target.host);
        await expect(host).toBeVisible();
        await expect(host.locator('[role="treeitem"]').first()).toBeVisible();

        const result = await layout(page, target.host);
        expect(result.viewport).toBe(width);
        expect(result.scroll).toBe(result.client);
        expect(result.wide).toEqual([]);
        expect(result.scrollers).toEqual([]);
      });
    }
  });
}

/*
 * T33 · ISC-171.2 (spec 026): the three lenses — tree, matrix (`/planning/board`) and diagram (`/planning/graph`) — at
 * 600 and 390, with the detail sidebar closed and open (`?sel=`), on harbor and on lantern (no milestones). The page
 * never scrolls sideways: `document.scrollingElement.scrollWidth === clientWidth`. The matrix may scroll inside its own
 * container; only the page must not overflow. The open sidebar lies over the view: 600 and 390 are both below 640,
 * the compact tier, where the decided overlay form is the modal bottom sheet (design.md § Across viewports:
 * "640 bis 1119 px nicht-modales Overlay … unter 640 px modales Bottom-Sheet"; "ISC-171.2 prüft 600 (fällt unter das
 * Sheet) und 390"); its panel ends inside the viewport.
 */
const LENSES = [
  { lens: 'tree', host: 'app-planning-tree' },
  { lens: 'board', host: 'app-planning-matrix' },
  { lens: 'graph', host: 'app-planning-graph' },
] as const;
const WORKSPACES = [
  { ws: 'harbor', sel: 'spec:002' },
  { ws: 'lantern', sel: 'spec:002' },
] as const;
const PRESENTATION: Readonly<Record<number, 'overlay' | 'sheet'>> = { [WIDTHS.panel]: 'sheet', [WIDTHS.phone]: 'sheet' };

async function pageOverflow(page: Page): Promise<{ scroll: number; client: number }> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    return { scroll: root.scrollWidth, client: root.clientWidth };
  });
}

for (const width of [WIDTHS.panel, WIDTHS.phone]) {
  test.describe(`planning lenses at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const { ws, sel } of WORKSPACES) {
      for (const { lens, host } of LENSES) {
        for (const open of [false, true]) {
          test(`${ws} ${lens} lens, sidebar ${open ? 'open' : 'closed'}: no horizontal page overflow`, async ({ page }) => {
            await pinClock(page);
            await page.goto(`/w/${ws}/planning/${lens}${open ? `?sel=${sel}` : ''}`);
            await expect(page.locator(host)).toBeVisible();
            const sidebar = page.locator('app-detail-sidebar[data-presentation]');
            if (open) {
              const presentation = PRESENTATION[width];
              await expect(sidebar).toHaveAttribute('data-presentation', presentation ?? '');
              await expect(sidebar.locator('[data-part="title"]')).toBeVisible();
              const panel = sidebar.locator('.panel');
              if (presentation === 'overlay') {
                await expect(sidebar.locator('dialog')).toHaveCount(0);
                expect(await panel.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
              } else {
                expect(await sidebar.locator('dialog').evaluate((d) => d.matches(':modal'))).toBe(true);
              }
              const box = await panel.boundingBox();
              expect(box, 'the sidebar panel has a box').not.toBeNull();
              expect(box?.x ?? -1).toBeGreaterThanOrEqual(0);
              expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(width + 0.5);
            } else {
              await expect(sidebar).toHaveCount(0);
            }

            const result = await pageOverflow(page);
            expect(result.scroll, 'document scrollWidth == clientWidth').toBe(result.client);
          });
        }
      }
    }
  });
}
