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
 * - ISC-399 (T46, `-g "dashboard card rows (ISC-399)"`): at 390, 820 and 1440 px Waits on you, Next up and the warnings
 *   stand 8 px under their section headers (the warnings opened with `?open=warnings`, spec 064); Waits on you is three
 *   flat tiles 8 px apart without hairlines and the fold after them (spec 064); the warning groups stand in equal
 *   columns with an inner grid of hairlines, two from 640 px of shell and three from 1120 px, in one column below.
 * - ISC-464 (spec 064 T21, `-g "flat tile heights"`): under `X-Spectant-Stub-Locks: working` at 390, 820 and 1440 px
 *   every item of the Waits on you and the In progress list of the `[data-lists]` row holds one `ui-flat-tile`, all of
 *   one height per tier (72 px at 390, 48 px at 820 and 1440 where each list is at least 560 px wide); since ISC-507
 *   the two lists stand stacked at every tier, In progress directly below Waits on you, both the main column's width.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { LOCKS_HEADER } from '../stub-api';

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
async function dashboardReady(page: Page, ws = 'harbor', query = ''): Promise<void> {
  await page.goto(`/w/${ws}${query}`);
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

/**
 * The gap from a block's section header to its card, in CSS px. The warnings' header is the folding `h2` of its
 * section form (spec 064, T32), the others' a `ui-section-header`; the first of either in the block is the header.
 */
async function headerToCard(page: Page, block: string): Promise<number> {
  return page.locator(block).first().evaluate((el) => {
    const header = el.querySelector('ui-section-header, h2')?.getBoundingClientRect();
    const card = el.querySelector('ui-card')?.getBoundingClientRect();
    return (card?.top ?? NaN) - (header?.bottom ?? NaN);
  });
}

test.describe('dashboard card rows (ISC-399)', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`dashboard card rows (ISC-399): ${String(width)} px, Waits on you and warnings read like Next up`, async ({ page }) => {
        // The warnings fold by default (spec 064, T32); `?open=warnings` opens them, so their card is there to measure.
        await dashboardReady(page, 'harbor', '?open=warnings');
        await expect(page.locator('app-warnings-panel [data-warnings-toggle]')).toHaveAttribute('aria-expanded', 'true');
        // The header sits 8 px over its card in all three blocks.
        const nextGap = await headerToCard(page, 'app-next-up-list');
        expect(nextGap).toBeCloseTo(8, 0);
        expect(await headerToCard(page, 'app-waiting-section'), 'Waits on you: header to card').toBeCloseTo(nextGap, 0);
        expect(await headerToCard(page, 'app-warnings-panel'), 'Warnings: header to card').toBeCloseTo(nextGap, 0);

        // Waits on you (spec 064, T13): three flat tiles, 8 px apart without hairlines, the fold after the list. Their
        // shared height is ISC-464's (`-g "flat tile heights"`).
        const waits = await page.locator('#waiting').evaluate((section) => {
          const list = section.querySelector('ol.tiles');
          const items = [...(list?.querySelectorAll(':scope > li') ?? [])];
          const fold = section.querySelector('ui-disclosure[data-show-all]');
          return {
            tiles: items.map((li) => li.querySelectorAll(':scope > ui-flat-tile').length),
            lines: items.map((li) => getComputedStyle(li).borderTopWidth),
            gap: list ? getComputedStyle(list).rowGap : null,
            foldAfter: list !== null && fold !== null && (list.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
          };
        });
        expect(waits.tiles).toEqual([1, 1, 1]);
        expect(waits.lines).toEqual(['0px', '0px', '0px']);
        expect(waits.gap).toBe('8px');
        expect(waits.foldAfter).toBe(true);

        // Opened, the folded tiles continue the list 8 px after the last standing tile and "Show all n" moves under
        // the last of them.
        const toggle = page.locator('#waiting [data-show-all] button[aria-expanded]');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect
          .poll(() =>
            page.locator('#waiting').evaluate((section) => {
              const tiles = [...section.querySelectorAll('ol.tiles > li')].map((li) => li.getBoundingClientRect());
              const button = section.querySelector('[data-show-all] button[aria-expanded]')?.getBoundingClientRect();
              const gaps = tiles.slice(1).map((r, i) => Math.round(r.top - (tiles[i]?.bottom ?? r.top)));
              return { gaps, below: button !== undefined && button.top >= (tiles.at(-1)?.bottom ?? Infinity) };
            }),
          )
          .toEqual({ gaps: [8, 8, 8], below: true });

        // Warnings: equal columns from 640 px of shell (two, three from 1120 px) under one grid of hairlines that also
        // runs through the empty cells of a short last row; one column below.
        const groups = await page.locator('app-warnings-panel li.group').evaluateAll((items) =>
          items.map((li) => {
            const r = li.getBoundingClientRect();
            const style = getComputedStyle(li);
            return { left: r.left, top: r.top, width: r.width, topLine: style.borderTopWidth, sideLine: style.borderRightWidth, bottomLine: style.borderBottomWidth };
          }),
        );
        expect(groups.length).toBeGreaterThanOrEqual(3);
        const [first, second] = groups;
        if (width >= 640) {
          const columns = width >= 1120 ? 3 : 2;
          expect(second?.top).toBeCloseTo(first?.top ?? NaN, 0);
          expect(second?.left ?? 0).toBeGreaterThan((first?.left ?? 0) + 100);
          expect(Math.abs((second?.width ?? 0) - (first?.width ?? 0))).toBeLessThanOrEqual(1);
          if (columns === 3) expect(groups[2]?.top).toBeCloseTo(first?.top ?? NaN, 0);
          // Every group draws the line below it, none above or beside: the rows' lines reach the empty cells' tops.
          groups.forEach((g, i) => {
            expect(g.topLine, `group ${String(i + 1)}: no line above`).toBe('0px');
            expect(g.sideLine, `group ${String(i + 1)}: no own line beside`).toBe('0px');
            expect(g.bottomLine, `group ${String(i + 1)}: line below`).toBe('1px');
          });
          // The column lines are the list's background, one per inner boundary, over the list's whole height down to
          // the card's bottom edge, so an empty cell of the last row is framed like a filled one.
          const list = await page.locator('app-warnings-panel ul.groups').evaluate((ul) => {
            const card = ul.closest('ui-card');
            return {
              gradients: (getComputedStyle(ul).backgroundImage.match(/linear-gradient/g) ?? []).length,
              listBottom: Math.round(ul.getBoundingClientRect().bottom),
              cardBottom: Math.round(card?.getBoundingClientRect().bottom ?? 0),
            };
          });
          expect(list.gradients, 'one column line per inner boundary').toBe(columns - 1);
          expect(list.listBottom, 'the list reaches the card bottom').toBeGreaterThanOrEqual(list.cardBottom - 1);
        } else {
          expect(second?.left).toBeCloseTo(first?.left ?? NaN, 0);
          expect(second?.top ?? 0).toBeGreaterThan(first?.top ?? 0);
          groups.forEach((g, i) => {
            expect(g.topLine).toBe(i === 0 ? '0px' : '1px');
            expect(g.sideLine).toBe('0px');
          });
        }
      });
    });
  }
});

