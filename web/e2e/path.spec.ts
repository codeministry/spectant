/**
 * Usage path P1 · claim of a spec (spec 019, ISC-139.1; notation of spec 018): from `/` to a named claim of a named
 * spec, visible and focused, once over the palette and once by clicks alone, at 1440, 600 and 390 px.
 *
 *   bun run e2e -- path -g P1
 *
 * Budgets: palette ≤ 5 steps and ≤ 5 s KLM, clicks ≤ 8 steps at 1440 and 600 px and ≤ 9 at 390 px (refined with spec 021:
 * the spec list folds after five rows, so the click route takes one "Show all" step). Every interaction goes through `StepCounter`
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
import { DENSE_HEADER, RESET_PATH, SESSION_HEADER, WAITS_HEADER } from './stub-api';

const TARGET = { ws: 'harbor', spec: '007', claim: 'ISC-126', number: '126' };
const ENTRY = `claim:${TARGET.ws}:${TARGET.claim}`;
const CLAIM_URL = new RegExp(`/w/${TARGET.ws}/s/${TARGET.spec}/claims#claim-${TARGET.claim}$`);
const BUDGET = { palette: { steps: 5, seconds: 5 }, clicks: { steps: 8, compact: 9 } } as const;
/** The click-route budget at a width: one step more at 390 px since the spec list folds (ISC-139.1, refined by spec 021). */
const clickBudget = (width: number): number => (width === 390 ? BUDGET.clicks.compact : BUDGET.clicks.steps);

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
    // through the workspace column to the workspace dashboard and its spec row. The budget is unchanged but at 390 px.
    test(`P1 clicks @${width}: the workspace column, the spec row on its dashboard, the spec, its claims, the card → visible and focused in ≤ ${String(clickBudget(width))} steps`, async ({ page }) => {
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

      // Spec 058: the workspace root is the dashboard; the list lives on the Specs page, one click away through the KPI
      // band's Specs figure (the shortest way there, as path P6 measures).
      // Below 640 px the band's tiles give way to the Pulse card; its Specs cell carries the same link.
      const specsKpi = page.locator(`app-kpi-band a[href="/w/${TARGET.ws}/specs"]:visible`).first();
      await expect(specsKpi).toBeVisible();
      if (!(await wholly(specsKpi))) await steps.scrollTo(specsKpi);
      await click(specsKpi, 'kpi specs');
      await expect(page).toHaveURL(new RegExp(`/w/${TARGET.ws}/specs$`));

      // The spec table opens a row in two steps: the first click selects it for the detail sidebar (`?sel=spec:`, spec
      // 026), the second opens the spec: the row again, or below 1120 px the sidebar's "Open spec", which may cover the row.
      const row = page.locator(`[data-panel="specs"] [data-spec-row="${TARGET.spec}"]`);
      // Spec 021: the spec list shows its first ten rows (five until 2026-10-20) and folds the rest behind "Show all N specs"; where the
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
      expect.soft(ist.count, 'click-route steps').toBeLessThanOrEqual(clickBudget(width));
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

    test(`P5 card @${width}: one click on the spec card → its parents, children and blockers on screen, the board unchanged, in ≤ ${P5_BUDGET.steps} step and ≤ ${P5_BUDGET.seconds} s`, async ({ page, request }, info) => {
      // An own stub session: the bare board route restores the query a board last had in that session, and another
      // case's `?group=milestone` must not decide what P5 sees (spec 042).
      const session = `p5-${info.testId}-${String(info.retry)}`;
      await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
      expect((await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } })).status()).toBe(204);
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
        await expect(section.locator('a.text-link, p.none').first(), `${name} first entry on screen`).toBeInViewport({ ratio: 1 });
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


/*
 * Usage paths P3 and P6 share the dense harbor workspace (`DENSE_HEADER: on`: 22 specs, 3 Next-up entries, 7 waiting
 * entries, a fresh TL;DR; density `comfortable`), the widths 1440 and 600 px (900 px high, the height `atWidth` gives
 * both) and both languages. Reading is not a step: a block counts as read once its box is wholly in the viewport after
 * the steps so far. Where a block is not yet read, the path scrolls down by at most one screen (seven eighths of the
 * viewport, as Page Down) so the first unread block starts under the sticky header, and that scroll is one step.
 */
const DENSE = { ws: 'harbor' } as const;
/** More scrolls than any budget allows, so a red run still reports how many screens the path takes. */
const MAX_SCROLLS = 8;

type Block = readonly [string, Locator];

/** True when the target's box lies wholly between the viewport's top and bottom edge (P1's `wholly`). */
const whollyOnScreen = (target: Locator): Promise<boolean> =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });

