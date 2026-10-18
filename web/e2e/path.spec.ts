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
import { type GuidanceView, sentenceOf } from './guidance-sentence';
import { klm, StepCounter, StepRecorder, trail } from './steps';
import { WAITS_HEADER } from './stub-api';

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
      // Spec 020 T16 (ISC-238): the only spec links on `/` are the entries of a column's block "Waits on you".
      await expect(page.locator('app-overview-page app-workspace-column').first()).toBeVisible();
      const outside = await page.locator('app-overview-page a[href*="/s/"]').evaluateAll((els) => els.filter((el) => !el.closest('[data-ui="waits-block"]')).length);
      expect(outside, 'the overview lists no spec outside Waits on you').toBe(0);
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

      // The spec table opens a row in two steps: the first click selects it for the detail sidebar (`?sel=spec:`, spec
      // 026), the second opens the spec: the row again, or below 1120 px the sidebar's "Open spec", which may cover the row.
      const row = page.locator(`[data-panel="specs"] [data-spec-row="${TARGET.spec}"]`);
      // Spec 021: the spec list shows its first five rows and folds the rest behind "Show all N specs"; where the
      // target row sits behind the fold, opening it is a step of the path and counts.
      await expect(page.locator('[data-panel="specs"] [data-spec-row]').first()).toBeVisible();
      if ((await row.count()) === 0) {
        const showAll = page.locator('[data-panel="specs"] [data-fold="specs"] button').first();
        if (!(await wholly(showAll))) await steps.scrollTo(showAll);
        await click(showAll, 'show all specs');
      }
      await expect(row).toBeVisible();
      if (!(await wholly(row))) await steps.scrollTo(row);
      await click(row, `preview ${TARGET.spec}`);
      await expect(page).toHaveURL((url) => url.searchParams.get('sel') === `spec:${TARGET.spec}`);
      const sheetOpen = page.locator(`app-detail-sidebar a[data-open-spec][href="/w/${TARGET.ws}/s/${TARGET.spec}"]`);
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

/*
 * Usage path P5 · details of a card (spec 026, ISC-171.1; notation of spec 018): from the workspace board with a named
 * spec card to that spec's parents, children and blockers on screen, without a page change, at 1440, 600 and 390 px.
 *
 *   bun run e2e -- path -g P5
 *
 * One click (a tap at 390) on the card's title selects it: the address gains `?sel=spec:<id>` and stays on the board,
 * and the detail sidebar opens floating (1440) or, below 640 (600 and 390), as the modal bottom sheet, the overlay form
 * of the compact tier (design.md § Across viewports). The goal holds only when each of the three
 * relation sections — its heading and its first entry — is wholly on screen without a scroll inside the panel, so a
 * scroll the person would need cannot hide: it would have to go through the counter.
 *
 * Target: harbor 002, the spec whose claims carry the fixture's open `(after: …)` edge.
 */
const P5 = { ws: 'harbor', spec: '002' } as const;
const P5_REF = `spec:${P5.spec}`;
const P5_BUDGET = { steps: 1, seconds: 2.65 } as const;
const P5_PRESENTATION: Readonly<Record<number, string>> = { 1440: 'floating', 600: 'sheet', 390: 'sheet' };

test.describe('P5 · step counter', () => {
  test('P5 counter: one click is the shortest path and costs M + P + B = 2.65 s; one key would cost M + K = 1.63 s', () => {
    const click = new StepRecorder();
    click.click(`card ${P5.spec}`);
    expect(click.count).toBe(1);
    expect(klm(click.sequence)).toBe(2.65);
    const key = new StepRecorder();
    key.key('Enter');
    expect(klm(key.sequence)).toBe(1.63);
  });
});

for (const width of [1440, 600, 390] as const) {
  const touch = width === 390;

  test.describe(`P5 · details of a card @${width}`, () => {
    test.use({ ...atWidth(width), hasTouch: touch });

    test(`P5 card @${width}: one click on the spec card → its parents, children and blockers on screen, the board unchanged, in ≤ ${P5_BUDGET.steps} step and ≤ ${P5_BUDGET.seconds} s`, async ({ page }) => {
      await page.goto(`/w/${P5.ws}/board`);
      const card = page.locator(`a.title[data-ref="${P5_REF}"]`);
      await expect(card).toBeVisible();
      const steps = new StepCounter(page);

      // The card must already be wholly on screen; a scroll to it is a counted step.
      const onScreen = await card.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
      });
      if (!onScreen) await steps.scrollTo(card);
      if (touch) await steps.tapOn(card, `card ${P5.spec}`);
      else await steps.clickOn(card, `card ${P5.spec}`);

      // No page change: the same board path, only the selection added.
      await expect(page).toHaveURL((url) => url.pathname === `/w/${P5.ws}/board` && url.searchParams.get('sel') === P5_REF);
      await expect(page.locator('app-not-found')).toHaveCount(0);
      const sidebar = page.locator('app-detail-sidebar[data-presentation]');
      await expect(sidebar).toHaveAttribute('data-presentation', P5_PRESENTATION[width] ?? '');
      await expect(sidebar.locator('[data-part="id"]')).toHaveText(P5.spec);

      for (const name of ['parents', 'children', 'blockers'] as const) {
        const section = sidebar.locator(`section[data-section="${name}"]`);
        await expect(section, `${name} section`).toHaveCount(1);
        await expect(section.locator('h3'), `${name} heading on screen`).toBeInViewport({ ratio: 1 });
        await expect(section.locator('a.link, p.none').first(), `${name} first entry on screen`).toBeInViewport({ ratio: 1 });
      }

      const seconds = klm(steps.sequence);
      test.info().annotations.push({
        type: `P5 card @${width}`,
        description: `${steps.count} steps, ${seconds} s KLM — ${trail(steps.sequence)}`,
      });
      expect.soft(steps.count, 'P5 steps').toBeLessThanOrEqual(P5_BUDGET.steps);
      expect.soft(seconds, 'P5 KLM seconds').toBeLessThanOrEqual(P5_BUDGET.seconds);
    });
  });
}

