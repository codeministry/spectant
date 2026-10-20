/**
 * Spec 058 · T33–T35: the workspace splits into the dashboard (`/w/:ws`) and the spec list (`/w/:ws/specs`).
 *
 *   bun run test:browser -- workspace-split
 *   bun run test:browser -- workspace-split -g "specs list width (ISC-393)"
 *   bun run test:browser -- workspace-split -g "dashboard one column (ISC-392)"
 *   bun run test:browser -- workspace-split -g "no rail anti (ISC-398)"
 *
 * Real Chromium against the stub API, measured with real layout:
 *
 * - ISC-393 (T33): at 1440 px the spec list (`app-spec-table`) is as wide as the main column's content box, both
 *   without a selection (no rail column, the main column spans the shell body) and with `?sel=spec:002`, where the
 *   detail sidebar of that spec docks into the rail slot right of the list.
 * - ISC-392 (T34): at 390, 820 and 1440 px the dashboard draws no rail, and its blocks stand in one column in the order
 *   KPI band, TL;DR, Waits on you, Next up, warnings: in the DOM and visually, each block below the one before.
 * - ISC-398 (T35, anti): at 1440 px neither the dashboard nor the spec list without a selection draws a rail or a rail
 *   slot, no block stands in an `aside`, and no block appears twice on a page.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';

/** The dashboard's blocks in their binding order (spec 058, design.md § Across viewports). */
const BLOCKS = ['app-kpi-band', 'app-brief', 'app-waiting-section', 'app-next-up-list', 'app-warnings-panel'] as const;

/** Every element the shell draws for a rail column: the aside itself and the slot that fills it. */
const RAIL = 'aside.shell-rail, [data-slot="rail"]';

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
}

/** The main column's content box and the spec list's box, in CSS px. */
async function listAndMain(page: Page): Promise<{ main: Box; body: Box; list: Box }> {
  return page.evaluate(() => {
    const box = (el: Element | null): Box => {
      const r = el?.getBoundingClientRect();
      return { left: r?.left ?? 0, right: r?.right ?? 0, top: r?.top ?? 0, bottom: r?.bottom ?? 0, width: r?.width ?? 0 };
    };
    const contentBox = (el: HTMLElement | null): Box => {
      const outer = box(el);
      if (el === null) return outer;
      const style = getComputedStyle(el);
      const left = outer.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft);
      const right = outer.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight);
      return { left, right, top: outer.top, bottom: outer.bottom, width: right - left };
    };
    return {
      main: contentBox(document.querySelector<HTMLElement>('main#main')),
      body: contentBox(document.querySelector<HTMLElement>('.shell-body')),
      list: box(document.querySelector('app-specs-page app-spec-table')),
    };
  });
}

/** Per block of `BLOCKS`: how many there are, the DOM index of the first, its visual box. */
async function blockLayout(page: Page): Promise<Array<{ count: number; domIndex: number; box: Box }>> {
  return page.evaluate((selectors) => {
    const all = [...document.querySelectorAll(selectors.join(', '))];
    return selectors.map((selector) => {
      const found = document.querySelectorAll(selector);
      const first = found[0];
      const r = first?.getBoundingClientRect();
      return {
        count: found.length,
        domIndex: first === undefined ? -1 : all.indexOf(first),
        box: { left: r?.left ?? 0, right: r?.right ?? 0, top: r?.top ?? 0, bottom: r?.bottom ?? 0, width: r?.width ?? 0 },
      };
    });
  }, [...BLOCKS]);
}

/** Wait until the dashboard has rendered its model (the skeletons gave way to the blocks). */
async function dashboardReady(page: Page, ws = 'harbor'): Promise<void> {
  await page.goto(`/w/${ws}`);
  await expect(page.locator('app-dashboard-page app-kpi-band')).toHaveCount(1);
  await expect(page.locator('app-dashboard-page app-warnings-panel')).toHaveCount(1);
  await expect(page.locator('app-dashboard-page [data-skeleton]')).toHaveCount(0);
}

/** Wait until the spec list has rendered its rows. */
async function specsReady(page: Page, query = ''): Promise<void> {
  await page.goto(`/w/harbor/specs${query}`);
  await expect(page.locator('app-specs-page app-spec-table')).toHaveCount(1);
  await expect(page.locator('app-specs-page [data-spec-row]').first()).toBeVisible();
}

