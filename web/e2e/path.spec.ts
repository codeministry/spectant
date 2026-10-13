/**
 * Usage path P1 · claim of a spec (spec 019, ISC-139.1; notation of spec 018): from `/` to a named claim of a named
 * spec, visible and focused, once over the palette and once by clicks alone, at 1440, 600 and 390 px.
 *
 *   bun run e2e -- path -g P1
 *
 * Budgets: palette ≤ 5 steps and ≤ 5 s KLM, clicks ≤ 8 steps. Every interaction goes through `StepCounter`
 * (`steps.ts`), and each run writes its measured steps, KLM seconds and step trail to the test's annotations, so the
 * report carries the Ist. At 390 px there is no hardware keyboard (spec 019 design, "Palette und Claim-Sprung"): a
 * tap on the header's search button stands in for ⌘K and the on-screen Go key for Enter, each one step.
 *
 * Target: harbor 007 · ISC-126, the claim the palette's claims cases use (unique by its number "126"). The palette
 * types the whole number; the notation counts characters only until the hit stands first, so this is an upper bound.
 */
import type { Locator, Page } from '@playwright/test';

import { atWidth, expect, test } from './fixtures';
import { klm, StepCounter, StepRecorder, trail } from './steps';

const TARGET = { ws: 'harbor', spec: '007', claim: 'ISC-126', number: '126' };
const ENTRY = `claim:${TARGET.ws}:${TARGET.claim}`;
const CLAIM_URL = new RegExp(`/w/${TARGET.ws}/s/${TARGET.spec}/claims#claim-${TARGET.claim}$`);
const BUDGET = { palette: { steps: 5, seconds: 5 }, clicks: { steps: 8 } } as const;

const paletteOf = (page: Page) => page.locator('app-command-palette dialog');
const claimCard = (page: Page) => page.locator(`#claim-${TARGET.claim}`);

/** The goal of P1: the claim card is on screen and holds the focus. */
async function expectGoal(page: Page, url: RegExp): Promise<void> {
  await expect(page).toHaveURL(url);
  await expect(page.locator('app-not-found')).toHaveCount(0);
  await expect(claimCard(page)).toBeVisible();
  await expect(claimCard(page)).toBeInViewport();
  await expect(claimCard(page)).toBeFocused();
}

/** Writes the measured Ist into the report: `palette @1440: 5 steps, 4.1 s KLM — Meta+K · 1 · 2 · 6 · Enter`. */
function record(route: 'palette' | 'clicks', width: number, steps: StepRecorder): { count: number; seconds: number } {
  const seconds = klm(steps.sequence);
  test.info().annotations.push({
    type: `P1 ${route} @${width}`,
    description: `${steps.count} steps, ${seconds} s KLM — ${trail(steps.sequence)}`,
  });
  return { count: steps.count, seconds };
}

test.describe('P1 · step counter', () => {
  // The calibration: spec 018's own Ist sums, recomputed from their step sequences.
  test('P1 counter: the three clicks and seven keys of spec 018 P1 make 10 steps and 11.66 s', () => {
    const r = new StepRecorder();
    r.click('spec 008');
    r.click('kpi claims');
    r.click('search');
    r.chars('ISC-126');
    expect(r.count).toBe(10);
    expect(klm(r.sequence)).toBe(11.66); // M+P+B ×3, H, M + 7K
  });

  test('P1 counter: one click and three screens of spec 018 P3 make 4 steps and 7.54 s, scrolling costs no H', () => {
    const r = new StepRecorder();
    r.click('workspace');
    r.scroll();
    r.scroll();
    r.scroll();
    expect(r.count).toBe(4);
    expect(klm(r.sequence)).toBe(7.54); // M+P+B, (M+K) ×3
  });

  test('P1 counter: a chord, a typed number and its Enter make 5 steps and 4.1 s, Enter joins the term', () => {
    const r = new StepRecorder();
    r.key('Meta+K');
    r.chars('126');
    r.key('Enter');
    expect(r.count).toBe(5);
    expect(r.sequence.map((s) => s.group)).toEqual([0, 1, 1, 1, 1]);
    expect(klm(r.sequence)).toBe(4.1); // M+K, M + 3K + K
  });

  test('P1 counter: a tap before typing adds P+B and one H; a second chord after Enter takes its own M', () => {
    const r = new StepRecorder();
    r.click('tap search');
    r.chars('126');
    r.key('Enter', 'Go');
    expect(trail(r.sequence)).toBe('tap search · 1 · 2 · 6 · Go');
    expect(klm(r.sequence)).toBe(5.52); // M+P+B, H, M + 3K + K (Go terminates the term like Enter)
    r.key('Escape');
    expect(r.count).toBe(6);
    expect(klm(r.sequence)).toBe(7.15); // + M+K
  });
});

