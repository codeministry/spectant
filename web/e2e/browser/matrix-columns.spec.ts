/**
 * Spec 064 · T65 · ISC-506: in a spec's Matrix (`/w/<ws>/s/<id>/matrix`) the Lane column has the same width in every
 * row, and every frame column starts at the same x in every row, at 390, 820 and 1440 px and whatever the lane names.
 *
 *   bun run test:browser -- matrix-columns -g "lane column"
 *
 * Real Chromium against the stub API on `/w/harbor/s/002/matrix`. For each row of the grid (the header row and every
 * task row of every lane group) it measures the Lane cell's width and the left edge of each frame column (the n-th
 * frame header against the n-th frame cell of each row). Threshold: a spread of at most 1 px across rows.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test } from '../fixtures';

const MATRIX = '/w/harbor/s/002/matrix';
const WIDTHS = [390, 820, 1440];
const TOLERANCE = 1;

interface RowBox {
  readonly row: string;
  /** The Lane cell's width. */
  readonly lane: number;
  /** The left edge of each frame column, in column order. */
  readonly frames: readonly number[];
}

/** Every row of the grid: the header row first, then each task row of each lane group. */
async function measure(page: Page): Promise<RowBox[]> {
  return page.locator('table[data-matrix]').evaluate((table) => {
    const rows = [...table.querySelectorAll<HTMLTableRowElement>(':scope > thead > tr, :scope > tbody > tr')];
    return rows.map((tr) => {
      const cells = [...tr.children] as HTMLElement[];
      // The Lane cell is the fourth cell of every row (Task, Claim, lane marker, Lane); the frames follow it.
      const lane = cells[3]?.getBoundingClientRect().width ?? -1;
      const frames = cells.slice(4).map((cell) => cell.getBoundingClientRect().left);
      return { row: tr.getAttribute('data-row') ?? 'head', lane, frames };
    });
  });
}

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);

for (const width of WIDTHS) {
  test.describe(`matrix at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`lane column: equal Lane width and aligned frame columns in every row at ${String(width)}`, async ({ page }) => {
      await page.goto(MATRIX);
      await expect(page.locator('table[data-matrix] tbody tr').first()).toBeVisible();
      const rows = await measure(page);
      expect(rows.length).toBeGreaterThan(2);
      expect(new Set(rows.map((row) => row.frames.length)).size, 'every row has the same number of frame columns').toBe(1);

      const laneSpread = spread(rows.map((row) => row.lane));
      expect(laneSpread, `Lane widths ${JSON.stringify(rows.map((row) => [row.row, row.lane]))}`).toBeLessThanOrEqual(TOLERANCE);

      const columns = rows[0]?.frames.length ?? 0;
      expect(columns).toBeGreaterThan(0);
      for (let i = 0; i < columns; i++) {
        const edges = rows.map((row) => row.frames[i] ?? Number.NaN);
        expect(spread(edges), `frame column ${String(i)} left edges ${JSON.stringify(edges)}`).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  });
}
