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
// A state line (spec 040) may name a feature sibling it waits on, which is no spec edge; the edge count leaves it out.
async function waitsOnPage(page: Page): Promise<number> {
  const hits = page.locator(':is(ui-waits-chip, [data-waits], [data-task-waits], [data-wait-group], [data-wait-spec]):not(ui-item-state *)');
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
        await expect(chip.locator('[data-waits-meta]')).toHaveText(`· ${String(partial.tasks.length)} of 5 open tasks waiting`);
        await expect(chip.locator('a[data-waits]')).toBeVisible();
      });
    });
  }

  test('waits: the board holds 009 in Blocked with its chip, 002 carries its own', async ({ page }) => {
    await open(page, `/w/${WS}/board`);
    const held = page.locator(`[data-col="blocked"] app-board-card[data-key="${FULL_CARD}"]`);
    await expect(held, '009 stands in the Blocked column').toHaveCount(1);
    await expectChip(held.locator('[data-card-state] ui-waits-chip'), full.on, '009 card');
    await expectChip(card(page, PARTIAL_CARD).locator('[data-card-state] ui-waits-chip'), partial.on, '002 card');
  });

  test('waits: the dashboard rows of 002 and 009 carry their chips, and a chip opens the blocker', async ({ page }) => {
    await open(page, `/w/${WS}`);
    await expectChip(rowChip(page, full.spec), full.on, '009 row');
    await expectChip(rowChip(page, partial.spec), partial.on, '002 row');
    // The stage track of 009, on stage blocked, keeps its progress at Build and marks it "Blocked" (spec 025,
    // principal 2026-10-14); the phase chip stays.
    const track = page.locator(`app-spec-row:has(a.row-link[data-spec-row="${full.spec}"]) ui-stage-track`);
    await expect(track.locator('.bar[data-state="blocked"]'), '009 row: one blocked segment').toHaveCount(1);
    await expect(track.locator('[data-blocked]'), '009 row: the word').toHaveText('Blocked');
    await expect(track.locator('[role="img"]'), '009 row: the name').toHaveAccessibleName('Stage 4 of 5: Build · Blocked');
    await expect(page.locator(`app-spec-row:has(a.row-link[data-spec-row="${partial.spec}"]) [data-blocked]`), '002 row: not blocked').toHaveCount(0);

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

/**
 * The spec overlap of harbor's golden (spec 025, ISC-164.1): `bun run e2e -- blockers -g overlap`.
 *
 * 002 and 004 share `web/src/app/retention/` with no edge between them; core puts the `spec-overlap` warning on 002,
 * the waiting spec, with the edge `(after: 004)` (`web/e2e/README.md` § The spec edges). No edges variant is needed.
 *
 * - "overlap", workspace dashboard: one overlap line in the Warnings list, on 002, naming 004, with the shared path
 *   (its suffix shown, the full path kept) and a chip whose copy puts `(after: 004)` on the clipboard.
 * - "overlap", spec heads: 002's head holds the line `#overlap-004` (waiting) and copies `(after: 004)`; 004's head
 *   holds `#overlap-002` (not waiting) and copies the reverse `(after: 002)`.
 * - "overlap", spec context at 1440: the short form beside the head links to `#overlap-004`, and the jump lands there.
 * - "overlap", count: the warning shows on three surfaces (list, both heads), at least the two the claim asks for.
 */
const OVERLAP = { waiting: '002', other: '004', path: 'web/src/app/retention/', shown: 'retention/' } as const;
const edgeOn = (other: string): string => `(after: ${other})`;

/** The visible overlap lines of the workspace dashboard's Warnings list (the rail at 1440, the section below). */
const listOverlaps = (page: Page): Locator =>
  page.locator('app-warnings-panel [data-warning-kind="spec-overlap"]').filter({ visible: true });
const headOverlaps = (page: Page): Locator =>
  page.locator('app-overlap-lines[data-head-overlaps] li[data-overlap-line]').filter({ visible: true });

/** Clicks the copy button of `chip` over a cleared clipboard and returns what the clipboard then holds. */
async function copied(page: Page, chip: Locator): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  const button = chip.locator('button.copy');
  await button.click();
  await expect(button, 'the chip confirms the copy').toHaveAttribute('data-copied', '');
  return page.evaluate(() => navigator.clipboard.readText());
}

test.describe('blockers overlap: the spec-overlap warning of 002 and 004', () => {
  test.use({ ...atWidth(WIDTHS.desktop), permissions: ['clipboard-read', 'clipboard-write'] });

  test('overlap: the Warnings list holds the line on 002 with the path, its chip copies (after: 004)', async ({ page }) => {
    await open(page, `/w/${WS}`);
    const line = listOverlaps(page);
    await expect(line, 'one overlap line in the list').toHaveCount(1);
    const onWaiting = page.locator(`app-warnings-panel [data-warning-spec="${OVERLAP.waiting}"] [data-warning-kind="spec-overlap"]`);
    await expect(onWaiting.filter({ visible: true }), 'the line stands in 002\'s group').toHaveCount(1);
    await expect(line.locator('[data-overlap-other]'), 'the other spec').toHaveText(OVERLAP.other);
    const path = line.locator('[data-overlap-path]');
    await expect(path, 'one shared path').toHaveCount(1);
    await expect(path).toHaveText(OVERLAP.shown);
    await expect(path).toHaveAttribute('data-full', OVERLAP.path);
    const chip = line.locator('ui-command-chip[data-overlap-edge]');
    await expect(chip.locator('code'), 'the edge 002 could carry').toHaveText(edgeOn(OVERLAP.other));
    expect(await copied(page, chip), 'the clipboard holds the edge').toBe(edgeOn(OVERLAP.other));
  });

  for (const [spec, other, waiting] of [
    [OVERLAP.waiting, OVERLAP.other, true],
    [OVERLAP.other, OVERLAP.waiting, false],
  ] as const) {
    test(`overlap: ${spec}'s head holds the line with ${other}, its chip copies (after: ${other})`, async ({ page }) => {
      await open(page, `${specPath(spec)}?open=overlaps`);
      const line = headOverlaps(page);
      await expect(line, `one overlap line in ${spec}'s head`).toHaveCount(1);
      await expect(line).toHaveAttribute('id', `overlap-${other}`);
      await expect(line).toHaveAttribute('data-overlap-with', other);
      if (waiting) await expect(line, '002 is the waiting side').toHaveAttribute('data-overlap-waiting', '');
      else await expect(line, '004 is not the waiting side').not.toHaveAttribute('data-overlap-waiting');
      await expect(line.locator('[data-overlap-other]')).toHaveText(other);
      await expect(line.locator('[data-overlap-other]')).toHaveAttribute('href', specPath(other));
      await expect(line.locator('[data-overlap-path]')).toHaveAttribute('title', OVERLAP.path);
      const chip = line.locator('ui-command-chip[data-overlap-edge]');
      await expect(chip).toBeVisible();
      await expect(chip.locator('code')).toHaveText(edgeOn(other));
      expect(await copied(page, chip), `the clipboard holds ${spec}'s edge`).toBe(edgeOn(other));
    });
  }

  test("overlap: 002's context at 1440 shows the short form, its anchor jumps to the head line", async ({ page }) => {
    await open(page, specPath(OVERLAP.waiting));
    const short = page.locator(`[data-context-overlaps] li[data-overlap-short][data-overlap-with="${OVERLAP.other}"]`);
    await expect(short).toHaveCount(1);
    await expect(page.locator('[data-context-overlaps] [data-overlap-line]'), 'no full line repeats beside the head').toHaveCount(0);
    await short.locator('a[data-overlap-anchor]').click();
    await expect(page).toHaveURL((url) => url.pathname === specPath(OVERLAP.waiting) && url.hash === `#overlap-${OVERLAP.other}`);
    await expect(page.locator(`#overlap-${OVERLAP.other}`), 'the head line is in view').toBeInViewport();
  });

  test('overlap: the warning shows on at least two surfaces, the list and both heads', async ({ page }) => {
    let shown = 0;
    await open(page, `/w/${WS}`);
    await expect(listOverlaps(page)).toHaveCount(1);
    shown += await listOverlaps(page).count();
    for (const spec of [OVERLAP.waiting, OVERLAP.other]) {
      await open(page, `${specPath(spec)}?open=overlaps`);
      await expect(headOverlaps(page)).toHaveCount(1);
      shown += await headOverlaps(page).count();
    }
    expect(shown, 'the list plus both heads').toBe(3);
  });
});
