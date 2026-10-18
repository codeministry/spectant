/**
 * The worktree chip against the stub API (spec 027, ISC-175): `bun run e2e -- worktree -g chip`.
 *
 * `X-Spectant-Stub-Worktrees: on` lays harbor's worktree facts over the goldens (`stub-board.ts`, T33; the table in
 * `web/e2e/README.md` § The worktree overlay): 002 on `feature/002-web-console`, two commits ahead of `main` with
 * uncommitted changes; 009 clean and level with `main`; 003 with the `worktree-branch-mismatch` warning; 004 none.
 *
 * - "chip": the spec head of 002 shows the full chip (branch, `↑2`, `±`, the accessible sentence); the workspace board
 *   shows the compact, non-interactive chip on 002's card (`↑2`, `±`) and none on 004's, `↑0` without `±` on 009's and
 *   the warning tone on 003's; the card is the `board-card` container and shows the branch text only from 280 px, at
 *   390, 820 and 1440; a card whose assignee pill stands on a line of its own (both, at 1440) is no taller with the
 *   chip than without it. Without the header no chip shows anywhere.
 *
 * - "tasks" (ISC-179.1, T40; `bun run e2e -- worktree -g tasks`): the overlay's runs on harbor 002 (T26 applied and
 *   ticked, T27 patched, T28 applied-open, T29 building, T32 dispatched). The live board holds the four unticked ones
 *   in the group "In round n", furthest along first, each with its run chip in place of the state chip, and counts
 *   them in the toolbar in run order; the Tasks tab shows the run chip in BUILDER above the session's short form at
 *   1440 and as the first element of the meta line at 820 and 390, the state slot inside the row; T28 reads "applied,
 *   open" with its box empty. A `bump-run` turns T32's chip within one refresh tick, on the board and on the Tasks
 *   tab, with one polite announcement per tick. Without the header only the golden's own run lines show (harbor's
 *   activity log: T26 applied and ticked, T28 applied-open): one card in the round, no chip on T27, T29 or T32.
 *
 * - "timeline" (ISC-175.1, T41; `bun run e2e -- worktree.spec -g timeline`): 007's strand holds the derived entry
 *   "Merged into main" with its branch, the subline with commit 4f1c2ab and the merge commit's time, between two dated
 *   entries; 006's holds "Worktree removed" with its path, undated ("no date" at 1440, "—" with the words for screen
 *   readers at 390 and 820) in the day group of the entry before it. Both carry the dashed marker with their glyph
 *   (git-merge, folder-x) and the derived chip, no chevron; the Worktree pill closes the filter row with its count and
 *   narrows the strand to the entry. Without the header neither entry nor the pill shows.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, FIXED_NOW, test, WIDTHS } from './fixtures';
import { BUMP_RUN_PATH, SESSION_HEADER, WORKTREES_HEADER } from './stub-api';

const ON = { [WORKTREES_HEADER]: 'on' } as const;
const SPEC_002 = '/w/harbor/s/002';
/** At compact the board shows one column (`?col=`); 002 and 009 both stand in `build`. */
const WS_BOARD = '/w/harbor/board?col=build';
const SENTENCE_002 = 'Worktree .worktrees/002-web-console, branch feature/002-web-console, 2 commits ahead of main, uncommitted changes';

const headChip = (page: Page): Locator => page.locator('ui-worktree-chip[data-head-worktree]');
const card = (page: Page, id: string): Locator => page.locator(`app-board-page app-board-card[data-key^="spec:${id}-"]`).first();
const cardChip = (page: Page, id: string): Locator => card(page, id).locator('ui-worktree-chip');