/**
 * The tile heights per tier (spec 064, `TILE_HEIGHT_STACKED` and `TILE_HEIGHT_LINE` in shared/ui/guidance/tiles.ts):
 * `stacked` in a list narrower than `TILE_DENSITY_MIN` (560 px), `line` from there on.
 */
const TILE_HEIGHT = { stacked: 72, line: 48 } as const;
const TILE_DENSITY_MIN = 560;

/** Per list of the dashboard's `[data-lists]` row: its box, and per item the tags inside it and the tile's height. */
async function tileLists(page: Page): Promise<Array<{ list: string; box: Box; items: Array<{ tiles: string[]; height: number }> }>> {
  return page.locator('app-dashboard-page [data-lists]').evaluate((row) => {
    const box = (el: Element): Box => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width };
    };
    return [...row.children].map((block) => ({
      list: block.tagName.toLowerCase(),
      box: box(block),
      // Only the tiles on screen: the waits' folded rest stands in a closed disclosure.
      items: [...block.querySelectorAll('ol.tiles > li')]
        .filter((li) => li.getBoundingClientRect().height > 0)
        .map((li) => ({
          tiles: [...li.children].map((c) => c.tagName.toLowerCase()),
          height: li.querySelector('ui-flat-tile')?.getBoundingClientRect().height ?? NaN,
        })),
    }));
  });
}

test.describe('flat tile heights (ISC-464)', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use({ ...atWidth(width), extraHTTPHeaders: { [LOCKS_HEADER]: 'working' } });

      test(`flat tile heights (ISC-464): ${String(width)} px, Waits on you and In progress share one tile of one height, stacked`, async ({ page }) => {
        await dashboardReady(page);
        await expect(page.locator('[data-lists] ui-working-block ui-flat-tile')).toHaveCount(3);
        const lists = await tileLists(page);
        expect(lists.map((l) => l.list)).toEqual(['app-waiting-section', 'ui-working-block']);
        const [waits, working] = lists;
        expect(waits?.items.length ?? 0, 'waits tiles on screen').toBeGreaterThanOrEqual(1);
        expect(working?.items).toHaveLength(3);

        // One component: every item of both lists holds exactly one `ui-flat-tile` and nothing else.
        for (const l of lists) for (const item of l.items) expect(item.tiles, `${l.list}: one flat tile per item`).toEqual(['ui-flat-tile']);

        // One height per tier, 0 px apart across both lists: `line` where the list is 560 px or wider, `stacked` below.
        const wide = width >= WIDTHS.tablet;
        for (const l of lists) expect(l.box.width >= TILE_DENSITY_MIN, `${l.list}: ${String(l.box.width)} px wide`).toBe(wide);
        const expected = wide ? TILE_HEIGHT.line : TILE_HEIGHT.stacked;
        const heights = lists.flatMap((l) => l.items.map((i) => i.height));
        expect(new Set(heights), `tile heights at ${String(width)} px`).toEqual(new Set([expected]));

        // Stacked at every tier (ISC-507): In progress directly below Waits on you, both as wide as the main column.
        const [a, b] = [waits?.box, working?.box];
        const column = await page.locator('app-dashboard-page').evaluate((host) => host.getBoundingClientRect().width);
        expect(b?.top ?? 0, 'In progress below Waits on you').toBeGreaterThanOrEqual(a?.bottom ?? Infinity);
        expect(b?.left, 'same left edge').toBe(a?.left);
        expect(b?.width, 'same width').toBe(a?.width);
        expect(a?.width ?? 0, 'the main column wide').toBeCloseTo(column, 0);
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
      const all = [...selectors, 'app-spec-table', 'li[data-ideas-group]', '#waiting', '#warnings', '[data-footer-note]'];
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