/*
 * Usage path P2 · waiting spec with its command (spec 020, ISC-242; notation of spec 018): from `/` at 1440 px to the
 * command of the top entry of "Waits on you" in the clipboard and its reason on screen.
 *
 *   bun run e2e -- path -g P2
 *
 * With `X-Spectant-Stub-Waits: 7` the first column is harbor, its golden as it is (the fixture of ISC-237). The top
 * entry stands highlighted in the column's block "Waits on you" with its sentence and its copy chip above the fold, so
 * the path is one click on the chip (M + P + B = 2.65 s); reading the reason is not a step. The goal holds only when
 * the clipboard holds the API body's `guidance.waits[0].command` byte for byte and the top entry's sentence, built from
 * the English catalogue (`guidance-sentence.ts`), is wholly on screen. Spec 018's Ist: 1 step and 2.7 s for the
 * command; the reason and the waiting spec were not reachable.
 */
const P2 = { ws: 'harbor', headers: { [WAITS_HEADER]: '7' } } as const;
const P2_BUDGET = { steps: 1, seconds: 3 } as const;

type P2Entry = GuidanceView['waits'][number] & { readonly command: string | null };
type P2Body = { readonly guidance?: { readonly waits: readonly P2Entry[] } };

const p2Text = (s: string | null | undefined): string => (s ?? '').replace(/\s+/gu, ' ').trim();

test.describe('P2 · step counter', () => {
  test('P2 counter: one click on the copy chip costs M + P + B = 2.65 s, within the 3 s budget', () => {
    const r = new StepRecorder();
    r.click('copy chip');
    expect(r.count).toBe(1);
    expect(klm(r.sequence)).toBe(2.65);
  });
});

test.describe('P2 · waiting spec with its command @1440', () => {
  test.use(atWidth(1440));

  test(`P2 waits @1440: one click on the top waiting entry's copy chip → its command in the clipboard and its reason on screen in ≤ ${P2_BUDGET.steps} step and ≤ ${P2_BUDGET.seconds} s`, async ({ page, context, request }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.context().setExtraHTTPHeaders(P2.headers);
    const listed = await request.get('/api/workspaces', { headers: P2.headers });
    expect(listed.status(), 'GET /api/workspaces').toBe(200);
    const first = ((await listed.json()) as Array<{ slug: string; readable: boolean }>).find((w) => w.readable);
    expect(first?.slug, 'the first column is the fixture of ISC-237').toBe(P2.ws);
    const answer = await request.get(`/api/workspaces/${P2.ws}/dashboard`, { headers: P2.headers });
    expect(answer.status(), `GET dashboard of ${P2.ws}`).toBe(200);
    const body = (await answer.json()) as P2Body;
    expect(body.guidance, `${P2.ws}: the dashboard carries guidance`).toBeDefined();
    const top = body.guidance?.waits[0];
    expect(top, `${P2.ws}: something waits`).toBeDefined();
    const command = top?.command ?? '';
    expect(command, 'the top entry has a command').not.toBe('');
    const sentence = top ? sentenceOf(top.reason) : '';

    await page.goto('/');
    const entry = page.locator(`[data-ui="workspace-column"][data-ws="${P2.ws}"] [data-ui="waits-block"] [data-top]`);
    await expect(entry, 'the top waiting entry stands highlighted').toBeVisible();
    await expect(entry.locator('.id')).toHaveText(top?.spec ?? '');
    const chip = entry.locator('ui-command-chip');
    await expect(chip.locator('code'), 'the chip shows the top entry\'s command').toHaveText(command);
    expect(await page.evaluate(() => window.scrollY), 'the start opens unscrolled').toBe(0);
    await page.evaluate(() => navigator.clipboard.writeText(''));
    const steps = new StepCounter(page);

    // The chip must already be wholly on screen (`clickOn` asserts it); where it is not, the scroll to it counts.
    const button = chip.locator('button');
    const onScreen = await button.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top >= 0 && r.bottom <= window.innerHeight && r.left >= 0 && r.right <= window.innerWidth;
    });
    if (!onScreen) await steps.scrollTo(button);
    await steps.clickOn(button, `copy ${top?.spec ?? ''}`);

    // The Ist and the budget first (soft), so a failing goal below still reports the counted steps.
    const seconds = klm(steps.sequence);
    test.info().annotations.push({
      type: 'P2 waits @1440',
      description: `${steps.count} steps, ${seconds} s KLM — ${trail(steps.sequence)}`,
    });
    expect.soft(steps.count, 'P2 steps').toBeLessThanOrEqual(P2_BUDGET.steps);
    expect.soft(seconds, 'P2 KLM seconds').toBeLessThanOrEqual(P2_BUDGET.seconds);

    await expect(button, 'the visible confirmation').toHaveAttribute('data-copied', '');
    expect(await page.evaluate(() => navigator.clipboard.readText()), 'the clipboard holds the command byte for byte').toBe(command);
    const reason = entry.locator('[data-reason]');
    expect(p2Text(await reason.textContent()), 'the top entry\'s reason').toBe(p2Text(sentence));
    await expect(reason, 'the reason is wholly on screen').toBeInViewport({ ratio: 1 });
  });
});