test.describe('chip', () => {
  test.describe('with the worktree overlay', () => {
    test.use({ ...atWidth(WIDTHS.desktop), extraHTTPHeaders: ON });

    test('chip: the spec head of 002 shows branch, ↑2 and ± with the accessible sentence', async ({ page }) => {
      await page.goto(SPEC_002);
      const chip = headChip(page);
      await expect(chip).toBeVisible();
      await expect(chip).toHaveAttribute('data-form', 'full');
      await expect(chip.locator('.branch')).toHaveText('feature/002-web-console');
      await expect(chip.locator('.ahead')).toHaveText('↑2');
      await expect(chip.locator('.dirty')).toHaveText('±');
      await expect(chip.locator('button.trigger')).toHaveAttribute('aria-label', SENTENCE_002);
    });

    test('chip: the board card of 002 shows the compact chip with ↑2 and ±, 004 none, 009 ↑0 without ±, 003 the warning tone', async ({ page }) => {
      await page.goto('/w/harbor/board');
      await expect(card(page, '002')).toBeAttached();

      const chip = cardChip(page, '002');
      await expect(chip).toHaveCount(1);
      await expect(chip).toHaveAttribute('data-form', 'compact');
      await expect(chip.locator('.ahead')).toHaveText('↑2');
      await expect(chip.locator('.dirty')).toHaveText('±');
      await expect(chip.locator('.vh')).toHaveText(SENTENCE_002);
      await expect(chip.locator('.static')).toHaveAttribute('title', 'feature/002-web-console');
      // Not its own tap target: the card's title link stays the one link, no button and no details in the chip.
      await expect(chip.locator('button, ui-popover, ui-sheet')).toHaveCount(0);
      // In the assignee row, before the assignee pill where the card has one.
      const row = await card(page, '002').locator('.r3 .who').evaluate((el) => [...el.children].map((c) => c.localName));
      if (row.includes('ui-actor-chip')) expect(row.indexOf('ui-worktree-chip')).toBe(row.indexOf('ui-actor-chip') - 1);

      await expect(card(page, '004')).toBeAttached();
      await expect(cardChip(page, '004')).toHaveCount(0);

      await expect(cardChip(page, '009').locator('.ahead')).toHaveText('↑0');
      await expect(cardChip(page, '009').locator('.dirty')).toHaveCount(0);

      await expect(cardChip(page, '003')).toHaveAttribute('data-mismatch', '');
      await expect(cardChip(page, '003').locator('ui-chip')).toHaveAttribute('data-tone', 'warning');
      await expect(cardChip(page, '002').locator('ui-chip')).toHaveAttribute('data-tone', 'neutral');
    });
  });

  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`chip: at ${String(width)} the card chip stays compact (no branch text, no container) and adds no height`, async ({ page }) => {
        // Per card: its height, and whether the assignee pill stands on a line of its own (`.who` below the row's
        // first chip) — the design's premise for "no new line": left of the pill the line is empty.
        const measure = async (): Promise<Array<{ height: number; alone: boolean }>> => {
          await page.goto(WS_BOARD);
          await expect(card(page, '002')).toBeVisible();
          return Promise.all(
            ['002', '009'].map((id) =>
              card(page, id).evaluate((el) => {
                const first = el.querySelector('.r3')?.firstElementChild;
                const who = el.querySelector('.r3 > .who');
                const alone = !!first && !!who && who !== first && who.getBoundingClientRect().top > first.getBoundingClientRect().top;
                return { height: el.getBoundingClientRect().height, alone };
              }),
            ),
          );
        };
        const without = await measure();
        await expect(cardChip(page, '002')).toHaveCount(0);

        await page.context().setExtraHTTPHeaders(ON);
        const withChip = await measure();
        await expect(cardChip(page, '002')).toHaveCount(1);
        if (width === WIDTHS.desktop) expect(without.map((c) => c.alone), 'at 1440 both pills stand on their own line').toEqual([true, true]);
        // Principal 2026-10-13: the chip stays compact on cards at every width. Where the pill stood on a line of its
        // own (both cards at 1440) the chip joins that line and the card keeps its height; where feature, milestone and
        // pill already share the line (390, 820) the group wraps and the card grows by one line — accepted by the
        // principal (spec 027 § Decisions), so only the first case is asserted.
        without.forEach((before, i) => {
          if (before.alone) expect(withChip[i]?.height, `card ${String(i)}: the compact chip joins the pill's line, no card grows`).toBe(before.height);
        });

        // No `board-card` container on the card: the primitive's 280 px full form never applies here.
        const box = await card(page, '002').evaluate((el) => {
          const style = getComputedStyle(el);
          return { name: style.containerName, type: style.containerType };
        });
        expect(box.name).not.toBe('board-card');
        expect(box.type).not.toBe('inline-size');
        await expect(cardChip(page, '002')).toHaveAttribute('data-form', 'compact');
        await expect(cardChip(page, '002').locator('.branch')).toBeHidden();
        await expect(cardChip(page, '002').locator('.ahead')).toBeVisible();
        await expect(cardChip(page, '002').locator('.dirty')).toBeVisible();
      });
    });
  }

  test.describe('without the worktree overlay', () => {
    test.use(atWidth(WIDTHS.desktop));

    test('chip: no chip on the spec head of 002, nor on the board cards of 002 and 004', async ({ page }) => {
      await page.goto(SPEC_002);
      await expect(page.locator('app-spec-head, [data-head]').first()).toBeVisible();
      await expect(page.locator('ui-worktree-chip')).toHaveCount(0);

      await page.goto('/w/harbor/board');
      await expect(card(page, '002')).toBeAttached();
      await expect(card(page, '004')).toBeAttached();
      await expect(page.locator('app-board-card ui-worktree-chip')).toHaveCount(0);
    });
  });
});

