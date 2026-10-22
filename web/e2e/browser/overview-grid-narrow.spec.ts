/**
 * Spec 066 · the overview's tiles keep their build at the narrow widths, measured in real Chromium against the stub API
 * under `X-Spectant-Stub-Locks: working` (harbor 005, 006, 002 and 009 in work):
 *
 *   bun run test:browser -- overview-grid -g "narrow"   ISC-521, T17: at 820 and 390 px with five workspaces the page
 *                                                       never scrolls sideways, every tile holds head → preview →
 *                                                       list → KPI in DOM and in visual order, 820 px sets two tiles
 *                                                       per row and 390 px one, and the KPI part is a 2 × 2 grid
 *
 * Threshold: `document.documentElement.scrollWidth` ≤ the viewport width.
 */
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { LOCKS_HEADER } from '../stub-api';
import { byRow, fiveWorkspaces, openOverview, TILE_BLOCKS, tileMetrics } from './overview-grid.helpers';

test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'working' } });

const CASES = [
  { width: WIDTHS.tablet, perRow: 2 },
  { width: WIDTHS.phone, perRow: 1 },
] as const;

for (const { width, perRow } of CASES) {
  test.describe(`overview narrow at ${String(width)}`, () => {
    test.use(atWidth(width));

    test.beforeEach(async ({ page }) => {
      await fiveWorkspaces(page, { waits: [null, 16, 0, 1, 3] });
      await openOverview(page, 5);
    });

    test(`narrow: the page does not scroll sideways at ${String(width)} px (ISC-521)`, async ({ page }) => {
      const { scrollWidth, innerWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
      }));
      expect(scrollWidth, `scrollWidth ${String(scrollWidth)} vs innerWidth ${String(innerWidth)}`).toBeLessThanOrEqual(innerWidth);
    });

    test(`narrow: every tile holds head, preview, list and KPI in DOM and visual order at ${String(width)} px (ISC-521)`, async ({ page }) => {
      const order = await page.evaluate((names) => {
        return [...document.querySelectorAll<HTMLElement>('[data-ui="workspace-column"]')].map((tile) => ({
          slug: tile.dataset['ws'] ?? '',
          dom: [...tile.querySelectorAll<HTMLElement>('[data-tile-block]')]
            .map((block) => block.dataset['tileBlock'] ?? '')
            .filter((name) => names.includes(name)),
        }));
      }, TILE_BLOCKS as readonly string[]);
      expect(order.length, 'tiles on the page').toBe(5);
      for (const tile of order) expect(tile.dom, `${tile.slug}: DOM order of [data-tile-block]`).toEqual([...TILE_BLOCKS]);

      for (const tile of await tileMetrics(page)) {
        const tops = TILE_BLOCKS.map((name) => tile.blocks[name]);
        for (const [i, name] of TILE_BLOCKS.entries()) expect(tops[i], `${tile.slug}: [data-tile-block="${name}"]`).not.toBeNull();
        for (let i = 1; i < tops.length; i++) {
          const where = `${tile.slug}: ${TILE_BLOCKS[i - 1] ?? ''} → ${TILE_BLOCKS[i] ?? ''} tops ${JSON.stringify(tops)}`;
          expect(tops[i] ?? Number.NaN, where).toBeGreaterThan(tops[i - 1] ?? Number.NaN);
        }
      }
    });

    test(`narrow: ${String(perRow)} tile(s) per row and the KPI part in grid layout at ${String(width)} px (ISC-521)`, async ({ page }) => {
      const rows = byRow(await tileMetrics(page));
      expect(rows.flat().length, 'tiles on the page').toBe(5);
      for (const [n, row] of rows.entries()) {
        const expected = Math.min(perRow, 5 - n * perRow);
        expect(row.length, `row ${String(n + 1)} (${row.map((t) => t.slug).join(', ')})`).toBe(expected);
      }
      const kpis = page.locator('[data-ui="workspace-column"] app-tile-kpis');
      await expect(kpis).toHaveCount(5);
      for (const kpi of await kpis.all()) await expect(kpi).toHaveAttribute('data-layout', 'grid');
    });
  });
}
