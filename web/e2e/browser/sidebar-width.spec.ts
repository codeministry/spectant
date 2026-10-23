/**
 * Spec 067 · T11 · ISC-524 (`bun run test:browser -- sidebar -g "width"`): the detail sidebar's panel is 480 px wide
 * (`--detail`) in every presentation but the sheet, measured with real layout in Chromium against the stub API:
 *
 * - docked: the Specs page at 1440 with `?sel=spec:002`, the panel fills the rail column;
 * - floating: the workspace board at 1440, and the Specs page and the board at 1200, where the shell is wide but
 *   narrower than `DOCK_MIN` (1280), so a docking page's selection floats too;
 * - overlay: the planning tree at 820, `min(480, container − 32)`, which at 820 is 480;
 * - sheet: the Specs page at 390, where the panel is the compact bottom sheet as wide as the viewport.
 *
 * The width is the `.panel` element's `getBoundingClientRect().width`, within 1 px.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';

/** The detail token (`--detail`, spec 067). */
const DETAIL = 480;

/** A wide shell narrower than `DOCK_MIN` (1280): between it and `TIER_WIDE_MIN` (1120) a docking page floats. */
const BELOW_DOCK = 1200;

type Presentation = 'docked' | 'floating' | 'overlay' | 'sheet';

/** Open `url`, wait for the sidebar in `presentation`, and return its panel's width and the viewport's. */
async function panelWidth(page: Page, url: string, presentation: Presentation): Promise<{ panel: number; viewport: number }> {
  await page.goto(url);
  const panel = page.locator(`app-detail-sidebar[data-presentation="${presentation}"] .panel`);
  await expect(panel).toBeVisible();
  await expect(page.locator('app-detail-sidebar [data-part="id"]')).not.toHaveText('');
  return panel.evaluate((el) => ({ panel: el.getBoundingClientRect().width, viewport: document.documentElement.clientWidth }));
}

test.describe('sidebar width (ISC-524): wide 1440', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('sidebar width (ISC-524): docked on the Specs page at 1440 is 480 px', async ({ page }) => {
    const { panel } = await panelWidth(page, '/w/harbor/specs?sel=spec:002', 'docked');
    expect(Math.abs(panel - DETAIL)).toBeLessThanOrEqual(1);
  });

  test('sidebar width (ISC-524): floating on the workspace board at 1440 is 480 px', async ({ page }) => {
    const { panel } = await panelWidth(page, '/w/harbor/board?sel=spec:002', 'floating');
    expect(Math.abs(panel - DETAIL)).toBeLessThanOrEqual(1);
  });
});

test.describe('sidebar width (ISC-524): wide below DOCK_MIN 1200', () => {
  test.use(atWidth(BELOW_DOCK));

  test('sidebar width (ISC-524): the Specs page floats at 1200, 480 px', async ({ page }) => {
    const { panel } = await panelWidth(page, '/w/harbor/specs?sel=spec:002', 'floating');
    expect(Math.abs(panel - DETAIL)).toBeLessThanOrEqual(1);
  });

  test('sidebar width (ISC-524): floating on the workspace board at 1200 is 480 px', async ({ page }) => {
    const { panel } = await panelWidth(page, '/w/harbor/board?sel=spec:002', 'floating');
    expect(Math.abs(panel - DETAIL)).toBeLessThanOrEqual(1);
  });
});

test.describe('sidebar width (ISC-524): medium 820', () => {
  test.use(atWidth(WIDTHS.tablet));

  test('sidebar width (ISC-524): overlay on the planning tree at 820 is min(480, container - 32)', async ({ page }) => {
    const { panel, viewport } = await panelWidth(page, '/w/harbor/planning/tree?sel=feature:F2', 'overlay');
    expect(Math.abs(panel - Math.min(DETAIL, viewport - 32))).toBeLessThanOrEqual(1);
    expect(Math.abs(panel - DETAIL)).toBeLessThanOrEqual(1);
  });
});

test.describe('sidebar width (ISC-524): compact 390', () => {
  test.use(atWidth(WIDTHS.phone));

  test('sidebar width (ISC-524): the sheet at 390 is as wide as the viewport', async ({ page }) => {
    const { panel } = await panelWidth(page, '/w/harbor/specs?sel=spec:002', 'sheet');
    expect(Math.abs(panel - WIDTHS.phone)).toBeLessThanOrEqual(1);
  });
});
