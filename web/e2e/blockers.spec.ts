/**
 * Spec edges between specs against the stub API (spec 025, ISC-163): `bun run e2e -- blockers -g waits`.
 *
 * `X-Spectant-Stub-Edges: waiting | met` rebuilds harbor with two spec edges (`STUB_EDGES`; `web/e2e/README.md` § The
 * spec edges): 009 is held whole by 002 (ISC-131 `(after: 002)`, stage `blocked`), 002 in part by 006 (its web tasks
 * T27, T28, T29 and T32, stage kept). Under `waiting` 002 and 006 sit on unmerged branches, under `met` both are merged.
 *
 * - "waits", waiting: the spec head of 009 shows `blocked` and one chip "waits on 002" linking to 002's page, no scope;
 *   002's head shows "waits on 006" with the partial scope behind it, at 1440 and 390. The workspace board holds 009's
 *   card in the Blocked column with its chip and link, and 002's card carries "waits on 006". The dashboard's rows of
 *   002 and 009 carry their chips; a click on a chip lands on the blocker's page, not on the row's selection. 002's
 *   Tasks tab gives each held task the reason with the blocker's link and a disabled box; 009's Claims tab carries the
 *   chip on ISC-131; 002's live board opens a waits group linking 006. Each chip's accessible name names the blocker.
 *   In German the chip reads "wartet auf 002".
 * - "waits", met: none of those chips or reasons exists anywhere, and 009 is back in its own column.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { EDGES_HEADER, type EdgeState, RESET_PATH, SESSION_HEADER, STUB_EDGES } from './stub-api';

const WS = 'harbor';
const { full, partial } = STUB_EDGES;
const FULL_CARD = `spec:${full.folder}`;
const PARTIAL_CARD = `spec:${partial.folder}`;
const specPath = (id: string): string => `/w/${WS}/s/${id}`;

/** One stub session per test with the edges variant on the context, so a language set here never leaks. */
function useEdges(edges: EdgeState): void {
  let session = '';
  test.beforeEach(async ({ page }, info) => {
    session = `blockers-${edges}-${info.testId}`;
    await page.context().setExtraHTTPHeaders({ [EDGES_HEADER]: edges, [SESSION_HEADER]: session });
  });
  test.afterEach(async ({ request }) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  });
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(path);
}

/** The single linked chip of `chip` for `blocker`: its text, its link and an accessible name naming the blocker. */
async function expectChip(chip: Locator, blocker: string, where: string): Promise<void> {
  await expect(chip, where).toHaveCount(1);
  const link = chip.locator(`a[data-waits][data-blocker="${blocker}"]`);
  await expect(link, `${where}: one linked chip on ${blocker}`).toHaveCount(1);
  await expect(link, `${where}: the chip text`).toHaveText(`waits on ${blocker}`);
  await expect(link, `${where}: the link to the blocker`).toHaveAttribute('href', specPath(blocker));
  await expect(link, `${where}: the accessible name names the blocker`).toHaveAccessibleName(new RegExp(`^Waits on spec ${blocker}\\b`));
}

const headChip = (page: Page): Locator => page.locator('ui-waits-chip[data-head-chip="waits"]');
const card = (page: Page, key: string): Locator => page.locator(`app-board-card[data-key="${key}"]`);
const rowChip = (page: Page, id: string): Locator =>
  page.locator(`app-spec-row:has(a.row-link[data-spec-row="${id}"]) ui-waits-chip[data-row-waits]`);

/** Every surface a wait shows on, counted on its page: chips, held-task reasons, the live board's waits group. */
async function waitsOnPage(page: Page): Promise<number> {
  const hits = page.locator('ui-waits-chip, [data-waits], [data-task-waits], [data-wait-group], [data-wait-spec]');
  return hits.count();
}

