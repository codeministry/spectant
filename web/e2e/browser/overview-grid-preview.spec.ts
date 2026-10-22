/**
 * Spec 066 · the preview of every workspace tile on `/` has one compact height, with or without a screenshot, measured
 * in real Chromium against the stub API:
 *
 *   bun run test:browser -- overview-grid -g "preview"   ISC-519, T15: five workspaces, ws-a and ws-c with a stored
 *                                                        screenshot, harbor, ws-b and ws-d without; at 1440 and 820 px
 *                                                        every `[data-tile-block="preview"]` has the same height, and a
 *                                                        tile without a screenshot shows the neutral placeholder of
 *                                                        `ui-ws-cover[data-shape="tile"]`: the badge in the workspace's
 *                                                        accent, no svg (the old ring and dot), no surface or edge
 *                                                        around it in an accent or its tint
 *
 * Threshold: 1 px.
 */
import type { Locator } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { fiveWorkspaces, FIVE_SLUGS, openOverview, ROW_TOLERANCE, spread } from './overview-grid.helpers';

/** Which of the five carry a screenshot, in list order (harbor, ws-a … ws-d). */
const SHOTS = [false, true, false, true, false] as const;

/** The accent marks a workspace can take (`WS_ACCENT_TOKENS`), and the tints the old cover and badge drew from them. */
const ACCENT_MARKS = ['--teal', '--color-primary', '--color-accent', '--color-secondary', '--color-warning', '--conc'] as const;
const TINTS = ['var(MARK)', 'color-mix(in oklab, var(MARK) 12%, var(--color-base-100))', 'color-mix(in oklab, var(MARK) 22%, transparent)', 'color-mix(in oklab, var(MARK) 45%, transparent)'] as const;

/** The cover and every element of its placeholder whose background or border is an accent or one of its tints. */
async function accentTinted(cover: Locator): Promise<string[]> {
  return cover.evaluate(
    (host, { marks, tints }) => {
      const resolved = new Set<string>();
      for (const mark of marks) {
        for (const tint of tints) {
          const probe = document.createElement('i');
          probe.style.background = tint.replace('MARK', mark);
          document.body.append(probe);
          resolved.add(getComputedStyle(probe).backgroundColor);
          probe.remove();
        }
      }
      resolved.delete('rgba(0, 0, 0, 0)');
      const placeholder = host.querySelector('[data-cover-placeholder]');
      // The badge carries the workspace's accent (as beside its name); the surface around it stays neutral.
      const around = placeholder === null ? [] : [...placeholder.querySelectorAll('*')].filter((el) => el.closest('ui-ws-badge') === null);
      const all = [host, ...(placeholder === null ? [] : [placeholder, ...around])];
      return all.flatMap((el) => {
        const s = getComputedStyle(el);
        const hits = [s.backgroundColor, s.borderTopColor, s.borderRightColor, s.borderBottomColor, s.borderLeftColor].filter((c) => resolved.has(c));
        return hits.length === 0 ? [] : [`${el.tagName.toLowerCase()}: ${hits.join(', ')}`];
      });
    },
    { marks: ACCENT_MARKS, tints: TINTS },
  );
}

for (const width of [WIDTHS.desktop, WIDTHS.tablet]) {
  test.describe(`overview tile preview at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`preview: one height with and without a screenshot, a neutral placeholder without at ${String(width)} px (ISC-519)`, async ({ page }) => {
      await fiveWorkspaces(page, { screenshots: SHOTS });
      await openOverview(page, FIVE_SLUGS.length);

      const previews = page.locator('[data-ui="workspace-column"] [data-tile-block="preview"]');
      await expect(previews, 'one preview block per tile').toHaveCount(FIVE_SLUGS.length);

      for (const [i, slug] of FIVE_SLUGS.entries()) {
        const tile = page.locator(`[data-ui="workspace-column"][data-ws="${slug}"]`);
        const cover = tile.locator('ui-ws-cover[data-shape="tile"]');
        await expect(cover, `${slug}: tile-shape cover`).toHaveCount(1);
        if (SHOTS[i] === true) {
          await expect(cover.locator('img'), `${slug}: screenshot`).toHaveCount(1);
          continue;
        }
        const placeholder = cover.locator('[data-cover-placeholder]');
        await expect(placeholder, `${slug}: placeholder`).toHaveCount(1);
        await expect(placeholder.locator('ui-ws-badge'), `${slug}: badge in the placeholder`).toHaveCount(1);
        await expect(placeholder.locator('ui-ws-badge'), `${slug}: badge in the accent`).toHaveAttribute('data-tone', 'accent');
        await expect(placeholder.locator('svg'), `${slug}: ring or dot in the placeholder`).toHaveCount(0);
        expect(await accentTinted(cover), `${slug}: accent-tinted elements`).toEqual([]);
      }

      const heights = await previews.evaluateAll((blocks) =>
        blocks.map((block) => [block.closest<HTMLElement>('[data-ui="workspace-column"]')?.dataset['ws'] ?? '', block.getBoundingClientRect().height] as const),
      );
      expect(spread(heights.map(([, h]) => h)), `preview heights ${JSON.stringify(heights)}`).toBeLessThanOrEqual(ROW_TOLERANCE);
    });
  });
}