/** The overlay's run chips on harbor 002, by task: the words of design.md decision 3. */
const RUN_WORDS = { T28: 'applied, open', T27: 'patch ready', T29: 'building', T32: 'dispatched' } as const;
const BOARD_002 = `${SPEC_002}/board`;
const TASKS_002 = `${SPEC_002}/tasks`;
/** `DEFAULT_SETTINGS.refreshSeconds` plus a second of slack, as `refresh.spec.ts`. */
const PAST_ONE_POLL_MS = 31_000;

const liveCard = (page: Page, task: string): Locator => page.locator(`[data-lanes] app-board-card:has(> article[data-card="${task}"])`);
const taskRow = (page: Page, task: string): Locator => page.locator(`app-tasks-tab [data-task-row]#task-${task}`);
const boxOf = (locator: Locator): Promise<{ x: number; y: number; right: number; bottom: number }> =>
  locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, right: r.right, bottom: r.bottom };
  });

test.describe('tasks', () => {
  test.describe('with the worktree overlay', () => {
    test.use({ ...atWidth(WIDTHS.desktop), extraHTTPHeaders: ON });

    test('tasks: the live board groups the four unticked runs in "In round n", each with its run chip in place of the state chip', async ({ page }) => {
      await page.goto(BOARD_002);
      const groups = page.locator('[data-lanes] [data-section="inRound"]');
      await expect(groups.locator('article[data-card]')).toHaveCount(4);
      await expect(groups.first().locator('h4')).toContainText(/In round \d+/);
      // Furthest along first within a lane: applied-open → patched → building → dispatched.
      const rank = ['applied-open', 'patched', 'building', 'dispatched'];
      for (const group of await groups.all()) {
        const runs = await group.locator('app-board-card').evaluateAll((els) => els.map((el) => el.getAttribute('data-run') ?? ''));
        expect(runs).toEqual([...runs].sort((a, b) => rank.indexOf(a) - rank.indexOf(b)));
      }
      for (const [task, word] of Object.entries(RUN_WORDS)) {
        const card = liveCard(page, task);
        await expect(card.locator('app-run-chip'), task).toHaveText(word);
        await expect(card.locator('ui-state-chip'), `${task}: never two state chips`).toHaveCount(0);
      }
      // T26 is applied and ticked: its landed chip, no run chip, outside the group.
      await expect(liveCard(page, 'T26').locator('app-run-chip')).toHaveCount(0);
      await expect(liveCard(page, 'T26').locator('ui-state-chip')).toHaveCount(1);
      await expect(groups.locator('article[data-card="T26"]')).toHaveCount(0);
      // The toolbar counts the run states above 0 in run order, before the card-state chips.
      const counters = page.locator('[data-legend] [data-run-count]');
      expect(await counters.evaluateAll((els) => els.map((el) => el.getAttribute('data-run-count')))).toEqual(['dispatched', 'building', 'patched', 'applied-open']);
      await expect(counters.first()).toContainText('1');
      // The lane line names the round with its counts above 0.
      await expect(page.locator('[data-lanes] [data-lane-round]').first()).toContainText('in the round');
    });

    test('tasks: at 1440 the run chip sits in BUILDER above the session short form; T28 reads "applied, open" with its box empty', async ({ page }) => {
      await page.goto(TASKS_002);
      await expect(page.locator('app-tasks-tab app-run-chip')).toHaveCount(4);
      for (const [task, word] of Object.entries(RUN_WORDS)) {
        await expect(taskRow(page, task).locator('.builder app-run-chip'), task).toHaveText(word);
      }
      const t28 = taskRow(page, 'T28');
      await expect(t28.locator('[data-task-check]')).not.toBeChecked();
      await expect(t28.locator('.state .status')).toBeVisible();
      const session = t28.locator('[data-run-session]');
      await expect(session).toBeVisible();
      await expect(session).not.toHaveText('');
      const chip = await boxOf(t28.locator('app-run-chip'));
      const short = await boxOf(session);
      expect(short.y, 'the short form under the chip').toBeGreaterThanOrEqual(chip.bottom - 1);
      const width = await t28.locator('.builder').evaluate((el) => el.getBoundingClientRect().width);
      expect(width).toBeGreaterThanOrEqual(152);
      await expect(taskRow(page, 'T26').locator('app-run-chip')).toHaveCount(0);
    });
  });

  for (const width of [WIDTHS.phone, WIDTHS.tablet]) {
    test.describe(`at ${String(width)}`, () => {
      test.use({ ...atWidth(width), extraHTTPHeaders: ON });

      test(`tasks: at ${String(width)} the run chip leads the meta line and the state slot stays inside the row`, async ({ page }) => {
        await page.goto(TASKS_002);
        const t28 = taskRow(page, 'T28');
        const chip = t28.locator('app-run-chip');
        await expect(chip).toBeVisible();
        await expect(chip).toHaveText('applied, open');
        const run = await boxOf(chip);
        const claim = await boxOf(t28.locator('[data-claim]'));
        const lane = await boxOf(t28.locator('[data-lane]'));
        for (const other of [claim, lane]) {
          const sameLine = Math.abs(other.y - run.y) < 8;
          expect(sameLine ? run.x < other.x : run.y < other.y, 'the run chip comes first').toBe(true);
        }
        for (const task of ['T28', 'T27', 'T29', 'T32']) {
          const row = await boxOf(taskRow(page, task));
          // The whole slot: since spec 040 a row may carry its state word beside its own status word (a question).
          const state = await boxOf(taskRow(page, task).locator('.state'));
          expect(state.right, `${task}: the state chip ends inside the row`).toBeLessThanOrEqual(row.right);
        }
      });
    });
  }

  test.describe('a bump within one tick', () => {
    test.use({ ...atWidth(WIDTHS.desktop), clockAt: null });

    test('tasks: a bump-run turns the chip within one refresh tick on the board and the Tasks tab, announced once per tick', async ({ page, request }, info) => {
      const headers = { ...ON, [SESSION_HEADER]: `worktree-tasks-${info.testId}-${String(info.retry)}` };
      await page.setExtraHTTPHeaders(headers);
      await request.post('/api/__stub/reset', { headers });
      await page.clock.install({ time: new Date(FIXED_NOW) });
      const bump = async (): Promise<void> => {
        expect((await request.post(`${BUMP_RUN_PATH}?ws=harbor&spec=002&task=T32`, { headers })).status()).toBe(204);
      };

      await page.goto(BOARD_002);
      const chip = liveCard(page, 'T32').locator('app-run-chip');
      await expect(chip).toHaveText('dispatched');
      const region = page.locator('app-board-tab ui-live-region[data-run-announcer]');
      await expect(region).toHaveText('');
      await region.evaluate((el) => {
        const w = window as unknown as { announced: number };
        w.announced = 0;
        new MutationObserver(() => (w.announced += 1)).observe(el, { childList: true, characterData: true, subtree: true });
      });

      await bump();
      await page.clock.fastForward(PAST_ONE_POLL_MS);
      await expect(chip).toHaveText('building');
      await expect(region).toHaveText('T32: building');
      await page.clock.fastForward(PAST_ONE_POLL_MS);
      expect(await page.evaluate(() => (window as unknown as { announced: number }).announced), 'one announcement, none for a tick without a change').toBe(1);

      await page.goto(TASKS_002);
      const row = taskRow(page, 'T32').locator('app-run-chip');
      await expect(row).toHaveText('building');
      await bump();
      await page.clock.fastForward(PAST_ONE_POLL_MS);
      await expect(row).toHaveText('patch ready');
      await expect(page.locator('app-tasks-tab ui-live-region[data-run-announcer]')).toHaveText('T32: patch ready');
    });
  });

  test.describe('without the worktree overlay', () => {
    test.use(atWidth(WIDTHS.desktop));

    // The golden itself carries harbor's real run lines (ISC-179: T26 applied and ticked, T28 applied-open), so the
    // overlay's T27, T29 and T32 are what disappears; T28 stays "applied, open" until the write-order ticks it.
    test('tasks: only the golden run shows — T28 "applied, open" in the round, no chip on T27, T29 or T32', async ({ page }) => {
      await page.goto(BOARD_002);
      await expect(liveCard(page, 'T28')).toBeAttached();
      await expect(page.locator('[data-lanes] [data-section="inRound"] article[data-card]')).toHaveCount(1);
      await expect(page.locator('[data-lanes] app-run-chip')).toHaveText(['applied, open']);
      for (const task of ['T27', 'T29', 'T32']) await expect(liveCard(page, task).locator('app-run-chip'), task).toHaveCount(0);
      expect(await page.locator('[data-legend] [data-run-count]').evaluateAll((els) => els.map((el) => el.getAttribute('data-run-count')))).toEqual(['applied-open']);
      await page.goto(TASKS_002);
      await expect(taskRow(page, 'T28')).toBeAttached();
      await expect(page.locator('app-tasks-tab app-run-chip')).toHaveText(['applied, open']);
      await expect(taskRow(page, 'T28').locator('[data-run-session]')).toHaveText('wt-9');
    });
  });
});