/** One stub session per test, so the language and density set here never leak into another worker's case. */
function useDenseSession(prefix: string, lang: 'en' | 'de', width: number): void {
  let session = '';
  test.beforeEach(async ({ page, request }, info) => {
    session = `${prefix}-${lang}-${String(width)}-${info.testId}`;
    await page.context().setExtraHTTPHeaders({ [DENSE_HEADER]: 'on', [SESSION_HEADER]: session });
    const saved = await request.put('/api/settings', {
      data: { language: lang, density: 'comfortable' },
      headers: { [SESSION_HEADER]: session },
    });
    expect(saved.ok()).toBe(true);
  });
  test.afterEach(async ({ request }) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  });
}

/** Step 1 of both paths: from `/` a click on harbor's workspace column (a scroll to it first would count). */
async function openWorkspace(page: Page, lang: 'en' | 'de', steps: StepCounter, column: Locator): Promise<void> {
  if (!(await whollyOnScreen(column))) await steps.scrollTo(column);
  await steps.clickOn(column, `workspace ${DENSE.ws}`);
  await expect(page).toHaveURL(new RegExp(`/w/${DENSE.ws}$`));
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
}

/** Each block's height and top in page coordinates before any scroll, for the report. */
async function geometryOf(blocks: readonly Block[]): Promise<string> {
  const geometry: string[] = [];
  for (const [name, target] of blocks) {
    if ((await target.count()) === 0) continue;
    const box = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: Math.round(r.top + window.scrollY), height: Math.round(r.height) };
    });
    geometry.push(`${name} ${String(box.height)} px @y${String(box.top)}`);
  }
  return geometry.join('; ');
}

/** Reads what is wholly on screen and scrolls at most one screen toward the first unread block, until all are read. */
async function readAll(page: Page, steps: StepCounter, targets: readonly Block[], width: number): Promise<string[]> {
  const height = page.viewportSize()?.height ?? 0;
  const headerBottom = await page.locator('app-shell header').first().evaluate((el) => Math.max(0, Math.round(el.getBoundingClientRect().bottom)));
  const read = new Set<string>();
  for (let scrolls = 0; ; scrolls++) {
    for (const [name, target] of targets) if (!read.has(name) && (await whollyOnScreen(target))) read.add(name);
    const unread = targets.find(([name]) => !read.has(name));
    if (!unread || scrolls >= MAX_SCROLLS) break;
    const top = await unread[1].evaluate((el) => el.getBoundingClientRect().top);
    const delta = Math.max(1, Math.min(Math.round(height * 0.875), Math.round(top - headerBottom)));
    steps.scroll();
    const before = await page.evaluate(() => window.scrollY);
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.wheel(0, delta);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  }
  return targets.map(([name]) => name).filter((name) => !read.has(name));
}

/*
 * Usage path P3 · state of a workspace (spec 058, ISC-401; spec 021's ISC-246.1 for the dashboard; notation of spec
 * 018): from `/` to the dense harbor dashboard read — its KPI band, TL;DR card, "Waits on you" (`#waiting`) and Next up,
 * the order of the one column — at 1440 and 600 px, in English and in German. Since the split the spec list stands on
 * the page Specs, so P3 reads no list head; the way to the list is P6.
 *
 *   bun run e2e -- path -g P3
 *
 * Step 1 is the click on harbor's workspace column, as in P1. Spec 018's Ist: 4 steps and 7.5 s at 1440 px, 6 steps
 * and 10.8 s at 600 px. The annotations carry the Ist: steps, KLM seconds, the trail, the bottom of Next up against the
 * viewport height, and each block's height and top before any scroll.
 */
