/**
 * T154 · ISC-122.3: one reason phrase per waiting stage, the same on the three surfaces that show it. For every harbor
 * spec whose stage is in core's `WAITING_STAGES`, the dashboard row (its link's description, T137), the status block
 * of its spec page (`app-status-block [data-phrase]`, T132, spec 040 T49) and its card on the workspace board (`app-board-card`, T122)
 * carry the same reason. Since spec 020 (T13, ISC-237.1) that is the catalogue sentence of the spec's own guidance
 * entry (`DashboardModel.guidance`, read from `en.json` by key through `guidance-sentence.ts`); a waiting spec without
 * an entry (its item is not `open`) keeps the golden row's `nextReason` verbatim. `bun run --cwd web e2e -- -g reasons`.
 *
 * The row and the card carry the phrase as their link's accessible description, the row (spec 021, R1) through its
 * hidden `why-<id>` and as the last line of the link's title; both are compared verbatim. The status block is the unclamped block variant: its visible phrase is compared verbatim.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator } from '@playwright/test';
import type { SpecPageModel } from '../../core/src/files.ts';
import { type Stage, WAITING_STAGES } from '../../core/src/stage.ts';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { type GuidanceView, shownReason, specEntryOf } from './guidance-sentence';

/**
 * The fields of a `DashboardSpecRow` read here. Not imported: `core/src/dashboard.ts` pulls in modules that fail the
 * e2e tsconfig's `noPropertyAccessFromIndexSignature`.
 */
type DashboardRow = { readonly id: string; readonly slug: string; readonly stage: Stage; readonly nextReason: string };
type DashboardModel = { readonly specs: readonly DashboardRow[]; readonly guidance?: GuidanceView };

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const golden = (name: string): unknown =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../core/fixtures/${name}`, import.meta.url)), 'utf8'));

const DASHBOARD = golden('harbor.golden.json') as DashboardModel;
const SPEC_PAGES = golden('harbor.spec.golden.json') as Record<string, SpecPageModel & { readonly guidance?: GuidanceView }>;

/** The waiting rows of the harbor dashboard golden, in the model's order. */
const WAITING = DASHBOARD.specs
  .filter((row) => WAITING_STAGES.has(row.stage))
  .map((row) => ({ id: row.id, slug: row.slug, stage: row.stage, raw: row.nextReason, phrase: shownReason(DASHBOARD.guidance, row.id, row.nextReason) }));

/** The claim speaks of every waiting stage; fewer than three would make "the same everywhere" a weak check. */
const MIN_COVERED = 3;

/** The text a clamped `.phrase` shows, read once `uiClamp` has written it. */
const shownText = (phrase: Locator): Promise<string> => phrase.evaluate((el) => el.textContent);

/** A phrase as a literal inside a regular expression. */
const literal = (phrase: string): string => phrase.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

test.describe('reasons', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('the golden has at least three waiting specs, each with one phrase the spec page agrees on', () => {
    expect(WAITING.length, `waiting harbor specs: ${WAITING.map((w) => w.id).join(', ')}`).toBeGreaterThanOrEqual(MIN_COVERED);
    for (const { slug, raw, phrase, id } of WAITING) {
      expect(phrase, `${id} carries a phrase`).not.toBe('');
      const specPage = SPEC_PAGES[`specs/${slug}`];
      expect(specPage?.head.nextReason, `${id}: the spec page's head carries the row's phrase`).toBe(raw);
      // Same item, same sentence: the spec page's slice of the guidance holds the dashboard's entry for the spec.
      expect(specEntryOf(specPage?.guidance, id)?.reason, `${id}: the spec page's guidance agrees`).toEqual(specEntryOf(DASHBOARD.guidance, id)?.reason);
    }
    // At least three of them read a catalogue sentence; one without an entry keeps its phrase.
    expect(WAITING.filter((w) => w.phrase !== w.raw).length, 'waiting specs reading a sentence').toBeGreaterThanOrEqual(MIN_COVERED);
  });

  test('every waiting spec shows its phrase verbatim on the dashboard row', async ({ page }) => {
    // Spec 021: the spec list folds behind its first five rows; `?open=specs` opens it so every waiting row renders.
    await page.goto('/w/harbor?open=specs');
    await expect(page.locator('[data-spec-row]')).not.toHaveCount(0);
    let covered = 0;
    for (const { id, phrase } of WAITING) {
      // Spec 021 (R1, ISC-240 refined): the row shows no reason line. The phrase, the guidance sentence or, without an
      // entry, the row's own reason, is the row link's description (the hidden `why-<id>`) and the last line of its title.
      const why = page.locator(`app-spec-table #why-${id}[data-reason="${id}"]`);
      await expect(why, `dashboard row ${id}: the reason`).toHaveText(phrase);
      await expect(why, `dashboard row ${id}: no visible line`).toBeHidden();
      const link = page.locator(`app-spec-table [data-spec-row="${id}"]`);
      await expect(link, `dashboard row ${id}: described by the reason`).toHaveAttribute('aria-describedby', new RegExp(`(^| )why-${id}( |$)`, 'u'));
      await expect(link, `dashboard row ${id}: link description`).toHaveAccessibleDescription(new RegExp(literal(phrase), 'u'));
      await expect(link, `dashboard row ${id}: the title's last line`).toHaveAttribute('title', new RegExp(`\\n${literal(phrase)}$`, 'u'));
      covered++;
    }
    expect(covered).toBeGreaterThanOrEqual(MIN_COVERED);
  });

  test('every waiting spec shows its phrase verbatim in the status block of its spec page', async ({ page }) => {
    let covered = 0;
    for (const { id, phrase } of WAITING) {
      await page.goto(`/w/harbor/s/${id}/status`);
      // Spec 040 (T49): the block form of the state line carries the phrase (open), or the block below it (waiting).
      await expect(page.locator('app-status-block ui-item-state'), `status block ${id}: the block variant`).toHaveAttribute('data-block', '');
      const reason = page.locator('app-status-block [data-phrase]');
      await expect(reason, `status block ${id}`).toHaveCount(1);
      await expect.poll(() => shownText(reason), { message: `status block ${id}` }).toBe(phrase);
      covered++;
    }
    expect(covered).toBeGreaterThanOrEqual(MIN_COVERED);
  });

  test('every waiting spec shows its phrase verbatim on its workspace board card', async ({ page }) => {
    await page.goto('/w/harbor/board');
    await expect(page.locator('app-board-card')).not.toHaveCount(0);
    let covered = 0;
    for (const { id, slug, stage, phrase } of WAITING) {
      const card = page.locator(`app-board-card[data-key="spec:${slug}"]`);
      await expect(card, `board card ${id}`).toHaveCount(1);
      await expect(card, `board card ${id}`).toHaveAttribute('data-stage', stage);
      // Spec 040 (T48): the card shows its state line in place of the reason line; the phrase is the link's description.
      await expect(card.locator('[data-card-state] ui-item-state'), `board card ${id}: state line`).toHaveCount(1);
      // The card's one link is described by the same phrase (T122).
      await expect(card.locator('a.title'), `board card ${id}: link description`).toHaveAccessibleDescription(`waits: ${phrase}`);
      covered++;
    }
    expect(covered).toBeGreaterThanOrEqual(MIN_COVERED);
  });
});
