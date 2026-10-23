/**
 * Spec 067 · T15 · ISC-527: the detail sidebar shows the chosen object's full title, wrapped, never clamped and never
 * cut with "…", even at 200 characters; a link row of a section wraps its title to two lines at most and carries the
 * full title in `title`.
 *
 *   bun run test:browser -- sidebar -g "full title"
 *
 * Real Chromium against the stub API under `X-Spectant-Stub-Sidebar: on`: harbor 003's title is exactly
 * `STUB_SIDEBAR.title` (200 characters) in its dashboard row and its planning relation, so also in F3's child link row.
 * 003 is chosen in the Specs page's list (docked at 1440), on the workspace board (floating at 1440), in the list at 820
 * (overlay) and at 390 (sheet); then its parent link re-selects F3, whose children list 003.
 * Threshold: the head's title shows its whole text (scrollHeight = clientHeight ± 1, no line clamp, no ellipsis); the
 * link row's title spans at most two lines.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { SIDEBAR_HEADER, STUB_SIDEBAR } from '../stub-api';

const SPEC = `spec:${STUB_SIDEBAR.spec}`;
const FEATURE = 'feature:F3';
const TITLE = STUB_SIDEBAR.title;

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');

/** What the browser computes for an element's text box: sizes, clamp and overflow styles. */
interface TextBox {
  text: string;
  scrollHeight: number;
  clientHeight: number;
  height: number;
  lineHeight: number;
  lineClamp: string;
  webkitLineClamp: string;
  textOverflow: string;
  titleAttr: string | null;
}

function measure(locator: Locator): Promise<TextBox> {
  return locator.evaluate((el) => {
    const css = getComputedStyle(el);
    const read = (prop: string): string => css.getPropertyValue(prop).trim() || 'none';
    return {
      text: el.textContent.trim(),
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      height: el.getBoundingClientRect().height,
      lineHeight: Number.parseFloat(css.lineHeight),
      lineClamp: read('line-clamp'),
      webkitLineClamp: read('-webkit-line-clamp'),
      textOverflow: css.textOverflow,
      titleAttr: el.getAttribute('title'),
    };
  });
}

/** The head's title of the open sidebar holds the whole 200-character title, unclamped and without an ellipsis. */
async function expectFullTitle(page: Page, presentation: string): Promise<void> {
  const sb = sidebar(page);
  await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(SPEC);
  await expect(sb).toHaveAttribute('data-presentation', presentation);
  const title = sb.locator('[data-part="title"]');
  await expect(title).toHaveText(TITLE);
  const box = await measure(title);
  expect(TITLE).toHaveLength(200);
  expect(box.text).toBe(TITLE);
  expect(Math.abs(box.scrollHeight - box.clientHeight), `scrollHeight ${box.scrollHeight} vs clientHeight ${box.clientHeight}`).toBeLessThanOrEqual(1);
  expect(box.lineClamp).toBe('none');
  expect(box.webkitLineClamp).toBe('none');
  expect(box.textOverflow).not.toBe('ellipsis');
  // Wrapped: the 200 characters need more than one line in a 480 px panel.
  expect(box.height).toBeGreaterThan(box.lineHeight * 1.5);
}

/** Re-selects F3 through 003's parent link; 003's child link row wraps its title to two lines at most, full in `title`. */
async function expectLinkRow(page: Page, presentation: string): Promise<void> {
  const sb = sidebar(page);
  await sb.locator(`a[data-sel="${FEATURE}"]`).first().click();
  await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(FEATURE);
  await expect(sb).toHaveAttribute('data-presentation', presentation);
  const row = sb.locator(`section[data-section="children"] a[data-sel="${SPEC}"]`);
  await expect(row).toHaveCount(1);
  const lt = row.locator('[title]').first();
  await expect(lt).toHaveAttribute('title', TITLE);
  const box = await measure(lt);
  expect(box.titleAttr).toBe(TITLE);
  expect(box.lineHeight).toBeGreaterThan(0);
  expect(box.height, `height ${box.height} vs line-height ${box.lineHeight}`).toBeLessThanOrEqual(2 * box.lineHeight + 1);
}

test.beforeEach(async ({ page }) => {
  await page.setExtraHTTPHeaders({ [SIDEBAR_HEADER]: 'on' });
});

test.describe('sidebar: full title, wide (1440)', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('full title: specs list docks 003 with its 200-character title; F3 link row ≤ 2 lines', async ({ page }) => {
    await page.goto('/w/harbor/specs');
    await page.locator(`a.row-link[data-ref="${SPEC}"]`).click();
    await expectFullTitle(page, 'docked');
    await expectLinkRow(page, 'docked');
  });

  test('full title: board floats 003 with its 200-character title; F3 link row ≤ 2 lines', async ({ page }) => {
    await page.goto('/w/harbor/board');
    await page.locator(`a.title[data-ref="${SPEC}"]`).click();
    await expectFullTitle(page, 'floating');
    await expectLinkRow(page, 'floating');
  });
});

test.describe('sidebar: full title, medium (820)', () => {
  test.use(atWidth(WIDTHS.tablet));

  test('full title: overlay shows 003 with its 200-character title; F3 link row ≤ 2 lines', async ({ page }) => {
    await page.goto('/w/harbor/specs');
    await page.locator(`a.row-link[data-ref="${SPEC}"]`).click();
    await expectFullTitle(page, 'overlay');
    await expectLinkRow(page, 'overlay');
  });
});

test.describe('sidebar: full title, compact (390)', () => {
  test.use(atWidth(WIDTHS.phone));

  test('full title: sheet shows 003 with its 200-character title; F3 link row ≤ 2 lines', async ({ page }) => {
    await page.goto('/w/harbor/specs');
    await page.locator(`a.row-link[data-ref="${SPEC}"]`).click();
    await expectFullTitle(page, 'sheet');
    await expectLinkRow(page, 'sheet');
  });
});
