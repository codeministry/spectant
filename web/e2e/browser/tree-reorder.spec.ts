/**
 * Spec 037 · T28 · ISC-195.1: a feature moves only within its own group in the tree lens (`/w/:ws/planning/tree`).
 *
 *   bun run test:browser -- tree-reorder
 *
 * Real Chromium against the stub API. On harbor the tree lists Harbor 0.9 (F3), Harbor 1.0 (F1, F2, F4) and the
 * "No milestone" group (F0, F5, F6, F7). While a feature is dragged by its grip, a row of another milestone or of the
 * group is no drop target: no row carries `data-drop`, the tree carries `data-no-drop`, and a release there sends no
 * backlog write. Alt+↑ at the first and Alt+↓ at the last feature of a milestone or of the group send nothing either.
 * Threshold: 0 drop targets outside the dragged feature's group, 0 backlog requests at the edges.
 */
import type { Locator, Page, Request } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { RESET_PATH, SESSION_HEADER } from '../stub-api';

const TREE = '/w/harbor/planning/tree';
const BACKLOG = '/api/workspaces/harbor/backlog';
const HARBOR_0_9 = 'milestone:harbor-0-9';
const HARBOR_1_0 = 'milestone:harbor-1-0';
const GROUP = 'group';
const ORDER = { [HARBOR_0_9]: ['F3'], [HARBOR_1_0]: ['F1', 'F2', 'F4'], [GROUP]: ['F0', 'F5', 'F6', 'F7'] } as const;

const isBacklogWrite = (req: Request): boolean => req.method() === 'POST' && new URL(req.url()).pathname === BACKLOG;
const featureRow = (page: Page, group: string, id: string): Locator => page.locator(`[role="treeitem"][data-key="${group}/feature:${id}"]`);
const dropRows = (page: Page): Locator => page.locator('app-planning-tree [role="treeitem"][data-drop]');
const noDrop = (page: Page): Locator => page.locator('app-planning-tree [role="tree"][data-no-drop]');
const idsOf = (page: Page, group: string): Promise<string[]> =>
  page.locator(`[role="treeitem"][data-kind="feature"][data-group="${group}"] .fid`).allTextContents().then((ids) => ids.map((id) => id.trim()));

/** Every backlog write the page sends from now on. */
function countWrites(page: Page): Request[] {
  const sent: Request[] = [];
  page.on('request', (req) => {
    if (isBacklogWrite(req)) sent.push(req);
  });
  return sent;
}

async function expectOrderUnchanged(page: Page): Promise<void> {
  for (const [group, ids] of Object.entries(ORDER)) expect(await idsOf(page, group)).toEqual(ids);
}

/** The vertical centre of a row in the viewport. */
async function midY(row: Locator): Promise<number> {
  const box = await row.boundingBox();
  if (box === null) throw new Error('the row is not rendered');
  return box.y + box.height / 2;
}

/** Lifts a feature by its grip past the 4 px threshold and returns the pointer's x. */
async function lift(page: Page, row: Locator): Promise<number> {
  const grip = await row.locator('[data-grip]').boundingBox();
  if (grip === null) throw new Error('the grip is not rendered');
  const x = grip.x + grip.width / 2;
  const y = grip.y + grip.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y + 8, { steps: 4 });
  return x;
}