test.describe('specs list width (ISC-393)', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('specs list width (ISC-393): without a selection the list spans the main column, no rail', async ({ page }) => {
    await specsReady(page);
    await expect(page.locator('app-shell')).toHaveAttribute('data-no-rail', '');
    await expect(page.locator(RAIL)).toHaveCount(0);
    await expect(page.locator('app-detail-sidebar[data-presentation]')).toHaveCount(0);
    const { main, body, list } = await listAndMain(page);
    expect(main.width).toBeGreaterThan(0);
    // The list fills the main column's content box, and the main column fills the shell body: nothing beside it.
    expect(Math.abs(list.width - main.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(list.left - main.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(main.width - body.width)).toBeLessThanOrEqual(1);
  });

  test('specs list width (ISC-393): with ?sel=spec:002 the detail sidebar docks right of the list', async ({ page }) => {
    await specsReady(page, '?sel=spec:002');
    await expect(page.locator('app-shell')).not.toHaveAttribute('data-no-rail', '');
    const docked = page.locator('aside.shell-rail [data-slot="rail"] app-detail-sidebar[data-presentation="docked"]');
    await expect(docked).toBeVisible();
    await expect(page.locator('app-detail-sidebar[data-presentation]')).toHaveCount(1);
    const { main, list } = await listAndMain(page);
    const rail = await docked.boundingBox();
    expect(rail).not.toBeNull();
    // The list still takes its whole (now narrower) column; the docked sidebar stands to its right.
    expect(Math.abs(list.width - main.width)).toBeLessThanOrEqual(1);
    expect(rail?.x ?? 0).toBeGreaterThanOrEqual(list.right - 0.5);
    expect(rail?.width ?? 0).toBeGreaterThan(0);
  });
});

test.describe('dashboard one column (ISC-392)', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`dashboard one column (ISC-392): ${String(width)} px, no rail, KPI · TL;DR · Waits · Next up · warnings`, async ({ page }) => {
        await dashboardReady(page);
        await expect(page.locator('app-shell')).toHaveAttribute('data-no-rail', '');
        await expect(page.locator(RAIL)).toHaveCount(0);
        const blocks = await blockLayout(page);
        // Each block once, in the binding DOM order.
        expect(blocks.map((b) => b.count)).toEqual(BLOCKS.map(() => 1));
        expect(blocks.map((b) => b.domIndex)).toEqual(BLOCKS.map((_, i) => i));
        // Visually one column: each block starts below the bottom of the one before.
        for (let i = 1; i < blocks.length; i++) {
          const [prev, next] = [blocks[i - 1]?.box, blocks[i]?.box];
          expect(next?.top ?? 0, `${BLOCKS[i] ?? ''} below ${BLOCKS[i - 1] ?? ''}`).toBeGreaterThanOrEqual((prev?.bottom ?? 0) - 0.5);
          expect(next?.top ?? 0).toBeGreaterThan(prev?.top ?? 0);
        }
      });
    });
  }
});

test.describe('no rail anti (ISC-398)', () => {
  test.use(atWidth(WIDTHS.desktop));

  /** No rail, no slot, no block inside an `aside`, every block at most once (the dashboard's blocks exactly once). */
  async function noRailNoDouble(page: Page, dashboard: boolean): Promise<void> {
    await expect(page.locator(RAIL)).toHaveCount(0);
    const counts = await page.evaluate((selectors) => {
      const all = [...selectors, 'app-spec-table', 'app-ideas-panel', '#waiting', '#warnings', '[data-footer-note]'];
      return {
        perBlock: Object.fromEntries(all.map((s) => [s, document.querySelectorAll(s).length])),
        inAside: selectors.filter((s) => [...document.querySelectorAll(s)].some((el) => el.closest('aside') !== null)),
      };
    }, [...BLOCKS]);
    expect(counts.inAside).toEqual([]);
    for (const [selector, n] of Object.entries(counts.perBlock)) expect(n, `${selector} at most once`).toBeLessThanOrEqual(1);
    if (dashboard) for (const selector of BLOCKS) expect(counts.perBlock[selector], `${selector} on the dashboard`).toBe(1);
    else expect(counts.perBlock['app-spec-table']).toBe(1);
  }

  test('no rail anti (ISC-398): the dashboard at 1440 has no rail and no block twice', async ({ page }) => {
    await dashboardReady(page);
    await noRailNoDouble(page, true);
  });

  test('no rail anti (ISC-398): the spec list without a selection at 1440 has no rail and no block twice', async ({ page }) => {
    await specsReady(page);
    await noRailNoDouble(page, false);
  });
});
