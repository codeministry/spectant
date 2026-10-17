/**
 * Spec 037 · T37 · ISC-195.1: a feature band of the workspace board moves only within its own milestone or within the
 * "No milestone" group (`/w/:ws/board?group=feature`).
 *
 *   bun run test:browser -- board-lanes
 *
 * Real Chromium against the stub API. On harbor the board shows the bands F3 (Harbor 0.9) | F2, F4 (Harbor 1.0) |
 * F0, F5, F6, F7 (no milestone); F1 has no card and so no band. While a band is dragged by its grip, every head of
 * another group carries `data-band-lock` and none of them the drop line (`data-drop-line`), and a release there sends
 * no backlog write. Alt+↑ on the first and Alt+↓ on the last band of a group send nothing either.
 * Threshold: 0 drop targets outside the dragged band's group, 0 backlog requests at the edges.
 */
import type { Locator, Page, Request } from '@playwright/test';
import { atWidth, expect, test } from '../fixtures';
import { RESET_PATH, SESSION_HEADER } from '../stub-api';

const BOARD = '/w/harbor/board?group=feature';
const BACKLOG = '/api/workspaces/harbor/backlog';
/** Every band head in board order; `data-band` is the feature id. */
const HEADS = 'app-board-page .band-list > .band-head';
const BANDS = ['F3', 'F2', 'F4', 'F0', 'F5', 'F6', 'F7'];

const isBacklogWrite = (req: Request): boolean => req.method() === 'POST' && new URL(req.url()).pathname === BACKLOG;
const head = (page: Page, band: string): Locator => page.locator(`${HEADS}[data-band="${band}"]`);
const gripOf = (page: Page, band: string): Locator => page.locator(`[data-band-grip="${band}"]`);
const shownBands = (page: Page): Promise<string[]> =>
  page.locator(HEADS).evaluateAll((heads) => heads.map((h) => h.getAttribute('data-band') ?? '?').filter((key) => key !== ''));

/** Every backlog write the page sends from now on. */
function countWrites(page: Page): Request[] {
  const sent: Request[] = [];
  page.on('request', (req) => {
    if (isBacklogWrite(req)) sent.push(req);
  });
  return sent;
}

/** Scrolls the board's scroller so the band's head stands just below its top edge, clear of the autoscroll zone. */
async function scrollToHead(page: Page, band: string): Promise<void> {
  await head(page, band).evaluate((h) => {
    let box = h.parentElement;
    while (box !== null && !(box.scrollHeight > box.clientHeight && /auto|scroll/u.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    const scroller = box ?? document.scrollingElement;
    if (scroller === null) return;
    const offset = h.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scroller.scrollTop + offset - 80, behavior: 'instant' });
  });
}

async function centre(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (box === null) throw new Error('the element is not rendered');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `board-bounds-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  expect((await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } })).status()).toBe(204);
  await page.goto(BOARD);
  await expect(page.locator(HEADS).first()).toBeVisible();
  expect(await shownBands(page)).toEqual(BANDS);
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.use(atWidth(1440));

test('lanes bounds: dragging band F0 over band F2 of Harbor 1.0 locks F2, shows no drop line there, and a release sends nothing', async ({ page }) => {
  const sent = countWrites(page);
  const group = (await head(page, 'F0').getAttribute('data-move-group')) ?? '';
  expect(await head(page, 'F2').getAttribute('data-move-group')).not.toBe(group);
  // Tall enough that the heads of F3, F2 and F0 stand in view at once, clear of the autoscroll edges.
  await page.setViewportSize({ width: 1440, height: 1800 });
  await scrollToHead(page, 'F3');
  const from = await centre(gripOf(page, 'F0'));
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x, from.y - 8, { steps: 4 });
  // Lifted: F0 stays as the dashed placeholder.
  await expect(page.locator(`${HEADS}.cdk-drag-placeholder[data-band="F0"]`)).toHaveCount(1);
  for (const band of ['F2', 'F3']) {
    const over = await centre(head(page, band));
    await page.mouse.move(from.x, over.y, { steps: 16 });
    await page.mouse.move(from.x, over.y + 2, { steps: 2 });
    await expect(head(page, band), `over ${band}`).toHaveAttribute('data-band-lock', '');
    await expect(head(page, band).locator('[data-band-lock-hint]'), `over ${band}`).toHaveCount(1);
    await expect(head(page, band), `over ${band}`).not.toHaveAttribute('data-drop-line');
    // No head outside F0's group carries the line; every one of them is locked, none of F0's own group is.
    await expect(page.locator(`${HEADS}[data-drop-line]:not([data-move-group="${group}"])`), `over ${band}`).toHaveCount(0);
    await expect(page.locator(`${HEADS}:not([data-move-group="${group}"]):not([data-band-lock])`), `over ${band}`).toHaveCount(0);
    await expect(page.locator(`${HEADS}[data-move-group="${group}"][data-band-lock]`), `over ${band}`).toHaveCount(0);
  }
  // The release lands over F2's head, a band of Harbor 1.0.
  const over = await centre(head(page, 'F2'));
  await page.mouse.move(from.x, over.y, { steps: 16 });
  await page.mouse.move(from.x, over.y + 2, { steps: 2 });
  await expect(page.locator(`${HEADS}[data-drop-line]:not([data-move-group="${group}"])`)).toHaveCount(0);
  await page.mouse.up();
  await expect(page.locator(`${HEADS}[data-band-lock]`)).toHaveCount(0);
  // A write the page would send goes out at once; give it a beat to show up, then none must have.
  await page.waitForTimeout(300);
  expect(sent).toHaveLength(0);
  expect(await shownBands(page)).toEqual(BANDS);
});

test('lanes bounds: Alt+↑ on the first and Alt+↓ on the last band of a milestone or the group send nothing', async ({ page }) => {
  const sent = countWrites(page);
  const edges = [
    ['F2', 'Alt+ArrowUp'],
    ['F3', 'Alt+ArrowUp'],
    ['F0', 'Alt+ArrowUp'],
    ['F4', 'Alt+ArrowDown'],
    ['F3', 'Alt+ArrowDown'],
    ['F7', 'Alt+ArrowDown'],
  ] as const;
  for (const [band, key] of edges) {
    await gripOf(page, band).focus();
    await page.keyboard.press(key);
    await expect(gripOf(page, band)).toBeFocused();
  }
  await page.waitForTimeout(300);
  expect(sent).toHaveLength(0);
  expect(await shownBands(page)).toEqual(BANDS);
});