test.describe('tree-reorder bounds (T28, ISC-195.1)', () => {
  test.use(atWidth(WIDTHS.desktop));

  let session = '';
  test.beforeEach(async ({ page }) => {
    session = `t037-bounds-${test.info().testId}`;
    await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
    await page.goto(TREE);
    await expect(featureRow(page, HARBOR_1_0, 'F1')).toBeVisible();
    await expectOrderUnchanged(page);
  });
  test.afterEach(async ({ request }) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  });

  test('bounds: dragging F1 over Harbor 0.9 and over the group shows no drop line, and a release there sends nothing', async ({ page }) => {
    const sent = countWrites(page);
    const x = await lift(page, featureRow(page, HARBOR_1_0, 'F1'));
    // Control: over its own milestone the line shows, so the drag is live.
    await page.mouse.move(x, await midY(featureRow(page, HARBOR_1_0, 'F4')), { steps: 10 });
    await expect(dropRows(page)).toHaveCount(1);
    await expect(noDrop(page)).toHaveCount(0);
    for (const [group, id] of [[HARBOR_0_9, 'F3'], [GROUP, 'F0'], [GROUP, 'F5'], [GROUP, 'F7']] as const) {
      await page.mouse.move(x, await midY(featureRow(page, group, id)), { steps: 10 });
      await expect(noDrop(page), `over ${id}`).toHaveCount(1);
      await expect(dropRows(page), `over ${id}`).toHaveCount(0);
    }
    await page.mouse.move(x, await midY(featureRow(page, HARBOR_0_9, 'F3')), { steps: 10 });
    await expect(dropRows(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(noDrop(page)).toHaveCount(0);
    // A write the page would send goes out at once; give it a beat to show up, then none must have.
    await page.waitForTimeout(300);
    expect(sent).toHaveLength(0);
    await expectOrderUnchanged(page);
  });

  test('bounds: dragging F5 of the group over Harbor 1.0 shows no drop line, and a release there sends nothing', async ({ page }) => {
    const sent = countWrites(page);
    const x = await lift(page, featureRow(page, GROUP, 'F5'));
    await page.mouse.move(x, await midY(featureRow(page, GROUP, 'F7')), { steps: 10 });
    await expect(dropRows(page)).toHaveCount(1);
    for (const id of ['F4', 'F2', 'F1'] as const) {
      await page.mouse.move(x, await midY(featureRow(page, HARBOR_1_0, id)), { steps: 10 });
      await expect(noDrop(page), `over ${id}`).toHaveCount(1);
      await expect(dropRows(page), `over ${id}`).toHaveCount(0);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    expect(sent).toHaveLength(0);
    await expectOrderUnchanged(page);
  });

  test('bounds: Alt+↑ at the first and Alt+↓ at the last feature of each milestone and of the group send nothing', async ({ page }) => {
    const sent = countWrites(page);
    const live = page.locator('app-planning-tree ui-live-region');
    const edges = [
      [HARBOR_1_0, 'F1', 'Alt+ArrowUp'],
      [HARBOR_0_9, 'F3', 'Alt+ArrowUp'],
      [GROUP, 'F0', 'Alt+ArrowUp'],
      [HARBOR_1_0, 'F4', 'Alt+ArrowDown'],
      [HARBOR_0_9, 'F3', 'Alt+ArrowDown'],
      [GROUP, 'F7', 'Alt+ArrowDown'],
    ] as const;
    for (const [group, id, key] of edges) {
      await featureRow(page, group, id).focus();
      await page.keyboard.press(key);
      await expect(live, `${key} at ${id}`).toContainText(id);
    }
    await page.waitForTimeout(300);
    expect(sent).toHaveLength(0);
    await expectOrderUnchanged(page);
  });
});

/**
 * T49 · ISC-200 (`bun run test:browser -- tree-reorder board-lanes narrow`): at a 600 and a 390 px container the tree
 * lens has no horizontal overflow, every feature row is the two-line row of design.md (Mobile) with a 44 × 44 grip,
 * and grip, chip and their sheets are reachable by touch (a tap) and by keyboard (Tab from the row to the grip, then
 * to the chip; Enter opens the sheet, Escape returns the focus).
 */
for (const width of [WIDTHS.panel, WIDTHS.phone]) {
  test.describe(`narrow tree at ${String(width)}`, () => {
    test.use({ ...atWidth(width), hasTouch: true });

    test(`narrow: the tree at ${String(width)} has no horizontal overflow and a 44 px grip in every two-line feature row`, async ({ page }) => {
      await page.goto(TREE);
      await expect(featureRow(page, HARBOR_1_0, 'F1')).toBeVisible();
      const widths = await page.evaluate(() => {
        const tree = document.querySelector<HTMLElement>('app-planning-tree [role="tree"]');
        const root = document.documentElement;
        return { page: [root.scrollWidth, root.clientWidth], tree: [tree?.scrollWidth ?? -1, tree?.clientWidth ?? -2] };
      });
      expect(widths.page[0]).toBe(widths.page[1]);
      expect(widths.tree[0]).toBe(widths.tree[1]);
      for (const row of await page.locator('app-planning-tree [role="treeitem"][data-kind="feature"]').all()) {
        const grip = await row.locator('[data-grip]').boundingBox();
        const box = await row.boundingBox();
        expect(grip?.width ?? 0).toBeGreaterThanOrEqual(44);
        expect(grip?.height ?? 0).toBeGreaterThanOrEqual(44);
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(72);
      }
    });

    test(`narrow: at ${String(width)} a tap on the grip opens "Move" and a tap on the chip the priority sheet`, async ({ page }) => {
      await page.goto(TREE);
      const row = featureRow(page, HARBOR_1_0, 'F2');
      await row.locator('[data-grip]').tap();
      const move = page.locator('app-reorder-menu ui-sheet dialog[open]');
      await expect(move).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(move).toHaveCount(0);
      await row.locator('[data-priority-chip]').tap();
      const sheet = page.locator('app-priority-menu ui-sheet dialog[open]');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('[data-level-entry]')).toHaveCount(4);
      await page.keyboard.press('Escape');
      await expect(row.locator('[data-priority-chip]')).toBeFocused();
    });

  });

  // Keyboard without touch emulation: Chromium's touch mode changes how Tab walks the page.
  test.describe(`narrow tree keys at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`narrow: at ${String(width)} Tab leads from the feature row to its grip and its chip, and Enter on the grip opens "Move"`, async ({ page }) => {
      await page.goto(TREE);
      const row = featureRow(page, HARBOR_1_0, 'F2');
      // The arrow keys carry the tab stop to F2 (a click would select it and open the detail sheet).
      await page.locator('app-planning-tree [role="treeitem"][tabindex="0"]').focus();
      for (let i = 0; i < 12 && !(await row.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press('ArrowDown');
      await expect(row).toBeFocused();
      const grip = row.locator('[data-grip]');
      // The row with the tab stop renders its grip and chip into the tab order on the next change detection.
      await expect(grip).toHaveAttribute('tabindex', '0');
      await page.keyboard.press('Tab');
      await expect(grip).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(row.locator('[data-priority-chip]')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      await expect(grip).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page.locator('app-reorder-menu ui-sheet dialog[open]')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(grip).toBeFocused();
    });
  });
}