for (const width of [1440, 600, 390] as const) {
  const touch = width === 390;

  test.describe(`P1 · claim of a spec @${width}`, () => {
    test.use({ ...atWidth(width), hasTouch: touch });

    test(`P1 palette @${width}: open, type the number, Enter → the claim is visible and focused in ≤ ${BUDGET.palette.steps} steps and ≤ ${BUDGET.palette.seconds} s`, async ({ page }) => {
      await page.goto('/');
      const trigger = page.locator('header [data-control="palette"]');
      await expect(trigger).toBeVisible();
      const steps = new StepCounter(page);

      if (touch) await steps.tapAsChord(trigger, 'tap search');
      else await steps.press('ControlOrMeta+k', 'Meta+K');
      const combobox = paletteOf(page).getByRole('combobox');
      await expect(combobox).toBeFocused();

      await steps.type(TARGET.number);
      await expect(paletteOf(page).locator('[role="option"][aria-selected="true"]')).toHaveAttribute('data-entry', ENTRY);
      await steps.press('Enter', touch ? 'Go' : 'Enter');

      await expect(paletteOf(page)).toBeHidden();
      await expectGoal(page, CLAIM_URL);
      const ist = record('palette', width, steps);
      expect.soft(ist.count, 'palette steps').toBeLessThanOrEqual(BUDGET.palette.steps);
      expect.soft(ist.seconds, 'palette KLM seconds').toBeLessThanOrEqual(BUDGET.palette.seconds);
    });

    // spec 024: overview without lists (principal 2026-10-13): `/` no longer lists specs, so the click route goes
    // through the workspace column to the workspace dashboard and its spec row. The budget is unchanged.
    test(`P1 clicks @${width}: the workspace column, the spec row on its dashboard, the spec, its claims, the card → visible and focused in ≤ ${BUDGET.clicks.steps} steps`, async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('app-overview-page a[href*="/s/"]'), 'the overview lists no spec').toHaveCount(0);
      const column = page.locator(`app-workspace-column[data-ws="${TARGET.ws}"] .ws-head a[href="/w/${TARGET.ws}"]`);
      await expect(column).toBeVisible();
      const steps = new StepCounter(page);
      const click = (target: Locator, label: string) => (touch ? steps.tapOn(target, label) : steps.clickOn(target, label));
      const wholly = (target: Locator) =>
        target.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= window.innerHeight;
        });

      if (!(await wholly(column))) await steps.scrollTo(column);
      await click(column, `workspace ${TARGET.ws}`);
      await expect(page).toHaveURL(new RegExp(`/w/${TARGET.ws}$`));

      // The spec table opens a row in two steps: the first click previews it (`?spec=`), the second opens the spec: the
      // row again, or below 1120 px the preview sheet's "Open spec" action, which covers the row.
      const row = page.locator(`[data-panel="specs"] [data-spec-row="${TARGET.spec}"]`);
      await expect(row).toBeVisible();
      if (!(await wholly(row))) await steps.scrollTo(row);
      await click(row, `preview ${TARGET.spec}`);
      await expect(page).toHaveURL((url) => url.searchParams.get('spec') === TARGET.spec);
      const sheetOpen = page.locator(`[data-inspector-sheet] a[data-action="open-spec"][href="/w/${TARGET.ws}/s/${TARGET.spec}"]`);
      const sheeted = width < 1120;
      if (sheeted) await expect(sheetOpen).toBeVisible();
      const second = sheeted ? sheetOpen : row;
      if (!(await wholly(second))) await steps.scrollTo(second);
      await click(second, `spec ${TARGET.spec}`);
      await expect(page).toHaveURL(new RegExp(`/w/${TARGET.ws}/s/${TARGET.spec}$`));

      const claimsKpi = page.locator('[data-kpi="claims"] a');
      await expect(claimsKpi).toBeVisible();
      // At 390 the spec page can open scrolled (the dashboard was scrolled to the row); bringing the KPI back counts.
      if (!(await wholly(claimsKpi))) await steps.scrollTo(claimsKpi);
      await click(claimsKpi, 'kpi claims');
      await expect(page).toHaveURL(new RegExp(`/w/${TARGET.ws}/s/${TARGET.spec}/claims$`));

      await expect(claimCard(page)).toBeVisible();
      // spec 024: the prototype tab bar under the header (principal 2026-10-12) moves the list down; where the card is
      // not wholly on screen the scroll to it counts as a step. The budget is unchanged.
      if (!(await wholly(claimCard(page)))) await steps.scrollTo(claimCard(page));
      await click(claimCard(page), TARGET.claim);

      await expectGoal(page, new RegExp(`/w/${TARGET.ws}/s/${TARGET.spec}/claims$`));
      const ist = record('clicks', width, steps);
      expect.soft(ist.count, 'click-route steps').toBeLessThanOrEqual(BUDGET.clicks.steps);
    });
  });
}