/** The overlay's worktree entries (ISC-175.1): 007 merged at 2026-03-09T08:45:00Z (commit 4f1c2ab), 006 removed. */
const timelineOf = (id: string): string => `/w/harbor/s/${id}/timeline`;
const worktreeEntry = (page: Page): Locator => page.locator('app-timeline-tab [data-entry][data-kind="worktree"]');
const worktreePill = (page: Page): Locator => page.locator('app-timeline-tab [data-filter="worktree"]');

test.describe('timeline', () => {
  test.describe('with the worktree overlay', () => {
    test.use({ ...atWidth(WIDTHS.desktop), extraHTTPHeaders: ON });

    test('timeline: 007 shows the merged entry with branch, commit and merge time, derived, without a chevron', async ({ page }) => {
      await page.goto(timelineOf('007'));
      const entry = worktreeEntry(page);
      await expect(entry).toHaveCount(1);
      await expect(entry.locator('[data-worktree-title]')).toHaveText('Merged into main');
      await expect(entry.locator('[data-worktree-ref]')).toHaveText('feature/007-rotate-mirror-token');
      await expect(entry.locator('.meta')).toContainText('Worktree · derived from git, commit 4f1c2ab');
      await expect(entry.locator('[data-worktree-commit]')).toHaveText('4f1c2ab');
      await expect(entry.locator('.time time')).toHaveAttribute('datetime', '2026-03-09T08:45:00Z');
      await expect(entry.locator('.marker[data-derived] ui-icon')).toHaveAttribute('data-icon', 'git-merge');
      await expect(entry.locator('[data-derived-chip]')).toBeVisible();
      await expect(entry.locator('ui-disclosure, button[aria-expanded]')).toHaveCount(0);
      // Between two dated entries: neither the first nor the last of the strand.
      const ids = await page.locator('app-timeline-tab [data-entry]').evaluateAll((els) => els.map((el) => el.getAttribute('data-kind')));
      expect(ids.indexOf('worktree')).toBeGreaterThan(0);
      expect(ids.indexOf('worktree')).toBeLessThan(ids.length - 1);
      // The pill closes the row and counts the one entry; pressed, it leaves only that entry.
      await expect(page.locator('app-timeline-tab [data-filter]').last()).toHaveAttribute('data-filter', 'worktree');
      await expect(worktreePill(page)).toContainText('Worktree');
      await expect(worktreePill(page).locator('.count')).toHaveText('1');
      await worktreePill(page).click();
      await expect(page.locator('app-timeline-tab [data-entry]')).toHaveCount(1);
      await expect(page).toHaveURL(/kinds=worktree/u);
    });

    test('timeline: 006 shows the removed entry undated with its path, the folder-x glyph and no chevron', async ({ page }) => {
      await page.goto(timelineOf('006'));
      const entry = worktreeEntry(page);
      await expect(entry).toHaveCount(1);
      await expect(entry.locator('[data-worktree-title]')).toHaveText('Worktree removed');
      await expect(entry.locator('[data-worktree-ref]')).toHaveText('.worktrees/006-partial-push');
      await expect(entry.locator('.time [data-no-date]')).toHaveText('no date');
      await expect(entry.locator('.time [data-no-date]')).toBeVisible();
      await expect(entry.locator('.time time')).toHaveCount(0);
      await expect(entry.locator('.marker[data-derived] ui-icon')).toHaveAttribute('data-icon', 'folder-x');
      await expect(entry.locator('[data-derived-chip]')).toBeVisible();
      await expect(entry.locator('ui-disclosure, button[aria-expanded]')).toHaveCount(0);
      await expect(entry.locator('.meta')).not.toContainText('commit');
      // The undated rule: it stands in the day group of the entry before it, never in a group of its own.
      await expect(page.locator('app-timeline-tab [data-day="undated"]')).toHaveCount(0);
      await expect(worktreePill(page).locator('.count')).toHaveText('1');
    });
  });

  for (const width of [WIDTHS.phone, WIDTHS.tablet]) {
    test.describe(`at ${String(width)}`, () => {
      test.use({ ...atWidth(width), extraHTTPHeaders: ON });

      test(`timeline: at ${String(width)} the removed entry's time column reads "—" with "no date" for screen readers, inside the row`, async ({ page }) => {
        await page.goto(timelineOf('006'));
        const entry = worktreeEntry(page);
        await expect(entry.locator('.time [data-no-date-dash]')).toBeVisible();
        await expect(entry.locator('.time [data-no-date-dash]')).toHaveText('—');
        await expect(entry.locator('.time [data-no-date]')).toHaveText('no date');
        const box = await entry.locator('.main').evaluate((el) => el.getBoundingClientRect().right);
        expect(box).toBeLessThanOrEqual(width);
        await expect(worktreePill(page)).toBeAttached();
      });
    });
  }

  test.describe('without the worktree overlay', () => {
    test.use(atWidth(WIDTHS.desktop));

    test('timeline: no worktree entry on 007 or 006 and no Worktree pill', async ({ page }) => {
      for (const id of ['007', '006']) {
        await page.goto(timelineOf(id));
        await expect(page.locator('app-timeline-tab [data-entry]').first()).toBeVisible();
        await expect(worktreeEntry(page)).toHaveCount(0);
        await expect(worktreePill(page)).toHaveCount(0);
      }
    });
  });
});
