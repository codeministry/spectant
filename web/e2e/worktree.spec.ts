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
 * T40 adds "tasks" (run states, the bump within one tick) to this file.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { WORKTREES_HEADER } from './stub-api';

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

      test(`chip: at ${String(width)} the card is the board-card container, the branch shows from 280 px, and the chip adds no height`, async ({ page }) => {
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
        without.forEach((before, i) => {
          if (before.alone) expect(withChip[i]?.height, `card ${String(i)}: the chip joins the pill's line, no card grows`).toBe(before.height);
        });

        const box = await card(page, '002').evaluate((el) => {
          const style = getComputedStyle(el);
          return { name: style.containerName, type: style.containerType, width: el.getBoundingClientRect().width };
        });
        expect(box.name).toBe('board-card');
        expect(box.type).toBe('inline-size');
        const branch = cardChip(page, '002').locator('.branch');
        if (box.width >= 280) await expect(branch).toBeVisible();
        else await expect(branch).toBeHidden();
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
