/**
 * Spec 038 · T28 · ISC-205: the Gantt lens (`/w/:ws/planning/gantt`) never scrolls the page sideways.
 *
 *   bun run test:browser -- gantt narrow
 *
 * Real Chromium against the stub API, at 600 and 390 px (both below 640, the compact tier, where the axis is squeezed
 * into the track width and never scrolls), with the detail sidebar closed and open (`?sel=`, the modal sheet), on
 * harbor (a late milestone in the past segment, one window ahead) and on lantern (no dated milestone: the hint instead
 * of an axis). Threshold: the page's `scrollWidth` equals its `clientWidth`, and the lens's own scroll container does
 * not overflow either; every lane's time cell ends inside the lens.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';

const WORKSPACES = [
  { ws: 'harbor', sel: 'feature:F2' },
  { ws: 'lantern', sel: 'feature:F1' },
] as const;

interface Overflow {
  readonly page: number;
  readonly lens: number;
  /** Lanes whose time cell ends right of the lens's own box. */
  readonly outside: readonly string[];
}

async function overflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const scroll = document.querySelector<HTMLElement>('app-planning-gantt [data-gantt-scroll]');
    const lens = document.querySelector<HTMLElement>('app-planning-gantt')?.getBoundingClientRect();
    const outside = [...document.querySelectorAll<HTMLElement>('app-planning-gantt button[data-lane]')]
      .filter((lane) => (lane.querySelector('[data-time]')?.getBoundingClientRect().right ?? 0) > (lens?.right ?? 0) + 0.5)
      .map((lane) => lane.dataset['ref'] ?? '');
    return { page: root.scrollWidth - root.clientWidth, lens: scroll === null ? 0 : scroll.scrollWidth - scroll.clientWidth, outside };
  });
}

for (const width of [WIDTHS.panel, WIDTHS.phone]) {
  test.describe(`gantt narrow at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const { ws, sel } of WORKSPACES) {
      for (const open of [false, true]) {
        test(`gantt narrow: ${ws}, sidebar ${open ? 'open' : 'closed'}: no horizontal overflow of the page or the axis`, async ({ page }) => {
          await page.goto(`/w/${ws}/planning/gantt${open ? `?sel=${sel}` : ''}`);
          await expect(page.locator('app-planning-gantt [data-gantt]')).toHaveAttribute('data-tier', 'compact');
          await expect(page.locator('app-planning-gantt button[data-lane]').first()).toBeVisible();
          const sidebar = page.locator('app-detail-sidebar[data-presentation]');
          if (open) await expect(sidebar).toHaveAttribute('data-presentation', 'sheet');
          else await expect(sidebar).toHaveCount(0);
          expect(await overflow(page)).toEqual({ page: 0, lens: 0, outside: [] });
        });
      }
    }
  });
}

test.describe('gantt narrow: the axis head', () => {
  test.use(atWidth(WIDTHS.phone));

  test('gantt narrow: at 390 the axis head stays on screen while the lanes scroll under it', async ({ page }) => {
    await page.setViewportSize({ width: WIDTHS.phone, height: 480 });
    await page.goto('/w/harbor/planning/gantt');
    const axis = page.locator('app-planning-gantt [data-axis]');
    await expect(axis).toBeVisible();
    await page.locator('app-planning-gantt button[data-lane]').last().scrollIntoViewIfNeeded();
    const box = await axis.boundingBox();
    expect(box, 'the axis has a box').not.toBeNull();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    expect((box?.y ?? Infinity) + (box?.height ?? 0)).toBeLessThanOrEqual(480);
  });
});