const P3_BUDGET: Readonly<Record<number, { steps: number; seconds: number }>> = {
  1440: { steps: 1, seconds: 3 },
  600: { steps: 2, seconds: 4.5 },
};

test.describe('P3 · step counter', () => {
  test('P3 counter: one click is M + P + B = 2.65 s; a click and one screen make M + P + B + M + K = 4.28 s', () => {
    const r = new StepRecorder();
    r.click('workspace');
    expect(klm(r.sequence)).toBe(2.65);
    r.scroll();
    expect(r.count).toBe(2);
    expect(klm(r.sequence)).toBe(4.28);
  });
});

for (const lang of ['en', 'de'] as const) {
  for (const width of [1440, 600] as const) {
    test.describe(`P3 · state of a workspace @${width} in ${lang}`, () => {
      test.use(atWidth(width));
      useDenseSession('p3', lang, width);

      const budget = P3_BUDGET[width] ?? { steps: 0, seconds: 0 };
      test(`P3 workspace @${width} in ${lang}: the column, then KPI band, TL;DR, Waits on you and Next up read in ≤ ${budget.steps} steps and ≤ ${budget.seconds} s`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        const column = page.locator(`app-workspace-column[data-ws="${DENSE.ws}"] .ws-head a[href="/w/${DENSE.ws}"]`);
        await expect(column).toBeVisible();
        const steps = new StepCounter(page);
        await openWorkspace(page, lang, steps, column);

        const nextUp = page.locator('app-next-up-list:visible').first();
        // The dashboard's one column, in its order; the spec list is not on it (spec 058).
        const targets: readonly Block[] = [
          ['kpi band', page.locator('app-kpi-band')],
          ['tldr', page.locator('[data-ui="brief"]').first()],
          ['waits', page.locator('#waiting')],
          ['next up', nextUp],
        ];
        for (const [name, target] of targets) await expect(target, `${name} is on the page`).toBeVisible();
        await expect(page.locator('app-spec-table'), 'the dashboard holds no spec list').toHaveCount(0);
        expect(await page.evaluate(() => window.scrollY), 'the dashboard opens unscrolled').toBe(0);
        const height = page.viewportSize()?.height ?? 0;
        const geometry = await geometryOf(targets);
        const nextUpBottom = await nextUp.evaluate((el) => Math.round(el.getBoundingClientRect().bottom + window.scrollY));

        const unreadNames = await readAll(page, steps, targets, width);

        const seconds = klm(steps.sequence);
        test.info().annotations.push(
          {
            type: `P3 workspace @${width} ${lang}`,
            description: `${steps.count} steps, ${seconds} s KLM — ${trail(steps.sequence)}; next up bottom y ${String(nextUpBottom)} of viewport ${String(height)}${unreadNames.length > 0 ? `; unread: ${unreadNames.join(', ')}` : ''}`,
          },
          { type: `P3 heights @${width} ${lang}`, description: geometry },
        );
        expect.soft(steps.count, 'P3 steps').toBeLessThanOrEqual(budget.steps);
        expect.soft(seconds, 'P3 KLM seconds').toBeLessThanOrEqual(budget.seconds);
        if (width === 1440) expect.soft(steps.sequence.filter((s) => s.kind === 'scroll').length, 'P3 scrolls at 1440').toBe(0);
        expect(unreadNames, 'every block read').toEqual([]);
      });
    });
  }
}