test.describe('blockers waits: the spec edges hold their specs (waiting)', () => {
  useEdges('waiting');

  for (const width of [WIDTHS.desktop, WIDTHS.phone] as const) {
    test.describe(`spec head at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`waits: 009's head is blocked and waits on 002, no scope, at ${String(width)}`, async ({ page }) => {
        await open(page, specPath(full.spec));
        await expect(page.locator('[data-head-chip="stage"]')).toHaveText(/blocked/i);
        const chip = headChip(page);
        await expectChip(chip, full.on, '009 head');
        await expect(chip, 'a full hold is marked as such').toHaveAttribute('data-full', '');
        await expect(chip.locator('[data-waits-meta]'), 'a full hold carries no scope').toHaveCount(0);
        await expect(chip.locator('a[data-waits]')).toBeVisible();
      });

      test(`waits: 002's head waits on 006 with its partial scope, at ${String(width)}`, async ({ page }) => {
        await open(page, specPath(partial.spec));
        await expect(page.locator('[data-head-chip="stage"]')).not.toHaveText(/blocked/i);
        const chip = headChip(page);
        await expectChip(chip, partial.on, '002 head');
        await expect(chip).not.toHaveAttribute('data-full');
        await expect(chip.locator('[data-waits-meta]')).toHaveText(`· ${String(partial.tasks.length)} of 5 open tasks`);
        await expect(chip.locator('a[data-waits]')).toBeVisible();
      });
    });
  }

  test('waits: the board holds 009 in Blocked with its chip, 002 carries its own', async ({ page }) => {
    await open(page, `/w/${WS}/board`);
    const held = page.locator(`[data-col="blocked"] app-board-card[data-key="${FULL_CARD}"]`);
    await expect(held, '009 stands in the Blocked column').toHaveCount(1);
    await expectChip(held.locator('ui-waits-chip[data-card-waits]'), full.on, '009 card');
    await expectChip(card(page, PARTIAL_CARD).locator('ui-waits-chip[data-card-waits]'), partial.on, '002 card');
  });

  test('waits: the dashboard rows of 002 and 009 carry their chips, and a chip opens the blocker', async ({ page }) => {
    await open(page, `/w/${WS}`);
    await expectChip(rowChip(page, full.spec), full.on, '009 row');
    await expectChip(rowChip(page, partial.spec), partial.on, '002 row');

    await rowChip(page, partial.spec).locator(`a[data-blocker="${partial.on}"]`).click();
    await expect(page).toHaveURL((url) => url.pathname === specPath(partial.on) && !url.searchParams.has('sel'));
    await expect(page.locator('a.row-link[aria-expanded="true"]'), 'the row link was not triggered').toHaveCount(0);
  });

  test("waits: 002's held tasks carry the reason with the link, their boxes disabled", async ({ page }) => {
    await open(page, `${specPath(partial.spec)}/tasks`);
    const reasons = page.locator('[data-task-waits]');
    await expect(reasons).toHaveCount(partial.tasks.length);
    for (const task of partial.tasks) {
      const row = page.locator(`li[data-task-row]#task-${task}`);
      const reason = row.locator('[data-task-waits]');
      await expect(reason, `${task}: the reason`).toHaveText(`waits on ${partial.on}`);
      const link = reason.locator(`a[data-blocker="${partial.on}"]`);
      await expect(link, `${task}: the blocker link`).toHaveAttribute('href', specPath(partial.on));
      await expect(link, `${task}: the accessible name`).toHaveAccessibleName(`Waits on spec ${partial.on}`);
      await expect(row.locator('input[data-task-check]'), `${task}: the box is disabled`).toBeDisabled();
    }
  });

  test("waits: 009's held claim ISC-131 carries the chip", async ({ page }) => {
    await open(page, `${specPath(full.spec)}/claims`);
    const claims = page.locator('ui-waits-chip[data-claim-waits]');
    await expect(claims).toHaveCount(1);
    await expectChip(page.locator('[data-claim="ISC-131"] ui-waits-chip[data-claim-waits]'), full.on, 'ISC-131');
  });

  test("waits: 002's live board groups the held cards under waits on 006 with the link", async ({ page }) => {
    await open(page, `${specPath(partial.spec)}/board`);
    const summary = page.locator('[data-wait-group]');
    await expect(summary).toHaveCount(1);
    await expect(summary).toHaveText(`waits on ${partial.on}`);
    const link = page.locator(`[data-wait-spec] a[data-blocker="${partial.on}"]`);
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute('href', specPath(partial.on));
  });
});

test.describe('blockers waits: German', () => {
  let session = '';
  test.beforeEach(async ({ page, request }, info) => {
    session = `blockers-de-${info.testId}`;
    await page.context().setExtraHTTPHeaders({ [EDGES_HEADER]: 'waiting', [SESSION_HEADER]: session });
    const saved = await request.put('/api/settings', { data: { language: 'de' }, headers: { [SESSION_HEADER]: session } });
    expect(saved.ok()).toBe(true);
  });
  test.afterEach(async ({ request }) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  });

  test('waits: the chip reads "wartet auf 002" in German', async ({ page }) => {
    await open(page, specPath(full.spec));
    const link = headChip(page).locator(`a[data-blocker="${full.on}"]`);
    await expect(link).toHaveText(`wartet auf ${full.on}`);
    await expect(link).toHaveAccessibleName(new RegExp(`^Wartet auf Spec ${full.on}\\b`));
  });
});

test.describe('blockers waits: the edges are met', () => {
  useEdges('met');

  /** Each surface with an element it renders whether or not a wait shows, so nothing is counted on an empty page. */
  const pages: ReadonlyArray<readonly [string, string]> = [
    [specPath(full.spec), '[data-head-chip="stage"]'],
    [specPath(partial.spec), '[data-head-chip="stage"]'],
    [`/w/${WS}/board`, `app-board-card[data-key="${FULL_CARD}"]`],
    [`/w/${WS}`, `a.row-link[data-spec-row="${full.spec}"]`],
    [`${specPath(partial.spec)}/tasks`, `li[data-task-row]#task-${partial.tasks[0]}`],
    [`${specPath(full.spec)}/claims`, '[data-claim="ISC-131"]'],
    [`${specPath(partial.spec)}/board`, 'app-board-card'],
  ];

  test('waits: no chip and no held reason anywhere, 009 back in its own column', async ({ page }) => {
    for (const [path, subject] of pages) {
      await open(page, path);
      await expect(page.locator(subject).first(), `${path}: the page has rendered its subject`).toBeVisible();
      expect(await waitsOnPage(page), `${path}: no wait shows`).toBe(0);
    }
    await open(page, `/w/${WS}/board`);
    const back = card(page, FULL_CARD);
    await expect(back).toHaveCount(1);
    await expect(back).toHaveAttribute('data-stage', 'build');
    await expect(page.locator(`[data-col="build"] app-board-card[data-key="${FULL_CARD}"]`)).toHaveCount(1);
    await expect(page.locator(`[data-col="blocked"] app-board-card[data-key="${FULL_CARD}"]`)).toHaveCount(0);
    await open(page, `${specPath(partial.spec)}/tasks`);
    for (const task of partial.tasks) await expect(page.locator(`li[data-task-row]#task-${task}`)).toHaveCount(1);
  });
});
