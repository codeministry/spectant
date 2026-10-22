/**
 * Spec 066 · two rows of the overview's tiles stand in a 1440 × 900 viewport, measured in real Chromium against the stub
 * API under `X-Spectant-Stub-Locks: working` (harbor 005, 006, 002 and 009 in work):
 *
 *   bun run test:browser -- overview-grid -g "two rows"   ISC-520, T16: five workspaces, one copy with 16 waiting
 *                                                         entries; at scroll 0 the tiles form a row of three and a
 *                                                         row of two, the bottom of every tile of row 2 is within the
 *                                                         viewport, and the KPI part of each tile sits in one row
 *
 * Threshold: the bottom of row 2 ≤ 900 px.
 */
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { LOCKS_HEADER } from '../stub-api';
import { byRow, fiveWorkspaces, openOverview, TILE_BLOCKS, tileMetrics } from './overview-grid.helpers';

const VIEWPORT_HEIGHT = 900;

test.use({ ...atWidth(WIDTHS.desktop), extraHTTPHeaders: { [LOCKS_HEADER]: 'working' } });

test.describe('overview two rows at 1440 × 900', () => {
  test.beforeEach(async ({ page }) => {
    await fiveWorkspaces(page, { waits: [null, 16, 0, 1, 3] });
    await openOverview(page, 5);
    await page.evaluate(() => window.scrollTo(0, 0));
  });

  test('two rows: the viewport is 1440 × 900 and the page is not scrolled (ISC-520)', async ({ page }) => {
    expect(page.viewportSize()).toEqual({ width: WIDTHS.desktop, height: VIEWPORT_HEIGHT });
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  });

  test('two rows: every tile carries the four blocks and its KPI part in row layout (ISC-520)', async ({ page }) => {
    const tiles = page.locator('[data-ui="workspace-column"]');
    await expect(tiles).toHaveCount(5);
    for (const tile of await tiles.all()) {
      const slug = (await tile.getAttribute('data-ws')) ?? '?';
      for (const name of TILE_BLOCKS) {
        await expect(tile.locator(`[data-tile-block="${name}"]`), `${slug}: [data-tile-block="${name}"]`).toHaveCount(1);
      }
      await expect(tile.locator('app-tile-kpis'), `${slug}: app-tile-kpis`).toHaveAttribute('data-layout', 'row');
    }
  });

  test('two rows: five tiles form a row of three and a row of two, the bottom of row 2 at most 900 px (ISC-520)', async ({ page }) => {
    const metrics = await tileMetrics(page);
    expect(metrics.length, 'tiles on the page').toBe(5);
    for (const tile of metrics) {
      for (const name of TILE_BLOCKS) expect(tile.blocks[name], `${tile.slug}: [data-tile-block="${name}"]`).not.toBeNull();
    }
    const rows = byRow(metrics);
    expect(rows.map((row) => row.map((t) => t.slug)), 'tiles per row').toHaveLength(2);
    expect(rows.map((row) => row.length), 'tiles per row').toEqual([3, 2]);
    expect(await page.evaluate(() => window.scrollY), 'no scroll').toBe(0);
    for (const row of rows) {
      for (const tile of row) {
        const bottom = tile.top + tile.height;
        expect(tile.top, `${tile.slug} top`).toBeGreaterThanOrEqual(0);
        expect(bottom, `${tile.slug} bottom ${String(bottom)}`).toBeLessThanOrEqual(VIEWPORT_HEIGHT);
      }
    }
  });
});