/*
 * Usage path P6 · list of a workspace (spec 058, ISC-402; notation of spec 018): from `/` to the dense harbor Specs
 * page read — the spec list's head and its first five rows on `/w/harbor/specs` — at 1440 and 600 px, in English and in
 * German.
 *
 *   bun run e2e -- path -g P6
 *
 * The start offers no link to a workspace's Specs page, so the shortest path is two clicks: harbor's workspace column,
 * then the KPI band's Specs figure, which links to the page (one click, where the page menu takes two: open, entry).
 * The annotations carry the Ist: steps, KLM seconds, the trail, the bottom of the fifth row against the viewport height,
 * and each block's height and top before any scroll.
 */
const P6 = { rows: 5 } as const;
const P6_BUDGET = { steps: 2 } as const;

test.describe('P6 · step counter', () => {
  test('P6 counter: two clicks are 2 steps and 2 × (M + P + B) = 5.3 s; a third screen would break the budget', () => {
    const r = new StepRecorder();
    r.click('workspace');
    r.click('kpi specs');
    expect(r.count).toBe(2);
    expect(klm(r.sequence)).toBe(5.3);
    r.scroll();
    expect(r.count).toBeGreaterThan(P6_BUDGET.steps);
  });
});

for (const lang of ['en', 'de'] as const) {
  for (const width of [1440, 600] as const) {
    test.describe(`P6 · list of a workspace @${width} in ${lang}`, () => {
      test.use(atWidth(width));
      useDenseSession('p6', lang, width);

      test(`P6 list @${width} in ${lang}: the column, the KPI band's Specs figure, then the list head and its first ${P6.rows} rows read in ≤ ${P6_BUDGET.steps} steps`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        const column = page.locator(`app-workspace-column[data-ws="${DENSE.ws}"] .ws-head a[href="/w/${DENSE.ws}"]`);
        await expect(column).toBeVisible();
        const steps = new StepCounter(page);
        await openWorkspace(page, lang, steps, column);

        // The KPI band's Specs link: the tile at every tier where it is a tile, the cell where the band is a row of cells.
        const specsLink = page.locator(`app-kpi-band a[href="/w/${DENSE.ws}/specs"]:visible`).first();
        await expect(specsLink).toBeVisible();
        if (!(await whollyOnScreen(specsLink))) await steps.scrollTo(specsLink);
        await steps.clickOn(specsLink, 'kpi specs');
        await expect(page).toHaveURL(new RegExp(`/w/${DENSE.ws}/specs$`));
        await expect(page.locator('app-not-found')).toHaveCount(0);

        // A row is its list item: the row link stretches over it (`::after`), so the item's box is what is read.
        const rows = page.locator('app-spec-table li:has([data-spec-row])');
        await expect(rows.nth(P6.rows - 1)).toBeVisible();
        expect(await rows.count()).toBeGreaterThanOrEqual(P6.rows);
        const targets: readonly Block[] = [
          ['list head', page.locator('app-spec-table .t-head')],
          ...Array.from({ length: P6.rows }, (_, i) => [`row ${String(i + 1)}`, rows.nth(i)] as const),
        ];
        for (const [name, target] of targets) await expect(target, `${name} is on the page`).toBeVisible();
        const height = page.viewportSize()?.height ?? 0;
        const geometry = await geometryOf(targets);
        const lastBottom = await rows.nth(P6.rows - 1).evaluate((el) => Math.round(el.getBoundingClientRect().bottom + window.scrollY));

        const unreadNames = await readAll(page, steps, targets, width);

        const seconds = klm(steps.sequence);
        test.info().annotations.push(
          {
            type: `P6 list @${width} ${lang}`,
            description: `${steps.count} steps, ${seconds} s KLM — ${trail(steps.sequence)}; row ${String(P6.rows)} bottom y ${String(lastBottom)} of viewport ${String(height)}${unreadNames.length > 0 ? `; unread: ${unreadNames.join(', ')}` : ''}`,
          },
          { type: `P6 heights @${width} ${lang}`, description: geometry },
        );
        expect.soft(steps.count, 'P6 steps').toBeLessThanOrEqual(P6_BUDGET.steps);
        expect(unreadNames, 'every block read').toEqual([]);
      });
    });
  }
}
