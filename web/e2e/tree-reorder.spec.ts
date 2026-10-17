/**
 * Spec 037 · the tree lens orders the backlog (`/w/:ws/planning/tree`).
 *
 * T27 · ISC-195 (`bun run e2e -- tree-reorder.spec`): a feature moves within its group by Alt+↑/↓, by the grip's
 * "Move" menu and by dragging its grip; every move is one `POST …/backlog` with the `backlogHash` the page read, the
 * tree shows the new order after the 200 and the focus stays on the feature. At the group's edge nothing is sent.
 * T31 · ISC-196 (`-g priority`): the level picked at a feature's chip is one priority write, and the chip shows it.
 *
 * Against the stub API: harbor has no `specs/backlog.md` (its hash is the empty text's) and no `Milestone:` line, so the
 * tree lists a feature under the milestones its specs name, Harbor 0.9 (F3) and Harbor 1.0 (F1, F2, F4), and the rest
 * in the "No milestone" group (F0, F5, F6, F7); after a write the session's planning read carries the new ranks
 * (web/CLAUDE.md § "Driving the backlog writes from an e2e spec").
 */
import type { Locator, Page, Request } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { backlogUiBody, EMPTY_BACKLOG_HASH } from './backlog-ui-sequence';
import { RESET_PATH, SESSION_HEADER, WRITE_HEADER } from './stub-api';

const TREE = '/w/harbor/planning/tree';
const BACKLOG = '/api/workspaces/harbor/backlog';
/** The backlog hash of a tree without `specs/backlog.md`: the sha256 of the empty text. */
const EMPTY_SHA256 = EMPTY_BACKLOG_HASH;
const HARBOR_1_0 = 'milestone:harbor-1-0';

const isBacklogWrite = (req: Request): boolean => req.method() === 'POST' && new URL(req.url()).pathname === BACKLOG;
const featureRow = (page: Page, group: string, id: string): Locator => page.locator(`[role="treeitem"][data-key="${group}/feature:${id}"]`);
/** The feature ids of a group, top to bottom, as the tree shows them. */
const idsOf = (page: Page, group: string): Promise<string[]> =>
  page.locator(`[role="treeitem"][data-kind="feature"][data-group="${group}"] .fid`).allTextContents().then((ids) => ids.map((id) => id.trim()));

async function openTree(page: Page, session: string): Promise<void> {
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await page.goto(TREE);
  await expect(featureRow(page, HARBOR_1_0, 'F1')).toBeVisible();
}

test.describe('tree-reorder: move (T27, ISC-195)', () => {
  test.use(atWidth(WIDTHS.desktop));

  let session = '';
  test.beforeEach(() => {
    session = `t037-tree-${test.info().testId}`;
  });
  test.afterEach(async ({ request }) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  });

  test('move: Alt+↓ at F1 sends one move before F4 with the read hash; the tree shows F2, F1, F4 and the focus stays on F1', async ({ page }) => {
    await openTree(page, session);
    expect(await idsOf(page, HARBOR_1_0)).toEqual(['F1', 'F2', 'F4']);
    const row = featureRow(page, HARBOR_1_0, 'F1');
    await row.focus();
    const sent = page.waitForRequest(isBacklogWrite);
    await page.keyboard.press('Alt+ArrowDown');
    expect((await sent).postDataJSON()).toEqual({ ...backlogUiBody('tree-alt-down'), hash: EMPTY_SHA256 });
    await expect.poll(() => idsOf(page, HARBOR_1_0)).toEqual(['F2', 'F1', 'F4']);
    await expect(row).toBeFocused();
    await expect(page.locator('app-planning-tree ui-live-region')).toContainText('F1');
  });

  test('move: the next move sends the hash the first one wrote', async ({ page }) => {
    await openTree(page, session);
    await featureRow(page, HARBOR_1_0, 'F1').focus();
    const first = page.waitForResponse((res) => isBacklogWrite(res.request()));
    await page.keyboard.press('Alt+ArrowDown');
    const { hash } = (await (await first).json()) as { hash: string };
    expect(hash).not.toBe(EMPTY_SHA256);
    await expect.poll(() => idsOf(page, HARBOR_1_0)).toEqual(['F2', 'F1', 'F4']);
    const second = page.waitForRequest(isBacklogWrite);
    await page.keyboard.press('Alt+ArrowDown');
    expect((await second).postDataJSON()).toEqual({ ...backlogUiBody('tree-alt-last'), hash });
    await expect.poll(() => idsOf(page, HARBOR_1_0)).toEqual(['F2', 'F4', 'F1']);
  });

  test('move: a click on the grip opens "Move", and "Move to the top" puts F4 first in Harbor 1.0', async ({ page }) => {
    await openTree(page, session);
    await featureRow(page, HARBOR_1_0, 'F4').locator('[data-grip]').click();
    const menu = page.locator('app-reorder-menu');
    const top = menu.getByRole('button', { name: /Move to the top/u });
    await expect(top).toBeVisible();
    const sent = page.waitForRequest(isBacklogWrite);
    await top.click();
    expect((await sent).postDataJSON()).toEqual({ ...backlogUiBody('tree-menu-top'), hash: EMPTY_SHA256 });
    await expect.poll(() => idsOf(page, HARBOR_1_0)).toEqual(['F4', 'F1', 'F2']);
  });

  test('move: dragging F7 by its grip above F0 sends one move before F0 and the group reads F7, F0, F5, F6', async ({ page }) => {
    await openTree(page, session);
    expect(await idsOf(page, 'group')).toEqual(['F0', 'F5', 'F6', 'F7']);
    const grip = featureRow(page, 'group', 'F7').locator('[data-grip]');
    const from = await grip.boundingBox();
    const to = await featureRow(page, 'group', 'F0').boundingBox();
    if (from === null || to === null) throw new Error('no box for the grip or the target row');
    const sent: Request[] = [];
    page.on('request', (req) => {
      if (isBacklogWrite(req)) sent.push(req);
    });
    const written = page.waitForResponse((res) => isBacklogWrite(res.request()));
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 - 12, { steps: 4 });
    await page.mouse.move(from.x + from.width / 2, to.y + 4, { steps: 12 });
    await page.mouse.up();
    await written;
    expect(sent.map((req) => req.postDataJSON() as unknown)).toEqual([{ ...backlogUiBody('tree-drag'), hash: EMPTY_SHA256 }]);
    await expect.poll(() => idsOf(page, 'group')).toEqual(['F7', 'F0', 'F5', 'F6']);
  });

  test('move: Alt+↑ at the first feature of a group and Alt+↓ at the last send nothing and say so', async ({ page }) => {
    await openTree(page, session);
    const sent: Request[] = [];
    page.on('request', (req) => {
      if (isBacklogWrite(req)) sent.push(req);
    });
    await featureRow(page, 'group', 'F0').focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.locator('app-planning-tree ui-live-region')).toContainText('F0');
    await featureRow(page, HARBOR_1_0, 'F4').focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.locator('app-planning-tree ui-live-region')).toContainText('F4');
    expect(sent).toHaveLength(0);
    expect(await idsOf(page, HARBOR_1_0)).toEqual(['F1', 'F2', 'F4']);
  });
});

