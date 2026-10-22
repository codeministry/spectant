/**
 * Spec 066 · the overview's tiles align row by row on `/`, measured in real Chromium against the stub API under
 * `X-Spectant-Stub-Locks: working` (harbor 005, 006, 002 and 009 in work):
 *
 *   bun run test:browser -- overview-grid -g "rows align"   ISC-516, T9: at 1440 and 820 px, under
 *                                                           `X-Spectant-Stub-Waits` 0, 1 and 7 and once with five
 *                                                           workspaces holding 16, 0, 1, 3 and harbor's waiting
 *                                                           entries, every tile of a row has the same height, and its
 *                                                           head, preview, list and KPI blocks start at the same y
 *
 * Threshold: 1 px.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { LOCKS_HEADER, WAITS_HEADER, WAITS_STATES } from '../stub-api';
import { byRow, fiveWorkspaces, openOverview, ROW_TOLERANCE, spread, TILE_BLOCKS, tileMetrics } from './overview-grid.helpers';

/** Every row of tiles: one height, and each of the four blocks at one top. */
async function expectRowsAlign(page: Page, tiles: number): Promise<void> {
  const metrics = await tileMetrics(page);
  expect(metrics.length, 'tiles on the page').toBe(tiles);
  for (const tile of metrics) {
    for (const name of TILE_BLOCKS) expect(tile.blocks[name], `${tile.slug}: [data-tile-block="${name}"]`).not.toBeNull();
  }
  for (const [n, row] of byRow(metrics).entries()) {
    const where = `row ${String(n + 1)} (${row.map((t) => t.slug).join(', ')})`;
    expect(spread(row.map((t) => t.height)), `${where} heights ${JSON.stringify(row.map((t) => [t.slug, t.height]))}`).toBeLessThanOrEqual(ROW_TOLERANCE);
    for (const name of TILE_BLOCKS) {
      const tops = row.map((t) => t.blocks[name] ?? Number.NaN);
      expect(spread(tops), `${where} ${name} tops ${JSON.stringify(row.map((t) => [t.slug, t.blocks[name]]))}`).toBeLessThanOrEqual(ROW_TOLERANCE);
    }
  }
}

test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'working' } });

for (const width of [WIDTHS.desktop, WIDTHS.tablet]) {
  test.describe(`overview rows at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const waits of WAITS_STATES) {
      test(`rows align: Waits ${waits}, every tile of a row has one height and one top per block at ${String(width)} px (ISC-516)`, async ({ page }) => {
        await page.setExtraHTTPHeaders({ [LOCKS_HEADER]: 'working', [WAITS_HEADER]: waits });
        await openOverview(page);
        await expectRowsAlign(page, await page.locator('[data-ui="workspace-column"]').count());
      });
    }

    test(`rows align: five workspaces with 0, 1, 3 and 16 entries share heights and block tops per row at ${String(width)} px (ISC-516)`, async ({ page }) => {
      await fiveWorkspaces(page, { waits: [null, 16, 0, 1, 3], screenshots: [false, true, false, true, false] });
      await openOverview(page, 5);
      await expectRowsAlign(page, 5);
    });
  });
}
