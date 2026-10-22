/**
 * Spec 066 · a workspace tile on `/` is as tall with no entry as with sixteen, measured in real Chromium against the stub
 * API under `X-Spectant-Stub-Locks: working` (harbor 005, 006, 002 and 009 in work):
 *
 *   bun run test:browser -- overview-grid -g "height fixed"   ISC-517, T13: five workspaces, harbor with four specs
 *                                                             in progress and nothing waiting, the copies with 0, 1, 3
 *                                                             and 16 waiting entries and none in progress; at 1440,
 *                                                             820 and 390 px every tile has the same height
 *
 * Threshold: 1 px. Each tile must carry the four blocks of the hook contract and none may still be loading, so the
 * measurement cannot pass on bare or skeleton tiles.
 */
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { LOCKS_HEADER } from '../stub-api';
import { fiveWorkspaces, FIVE_SLUGS, openOverview, ROW_TOLERANCE, spread, TILE_BLOCKS, tileMetrics } from './overview-grid.helpers';

/** Per workspace in list order: waiting entries and whether the specs in progress stay. */
const WAITS = [0, 0, 1, 3, 16] as const;
const WORKING = [true, false, false, false, false] as const;
/** The counters each tile must show, so the measured tiles are the shaped ones. */
const COUNTS: Readonly<Record<(typeof FIVE_SLUGS)[number], { readonly working: number; readonly waits: number }>> = {
  harbor: { working: 4, waits: 0 },
  'ws-a': { working: 0, waits: 0 },
  'ws-b': { working: 0, waits: 1 },
  'ws-c': { working: 0, waits: 3 },
  'ws-d': { working: 0, waits: 16 },
};

/** A counter's text holding `n` as a whole number (so 1 does not match 16). */
const countText = (n: number): RegExp => new RegExp(`(^|\\D)${String(n)}(\\D|$)`);

test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'working' } });

for (const width of [WIDTHS.desktop, WIDTHS.tablet, WIDTHS.phone]) {
  test.describe(`overview tile height at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`height fixed: tiles with 0, 1, 3 and 16 waiting and 4 in progress are equally tall at ${String(width)} px (ISC-517)`, async ({ page }) => {
      await fiveWorkspaces(page, { waits: WAITS, working: WORKING });
      await openOverview(page, FIVE_SLUGS.length);

      await expect(page.locator('[data-ui="workspace-column"][aria-busy="true"]'), 'tiles still loading').toHaveCount(0);
      for (const slug of FIVE_SLUGS) {
        const tile = page.locator(`[data-ui="workspace-column"][data-ws="${slug}"]`);
        for (const name of TILE_BLOCKS) await expect(tile.locator(`[data-tile-block="${name}"]`), `${slug}: [data-tile-block="${name}"]`).toHaveCount(1);
        await expect(tile.locator('[data-tile-count="working"]'), `${slug}: in progress`).toHaveText(countText(COUNTS[slug].working));
        await expect(tile.locator('[data-tile-count="waits"]'), `${slug}: waiting`).toHaveText(countText(COUNTS[slug].waits));
      }

      const metrics = await tileMetrics(page);
      expect(metrics.map((t) => t.slug).sort(), 'measured tiles').toEqual([...FIVE_SLUGS].sort());
      for (const tile of metrics) {
        for (const name of TILE_BLOCKS) expect(tile.blocks[name], `${tile.slug}: [data-tile-block="${name}"]`).not.toBeNull();
      }
      const heights = metrics.map((t) => [t.slug, t.height] as const);
      expect(spread(heights.map(([, h]) => h)), `tile heights ${JSON.stringify(heights)}`).toBeLessThanOrEqual(ROW_TOLERANCE);
    });
  });
}