test.describe('tree-reorder: priority (T31, ISC-196)', () => {
  test.use(atWidth(WIDTHS.desktop));

  let session = '';
  test.beforeEach(() => {
    session = `t037-chip-${test.info().testId}`;
  });
  test.afterEach(async ({ request }) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  });

  test('priority: picking P1 at F2\'s chip sends one priority write and the chip shows P1', async ({ page }) => {
    await openTree(page, session);
    const chip = featureRow(page, HARBOR_1_0, 'F2').locator('[data-priority-chip]');
    await expect(chip.locator('ui-priority')).toHaveAttribute('data-level', 'P3');
    await chip.click();
    const entry = page.locator('[data-level-entry="P1"]');
    await expect(entry).toBeVisible();
    const sent = page.waitForRequest(isBacklogWrite);
    await entry.click();
    expect((await sent).postDataJSON()).toEqual({ ...backlogUiBody('tree-chip'), hash: EMPTY_SHA256 });
    await expect(chip.locator('ui-priority')).toHaveAttribute('data-level', 'P1');
    await expect(chip).not.toHaveAttribute('aria-busy', 'true');
  });
});

/**
 * T42 · ISC-198 (`bun run e2e -- tree-reorder.spec board-lanes.spec -g refused`): a write the route refuses as stale
 * (`X-Spectant-Stub-Write: stale`, the 409 of a changed `specs/backlog.md`) leaves the notice under the feature in the
 * warning tone, the tree re-reads the planning and keeps no anticipated order or priority; ✕ dismisses the notice.
 */
test.describe('tree-reorder: refused (T42, ISC-198)', () => {
  test.use(atWidth(WIDTHS.desktop));

  let session = '';
  test.beforeEach(async ({ page }) => {
    session = `t037-refused-${test.info().testId}`;
    await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session, [WRITE_HEADER]: 'stale' });
  });
  test.afterEach(async ({ request }) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  });

  test('refused: a stale move leaves the notice under F1, re-reads the planning and keeps the order', async ({ page }) => {
    await page.goto(TREE);
    const row = featureRow(page, HARBOR_1_0, 'F1');
    await row.focus();
    const answered = page.waitForResponse((res) => isBacklogWrite(res.request()));
    const reread = page.waitForRequest((req) => req.method() === 'GET' && new URL(req.url()).pathname === '/api/workspaces/harbor/planning');
    await page.keyboard.press('Alt+ArrowDown');
    expect((await answered).status()).toBe(409);
    await reread;
    const notice = row.locator('app-refusal-notice');
    await expect(notice).toHaveAttribute('data-refusal', 'stale');
    await expect(notice).toContainText('F1 not moved');
    await expect(notice).toContainText('changed on disk');
    await expect(notice.locator('ui-notice')).toHaveAttribute('data-tone', 'warning');
    await expect(row).toHaveAttribute('aria-describedby', /refusal-/u);
    expect(await idsOf(page, HARBOR_1_0)).toEqual(['F1', 'F2', 'F4']);
    await notice.locator('[data-dismiss]').click();
    await expect(page.locator('app-planning-tree app-refusal-notice')).toHaveCount(0);
  });

  test('refused: a stale priority leaves the notice under F2 and the chip keeps P3', async ({ page }) => {
    await page.goto(TREE);
    const row = featureRow(page, HARBOR_1_0, 'F2');
    const chip = row.locator('[data-priority-chip]');
    await chip.click();
    const answered = page.waitForResponse((res) => isBacklogWrite(res.request()));
    await page.locator('[data-level-entry="P1"]').click();
    expect((await answered).status()).toBe(409);
    const notice = row.locator('app-refusal-notice');
    await expect(notice).toContainText('Priority of F2 not changed');
    await expect(chip.locator('ui-priority')).toHaveAttribute('data-level', 'P3');
  });
});
