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
