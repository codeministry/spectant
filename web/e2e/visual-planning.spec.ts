/**
 * The planning view's visual baselines (spec 026, ISC-172; spec 038, ISC-207): the three lenses of
 * `/w/harbor/planning/:lens` — tree, Gantt (`gantt`, where the Matrix stood) and diagram (`graph`) — each with the
 * detail sidebar closed and open (`?sel=`: a feature on the tree and on the Gantt lens, a milestone on the diagram), at
 * 390, 820 and 1440, light and dark. 18 baselines per theme. They replace the retired Features and Milestones pages'
 * baselines; both old addresses now redirect here, as the Matrix's `/planning/board` does to the Gantt lens.
 *
 *   bun run test:visual -- planning                  light, 18 baselines
 *   bun run test:visual -- planning --theme dark     dark, 18 baselines
 *   bun run test:visual -- planning-gantt            the Gantt lens's 6 (ISC-207)
 *
 * The dark theme is shot at every width here, unlike the smoke set (`visual.spec.ts`): the sidebar changes form per
 * tier (sheet below 640, overlay up to 1119, docked or floating at 1440), and each form has its own surfaces.
 *
 * Baselines live under `__screenshots__/chromium/{light,dark}/visual-planning.spec.ts/` and are recorded only in the
 * pinned linux/arm64 container (`bun run test:visual:ci -- planning -u`). The clock is pinned by the fixtures
 * (FIXED_NOW), the suite runs with reduced motion and disabled animations (the sidebar's slide-in never shows), and
 * each test runs in its own stub session, reset first. A closed view is shot full page; an open one at the viewport,
 * since the sheet and the overlay are fixed to it.
 */
import type { Page } from '@playwright/test';

import { atWidth, expect, FIXED_NOW, test, theme, WIDTHS } from './fixtures';

const SESSION = 'X-Spectant-Stub-Session';

interface Lens {
  readonly lens: 'tree' | 'gantt' | 'graph';
  /** The test title's prefix; `planning-gantt` names the Gantt group for `-g` (spec 038, ISC-207's probe). */
  readonly title: string;
  /** The object the open sidebar shows. */
  readonly sel: string;
  /** The sidebar's form at 1440: docked in the rail of the tree and the Gantt lens, floating over the diagram. */
  readonly wide: 'docked' | 'floating';
  /** The lens's host element inside `app-planning-page`. */
  readonly host: string;
  /** What must be drawn beyond the host before the capture. */
  readonly drawn: (page: Page, lens: Lens) => Promise<void>;
}

const LENSES: readonly Lens[] = [
  {
    lens: 'tree',
    title: 'planning tree',
    sel: 'feature:F2',
    wide: 'docked',
    host: 'app-planning-tree',
    drawn: (page) => expect(page.locator('app-planning-tree [role="treeitem"]').first()).toBeVisible(),
  },
  {
    lens: 'gantt',
    title: 'planning-gantt',
    sel: 'feature:F2',
    wide: 'docked',
    host: 'app-planning-gantt',
    drawn: (page) => expect(page.locator('app-planning-gantt button[data-lane]').first()).toBeVisible(),
  },
  {
    lens: 'graph',
    title: 'planning graph',
    sel: 'milestone:harbor-0-9',
    wide: 'floating',
    host: 'app-planning-graph',
    // Mermaid draws after the model arrives: the drawing notice is gone and the selectable node carries its ref.
    drawn: async (page, lens) => {
      await expect(page.locator('app-planning-graph [data-graph-status]')).toHaveCount(0);
      await expect(page.locator(`app-planning-graph [data-graph-frame] svg g.node[data-ref="${lens.sel}"]`)).toBeVisible();
    },
  },
];

const WIDTH_LIST = [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop] as const;

/** The sidebar's form per width (`presentationFor`): compact → sheet, medium → overlay, wide → the lens's own. */
function presentation(lens: Lens, width: number): string {
  if (width < 640) return 'sheet';
  if (width < 1120) return 'overlay';
  return lens.wide;
}

/** Network quiet, the lens drawn, the sidebar in its form (or absent), fonts loaded, the theme asked for, the clock frozen. */
async function settle(page: Page, lens: Lens, width: number, open: boolean): Promise<void> {
  await page.waitForLoadState('networkidle');
  await expect(page.locator('app-planning-page')).toBeVisible();
  await expect(page.locator(lens.host)).toBeVisible();
  await lens.drawn(page, lens);
  const sidebar = page.locator('app-detail-sidebar[data-presentation]');
  if (open) {
    await expect(sidebar).toHaveAttribute('data-presentation', presentation(lens, width));
    await expect(sidebar.locator('[data-part="title"]')).toBeVisible();
  } else {
    await expect(sidebar).toHaveCount(0);
  }
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme === 'dark' ? 'spec-dark' : 'spec-light');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // A relative time that moved would break the baseline, so prove the clock is frozen.
  expect(await page.evaluate(() => Date.now())).toBe(Date.parse(FIXED_NOW));
}

test.describe('planning', () => {
  for (const lens of LENSES) {
    for (const width of WIDTH_LIST) {
      test.describe(`${lens.lens} at ${String(width)}`, () => {
        test.use(atWidth(width));

        for (const open of [false, true]) {
          const state = open ? 'sidebar' : 'closed';
          test(`${lens.title} ${state} ${String(width)}`, async ({ page, request }, info) => {
            const session = `visual-planning-${info.testId}-${String(info.retry)}`;
            await page.setExtraHTTPHeaders({ [SESSION]: session });
            const reset = await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
            expect(reset.status()).toBe(204);
            await page.goto(`/w/harbor/planning/${lens.lens}${open ? `?sel=${lens.sel}` : ''}`);
            await settle(page, lens, width, open);
            await expect(page).toHaveScreenshot(`planning-${lens.lens}-${state}-${String(width)}.png`, {
              fullPage: !open,
              maxDiffPixelRatio: 0,
            });
          });
        }
      });
    }
  }
});
