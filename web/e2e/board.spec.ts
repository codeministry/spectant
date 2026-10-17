/**
 * The Board tab against the stub API (T81, ISC-87 to ISC-90, ISC-93). Every expectation is read from the harbor 002
 * goldens the stub serves (`core/fixtures/harbor.frames.golden.json`, `harbor.live.golden.json`), never restated here.
 *
 * - `bun run e2e -- board -g states` (ISC-88): every card state of the live frame renders with its glyph, the chip word
 *   of the `states.card.*` catalogue and its own (shape, tone) pair; scrubbing every frame renders every state the
 *   goldens hold.
 * - `bun run e2e -- board -g waiting` (ISC-89): waiting cards sit in their reason's group and the rendered cards equal
 *   the frame's cards, at 390 and 1440.
 * - The scrubber steps `?frame` and the frame chip follows; under the `frontier` lock fixture the locked task is in flight
 *   with its session (ISC-90); no horizontal overflow and no lane scrolling on its own at 390, 600 and 1440, at 1440
 *   also under the `frontier` locks; below wide the open rail sheet fits under them too (ISC-93).
 * - `bun run e2e -- board -g flow` (T82, ISC-87): the Flow view's four columns hold every card of the frame once, the
 *   band headers name the lanes in constitution order with n/m, scrubbing moves a card between columns, and at 390 the
 *   segmented control shows the four counts and switches the group.
 * - `bun run e2e -- board -g 'scrub changes no file'` (T89, ISC-87): scrubbing every frame in both views sends no
 *   request but GET and HEAD, so the web cannot write a file. The git half of the claim (`git status --porcelain` empty
 *   after scrubbing) is core's, in `core/tests/frames.test.ts`; an e2e against the stub has no tree to inspect.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CardState, Frame, LiveFrame, SpecType, Workflow, WorkflowStage } from '../../core/src/files.ts';
import type { APIRequestContext, Locator, Page, Request, Response as PlaywrightResponse } from '@playwright/test';
import { assigneeOf } from '../../core/src/assignee.ts';
import { allowedTransition, workflowStagesOf } from '../../core/src/stage.ts';
import { DEFAULT_WORKFLOW, FIXED_GATES, boardStages } from '../../core/src/workflow.ts';
import { writePathsOf } from '../../server/src/writes.contract.ts';
import type { PlanningModel } from '../../core/src/planning.ts';
import { featureOrder } from '../src/app/features/backlog/backlog-order.ts';
import { atWidth, expect, test } from './fixtures';
import { LOCKS_HEADER, RESET_PATH, WORKFLOW_PATH } from './stub-api';

const SPEC = 'specs/002-web-console';
const read = (name: string): unknown => {
  const path = fileURLToPath(new URL(`../../core/fixtures/${name}`, import.meta.url));
  const value = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[SPEC];
  if (value === undefined) throw new Error(`${name} holds no ${SPEC}`);
  return value;
};
const FRAMES = read('harbor.frames.golden.json') as Frame[];
const LIVE = read('harbor.live.golden.json') as LiveFrame;
const EN = JSON.parse(readFileSync(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8')) as {
  states: { card: Record<CardState, string> };
};

const BOARD = '/w/harbor/s/002/board';
/** The stub's per-test session header: settings and writes are scoped to it. */
const SESSION_HEADER = 'X-Spectant-Stub-Session';
/** The stub's lock fixture with sessions, agents and a stale agent (`web/e2e/stub-api.ts` `lockFixtures`). */
const FRONTIER_LOCKS = { 'X-Spectant-Stub-Locks': 'frontier' } as const;
/** Every card of the board: the lanes, at wide the operator steps' own checklist lane "Your steps" (T88, spec 024). */
const CARDS = ':is(app-board-tab, app-rail-slot) article[data-card]';
const statesOf = (cards: ReadonlyArray<{ state: CardState }>): string[] => [...new Set(cards.map((c) => c.state))].sort();

test.describe('states', () => {
  test.use(atWidth(1440));

  test('states: every state of the live frame renders with glyph, catalogue word and its own shape and tone', async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
    const rendered = await page.locator(CARDS).evaluateAll((cards) => [...new Set(cards.map((c) => c.getAttribute('data-state') ?? ''))].sort());
    expect(rendered).toEqual(statesOf(LIVE.cards));

    const pairs = new Set<string>();
    for (const state of statesOf(LIVE.cards) as CardState[]) {
      // spec 027: a card of the round wears its run glyph and chip (worktree.spec -g tasks); take one showing its state.
      const card = page.locator(`${CARDS}[data-state="${state}"]`).filter({ has: page.locator(`.r1 > ui-glyph svg[data-state="${state}"]`) }).first();
      await expect(card.locator(`.r1 > ui-glyph svg[data-state="${state}"]`)).toHaveCount(1);
      await expect(card.locator(`ui-state-chip[data-state="${state}"]`)).toHaveText(EN.states.card[state]);
      const glyph = card.locator('.r1 > ui-glyph');
      pairs.add(`${String(await glyph.getAttribute('data-shape'))}/${String(await glyph.getAttribute('data-tone'))}`);
      const edge = await card.evaluate((el) => getComputedStyle(el).borderInlineStartWidth);
      // spec 024: prototype value (principal: the prototype wins)
      expect(edge, state).toBe('4px');
    }
    expect(pairs.size).toBe(statesOf(LIVE.cards).length);
  });

  test('states: scrubbing every frame renders every state the goldens hold, each card named by id, claim, state, lane', async ({ page }) => {
    const seen = new Set<string>();
    for (const frame of [...FRAMES, LIVE]) {
      await page.goto(frame.kind === 'live' ? BOARD : `${BOARD}?frame=${String(frame.index)}`);
      await expect(page.locator(CARDS)).toHaveCount(frame.cards.length);
      for (const state of await page.locator(CARDS).evaluateAll((cards) => cards.map((c) => c.getAttribute('data-state') ?? ''))) seen.add(state);
    }
    expect([...seen].sort()).toEqual(statesOf([...FRAMES.flatMap((f) => f.cards), ...LIVE.cards]));

    const running = LIVE.cards.find((c) => c.state === 'running');
    if (!running) throw new Error('the live golden holds no running card');
    await expect(page.locator(`${CARDS}[data-card="${running.task}"]`)).toHaveAttribute(
      'aria-label',
      `${running.task}, ${running.claim}, ${EN.states.card.running}, ${running.lane}`,
    );
  });

  test('scrubber steps ?frame and the frame chip follows; back to live clears it', async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.locator('[data-frame-chip="live"]')).toBeVisible();
    await expect(page.locator('[data-progress]')).toHaveText(
      `claims ${String(LIVE.progress.claims.closed)}/${String(LIVE.progress.claims.total)} · tasks ${String(LIVE.progress.tasks.landed)}/${String(LIVE.progress.tasks.total)}`,
    );
    await expect(page.locator('ui-scrubber [data-recut-label]')).toHaveText('re-cut');

    const last = FRAMES.at(-1);
    if (!last) throw new Error('the frames golden is empty');
    await page.locator('ui-scrubber [data-step="previous"]').click();
    await expect(page).toHaveURL(new RegExp(`[?&]frame=${String(last.index)}(&|$)`));
    // spec 024: prototype value (principal: the prototype wins) — the replay label reads "R2 · result", the chip "history".
    await expect(page.locator('[data-frame-chip="history"] [data-frame-label]')).toHaveText(`${last.label} · ${last.kind}`);
    await expect(page.locator(CARDS)).toHaveCount(last.cards.length);
    await expect(page.locator('ui-scrubber input[type="range"]')).toHaveAttribute('aria-valuetext', last.label);

    await page.locator('[data-back-to-live]').click();
    await expect(page).not.toHaveURL(/[?&]frame=/);
    await expect(page.locator('[data-frame-chip="live"]')).toBeVisible();
  });

});

for (const width of [390, 1440] as const) {
  test.describe(`waiting at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`waiting: cards grouped by reason, every card of the frame rendered at ${String(width)}`, async ({ page }) => {
      await page.goto(BOARD);
      await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
      // spec 027: a waiting card with a run stands in the round's group, not under its reason (worktree.spec -g tasks).
      const waiting = LIVE.cards.filter((c) => c.state === 'waiting' && (c.run === undefined || c.run === null || c.run.state === 'applied'));
      expect(waiting.length).toBeGreaterThan(0);
      for (const card of waiting) {
        const group = page.locator(`[data-lane="${card.lane}"] [data-reason-group][data-reason="${card.reason ?? ''}"]`);
        await expect(group.locator(`article[data-card="${card.task}"]`)).toHaveCount(1);
        const inGroup = waiting.filter((c) => c.lane === card.lane && (c.reason ?? '') === (card.reason ?? '')).length;
        await expect(group.locator('.count').first()).toHaveText(String(inGroup));
      }
    });
  });
}

test.describe('locks', () => {
  test.use({ ...atWidth(1440), extraHTTPHeaders: FRONTIER_LOCKS });

  test('a task under a frontier lock shows in flight with the session name', async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
    // The stub's frontier fixture relabels the golden's lock and adds one session on the first waiting open claim
    // (web/e2e/stub-api.ts `lockFixtures`): T27 keeps a:claude:sess-2, T28 gets a:claude:stub-002-isc-75.
    for (const [task, session] of [
      ['T27', 'a:claude:sess-2'],
      ['T28', 'a:claude:stub-002-isc-75'],
    ] as const) {
      // spec 027: the golden's T28 carries a run (applied-open, ISC-179), so it stands in the round's group.
      const card = page.locator(`[data-section="${task === 'T28' ? 'inRound' : 'inFlight'}"] article[data-card="${task}"]`);
      await expect(card).toHaveAttribute('data-state', 'running');
      await expect(card.locator('[data-session]')).toContainText(session);
    }
  });
});

// 1440 is the wide layout, where the rail is its own column; before ed718b7 its rows pushed the page past 1440 px. At
// 1440 the frontier locks add the agents row to This frame and the stale-agent alert to Needs you; below wide both sit
// in the closed sheet, which `rail sheet at …` opens.
const OVERFLOW = [
  [390, 'none'],
  [600, 'none'],
  [1440, 'none'],
  [1440, 'frontier'],
] as const;
for (const [width, locks] of OVERFLOW) {
  test.describe(`overflow at ${String(width)}${locks === 'frontier' ? ' with frontier locks' : ''}`, () => {
    test.use({ ...atWidth(width), ...(locks === 'frontier' ? { extraHTTPHeaders: FRONTIER_LOCKS } : {}) });

    test(`no horizontal overflow and no lane scrolling on its own at ${String(width)}`, async ({ page }) => {
      await page.goto(BOARD);
      await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
      // Spec 024: cards may still be settling (the 240 ms FLIP of a frame step); measure once finite animations are done.
      await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
      const page_ = await page.evaluate(() => {
        const root = document.scrollingElement ?? document.documentElement;
        return { scroll: root.scrollWidth, client: root.clientWidth };
      });
      expect(page_.scroll).toBeLessThanOrEqual(page_.client);
      const lanes = await page.locator('app-board-tab [data-lanes] > section[data-lane]').evaluateAll((els) =>
        els.map((el) => ({ lane: el.getAttribute('data-lane'), x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight })),
      );
      expect(lanes.length).toBeGreaterThan(0);
      for (const lane of lanes) {
        expect(lane.x, String(lane.lane)).toBeLessThanOrEqual(0);
        expect(lane.y, String(lane.lane)).toBeLessThanOrEqual(0);
      }
    });
  });
}

/** The Flow view's four columns in design order and the section each card state sits in (board-model's rule). */
const COLUMNS = ['waiting', 'inFlight', 'needsYou', 'landed'] as const;
type Column = (typeof COLUMNS)[number];
const COLUMN_OF: Readonly<Record<CardState, Column>> = {
  question: 'needsYou',
  concerns: 'needsYou',
  fail: 'needsYou',
  operatorOpen: 'needsYou',
  dispatched: 'inFlight',
  running: 'inFlight',
  waiting: 'waiting',
  done: 'landed',
  closed: 'landed',
  operatorDone: 'landed',
  absent: 'landed',
};
const COLUMN_WORDS = ['Waiting', 'In flight', 'Needs you', 'Landed'];
const LANDED = new Set<CardState>(['done', 'closed', 'operatorDone']);
const SPEC_LANES = (read('harbor.spec.golden.json') as { lanes: ReadonlyArray<{ name: string }> }).lanes.map((l) => l.name);
const FLOW = `${BOARD}?view=flow`;
const FLOW_CARDS = 'app-flow-view article[data-card]';
const RANGE = 'ui-scrubber input[type="range"]';

/** Constitution order, then lanes only the cards name, `operator` last, as the goldens give them. */
const bandOrder = (cards: ReadonlyArray<{ lane: string }>): string[] => {
  const present = [...new Set(cards.map((c) => c.lane))];
  const known = SPEC_LANES.filter((lane) => lane !== 'operator' && present.includes(lane));
  const extra = present.filter((lane) => lane !== 'operator' && !known.includes(lane));
  return [...known, ...extra, ...(present.includes('operator') ? ['operator'] : [])];
};

test.describe('flow', () => {
  test.use(atWidth(1440));

  test('flow: ?view=flow shows four columns, every card of the live frame once, band headers in constitution order with n/m', async ({ page }) => {
    await page.goto(FLOW);
    await expect(page.locator('app-board-tab ui-segmented[data-control="view"] [aria-checked="true"]')).toHaveText('Flow');
    await expect(page.locator('[data-page="placeholder"]')).toHaveCount(0);
    await expect(page.locator('app-flow-view [data-column-head]')).toHaveText(COLUMN_WORDS.map((w) => new RegExp(`^\\s*${w}\\D*\\d+\\s*$`)));
    await expect(page.locator(FLOW_CARDS)).toHaveCount(LIVE.cards.length);
    const rendered = await page.locator(FLOW_CARDS).evaluateAll((cards) => cards.map((c) => c.getAttribute('data-card') ?? ''));
    expect(rendered.sort()).toEqual(LIVE.cards.map((c) => c.task).sort());
    // spec 024: prototype value (principal: the prototype wins): at wide the operator steps are the row across all columns
    // (`.op.span`, design.md § Live · Operator lane), not a band; every other card sits in its band and column.
    for (const c of LIVE.cards) {
      const at = c.lane === 'operator' ? `app-flow-view app-your-steps.span [data-step="${c.task}"]` : `app-flow-view [data-band="${c.lane}"] [data-column="${COLUMN_OF[c.state]}"]`;
      await expect(page.locator(`${at} article[data-card="${c.task}"]`)).toHaveCount(1);
    }
    const steps = LIVE.cards.filter((c) => c.lane === 'operator');
    await expect(page.locator('app-flow-view app-your-steps.span [data-steps-count]')).toHaveText(new RegExp(`^Your steps · \\d+ of ${String(steps.length)} done$`));

    const order = bandOrder(LIVE.cards).filter((lane) => lane !== 'operator');
    expect(await page.locator('app-flow-view [data-band]').evaluateAll((els) => els.map((el) => el.getAttribute('data-band')))).toEqual(order);
    for (const lane of order) {
      const cards = LIVE.cards.filter((c) => c.lane === lane);
      const head = page.locator(`app-flow-view [data-band="${lane}"] [data-band-head]`);
      await expect(head.locator('h3')).toHaveText(lane);
      await expect(head.locator('[data-band-count]')).toHaveText(`${String(cards.filter((c) => LANDED.has(c.state)).length)}/${String(cards.length)}`);
    }
  });

  test('flow: scrubbing moves a card between columns, as the frames golden says', async ({ page }) => {
    const movedIn = (f: Frame) => f.cards.find((c) => LIVE.cards.some((l) => l.task === c.task && COLUMN_OF[l.state] !== COLUMN_OF[c.state]));
    const frame = FRAMES.find((f) => movedIn(f) !== undefined);
    const then = frame ? movedIn(frame) : undefined;
    const now = LIVE.cards.find((l) => l.task === then?.task);
    if (!frame || !then || !now) throw new Error('no card changes column between a history frame and live');

    await page.goto(FLOW);
    const card = (column: Column) => page.locator(`app-flow-view [data-column="${column}"] article[data-card="${now.task}"]`);
    await expect(card(COLUMN_OF[now.state])).toHaveCount(1);

    await page.locator(RANGE).focus();
    await page.keyboard.press('Home');
    for (let i = 0; i < frame.index; i += 1) await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(new RegExp(`[?&]frame=${String(frame.index)}(&|$)`));
    await expect(page).toHaveURL(/[?&]view=flow(&|$)/);
    await expect(card(COLUMN_OF[then.state])).toHaveCount(1);
    await expect(card(COLUMN_OF[now.state])).toHaveCount(0);
    await expect(page.locator(FLOW_CARDS)).toHaveCount(frame.cards.length);

    await page.locator('[data-back-to-live]').click();
    await expect(card(COLUMN_OF[now.state])).toHaveCount(1);
  });

  test('flow: v and the view control switch between Lanes and Flow over the same cards', async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.locator('app-board-tab [data-lanes]')).toBeVisible();
    await page.locator('app-board-tab ui-segmented[data-control="view"] [role="radio"]', { hasText: 'Flow' }).click();
    await expect(page).toHaveURL(/[?&]view=flow(&|$)/);
    await expect(page.locator(FLOW_CARDS)).toHaveCount(LIVE.cards.length);
    await page.keyboard.press('v');
    await expect(page).toHaveURL(/[?&]view=lanes(&|$)/);
    await expect(page.locator('app-flow-view')).toHaveCount(0);
  });
});

test.describe('flow at 390', () => {
  test.use(atWidth(390));

  test('flow: at 390 the segmented control shows the four counts and switching it shows that group', async ({ page }) => {
    await page.goto(FLOW);
    const segments = page.locator('app-flow-view ui-segmented[data-flow-columns] [role="radio"]');
    const counts = COLUMNS.map((col) => LIVE.cards.filter((c) => COLUMN_OF[c.state] === col).length);
    await expect(segments).toHaveText(COLUMN_WORDS.map((w, i) => new RegExp(`^\\s*${w}\\D*${String(counts[i])}\\s*$`)));

    // Last to first, so every click is a switch (the default column is the first one holding cards).
    for (const [i, column] of [...COLUMNS.entries()].reverse()) {
      const count = counts[i] ?? 0;
      await segments.nth(i).click();
      await expect(page).toHaveURL(new RegExp(`[?&]flow=${column}(&|$)`));
      await expect(segments.nth(i)).toHaveAttribute('aria-checked', 'true');
      await expect(page.locator(FLOW_CARDS)).toHaveCount(count);
      await expect(page.locator(`app-flow-view [data-column="${column}"] article[data-card]`)).toHaveCount(count);
    }
    const root = await page.evaluate(() => {
      const el = document.scrollingElement ?? document.documentElement;
      return { scroll: el.scrollWidth, client: el.clientWidth };
    });
    expect(root.scroll).toBeLessThanOrEqual(root.client);
  });
});

test.describe('scrub changes no file', () => {
  test.use(atWidth(1440));

  test('scrub changes no file: scrubbing every frame in Lanes and Flow sends no request but GET and HEAD', async ({ page }) => {
    const writes: string[] = [];
    await page.route('**/*', async (route) => {
      const request = route.request();
      if (request.method() === 'GET' || request.method() === 'HEAD') return route.fallback();
      writes.push(`${request.method()} ${request.url()}`);
      return route.abort();
    });

    for (const [view, cards] of [
      ['lanes', CARDS],
      ['flow', FLOW_CARDS],
    ] as const) {
      await page.goto(`${BOARD}?view=${view}`);
      await expect(page.locator(cards)).toHaveCount(LIVE.cards.length);
      await page.locator(RANGE).focus();
      await page.keyboard.press('Home');
      for (const frame of [...FRAMES, LIVE]) {
        if (frame.kind === 'live') await expect(page).not.toHaveURL(/[?&]frame=/);
        else await expect(page).toHaveURL(new RegExp(`[?&]frame=${String(frame.index)}(&|$)`));
        await expect(page.locator(cards)).toHaveCount(frame.cards.length);
        await page.keyboard.press('ArrowRight');
      }
    }
    expect(writes).toEqual([]);
  });
});

/**
 * T88 (ISC-87): This frame, Needs you and Your steps. At wide they are the shell rail's blocks (and the collapsed
 * strip's two badges); below wide the sticky bottom bar and its sheet; in zen the bar sits inside the zen footer, so
 * the board route shows exactly one bottom bar. Every count is read from the goldens.
 */
const PREVIOUS = FRAMES.at(-1);
if (!PREVIOUS) throw new Error('the frames golden is empty');
const BEFORE = new Map(PREVIOUS.cards.map((c) => [c.task, c.state]));
/** "This frame" of the live frame: the cards new in it or in another state than in the last history frame. */
const EVENTS = LIVE.cards.filter((c) => BEFORE.get(c.task) !== c.state).map((c) => c.task);
const OPERATOR = LIVE.cards.filter((c) => c.lane === 'operator');

test.describe('rail', () => {
  // One stub session per test: the collapsed-strip case stores `railCollapsed`, and a session shared with the
  // cases running beside it (fullyParallel) would collapse their rail or reset it under them.
  useStubSession('board-rail');

  test.describe('at 1440', () => {
    test.use(atWidth(1440));

    test('rail: This frame and Needs you are the rail blocks, Your steps the operator lane; a tick posts through the checkbox write', async ({ page }) => {
      await page.goto(BOARD);
      await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
      const rail = page.locator('aside.shell-rail [data-rail-blocks]');
      await expect(page.locator('[data-bottom-bar]')).toHaveCount(0);

      const events = await rail.locator('app-this-frame [data-frame-event]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-frame-event')));
      expect(events).toEqual(EVENTS);
      await expect(rail.locator('app-needs-you [data-needs-count]')).toHaveText(String(LIVE.needsYou.length));
      await expect(rail.locator('app-needs-you [data-needs-card]')).toHaveCount(LIVE.needsYou.length);
      const edge = await rail.locator('app-needs-you [data-needs-card]').first().evaluate((el) => getComputedStyle(el).borderInlineStartWidth);
      expect(edge).toBe('4px');

      // spec 024: prototype value (principal: the prototype wins): design.md § Live · Operator lane (Principal 2026-10-13), the
      // operator steps are their own lane in the grid, each a compact 36 px card; the Needs you card lists them (.op-mini).
      const lane = page.locator('app-board-tab [data-lanes] app-your-steps');
      const steps = await lane.locator('[data-step]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-step')));
      expect(steps).toEqual(OPERATOR.map((c) => c.task));
      await expect(rail.locator('app-your-steps')).toHaveCount(0);
      await expect(rail.locator('app-needs-you [data-op-mini]')).toHaveCount(OPERATOR.length);
      await expect(page.locator('[data-lanes] section[data-lane="operator"]')).toHaveCount(0);
      for (const height of await lane.locator('article[data-card]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
        expect(height).toBe(36);
      }

      const open = OPERATOR.find((c) => c.state === 'operatorOpen');
      if (!open) throw new Error('the live golden holds no open operator step');
      const row = lane.locator(`[data-step="${open.task}"]`);
      const box = row.locator('input[type="checkbox"]');
      await expect(box).toBeEnabled();
      await expect(box).not.toBeChecked();
      const written = page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes(`/${open.task}`));
      await box.check();
      expect((await written).status()).toBe(200);
      await expect(row).toHaveAttribute('data-check', 'written');
      await expect(box).toBeChecked();
    });

    test('rail: the collapsed strip shows the This frame and Needs you counts', async ({ page }) => {
      await page.goto(BOARD);
      await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
      await page.locator('aside.shell-rail [data-control="rail-collapse"]').click();
      await expect(page.locator('aside.shell-rail[data-rail-strip]')).toBeVisible();
      await expect(page.locator('[data-rail-count="thisFrame"]')).toHaveText(String(EVENTS.length));
      await expect(page.locator('[data-rail-count="needsYou"]')).toHaveText(String(LIVE.needsYou.length));
      await expect(page.locator('[data-rail-count="waiting"]')).toHaveCount(0);
      await page.locator('aside.shell-rail [data-control="rail-expand"]').click();
      await expect(page.locator('aside.shell-rail [data-rail-blocks] app-this-frame')).toBeVisible();
    });

    test('rail: in zen the board route shows exactly one bottom bar, the zen footer holding the frame bar', async ({ page }) => {
      await page.goto(BOARD);
      await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
      await page.locator('header [data-control="zen"]').click();
      const footer = page.locator('[data-zen-footer]');
      await expect(footer).toBeVisible();
      await expect(page.locator('[data-bottom-bar]')).toHaveCount(1);
      await expect(footer.locator('[data-bottom-bar]')).toHaveCount(1);
      await expect(footer.locator('[data-zen-part="id"]')).toHaveText('002');
      await expect(footer.locator('[data-bar-count="needsYou"]')).toHaveText(`Needs you ${String(LIVE.needsYou.length)}`);
      expect((await footer.boundingBox())?.height).toBe(48);

      await footer.locator('[data-bar-open]').click();
      await expect(page.locator('ui-sheet dialog[open] app-this-frame [data-frame-event]')).toHaveCount(EVENTS.length);
    });
  });

  test.describe('at 390', () => {
    test.use(atWidth(390));

    test('rail: the bottom bar names both counts and opens the sheet with both lists', async ({ page }) => {
      await page.goto(BOARD);
      await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
      await expect(page.locator('aside.shell-rail')).toBeHidden();
      const bar = page.locator('[data-bottom-bar]');
      await expect(bar).toHaveCount(1);
      await expect(bar.locator('[data-bar-count="thisFrame"]')).toHaveText(`This frame ${String(EVENTS.length)}`);
      await expect(bar.locator('[data-bar-count="needsYou"]')).toHaveText(`Needs you ${String(LIVE.needsYou.length)}`);

      await bar.locator('[data-bar-open]').click();
      const sheet = page.locator('ui-sheet dialog[open]');
      await expect(sheet.locator('app-this-frame [data-frame-event]')).toHaveCount(EVENTS.length);
      await sheet.locator('ui-segmented [aria-checked]').filter({ hasText: 'Needs you' }).click();
      await expect(sheet.locator('app-needs-you [data-needs-card]')).toHaveCount(LIVE.needsYou.length);
    });
  });
});

/**
 * T85 (ISC-90): agent chips. Under the `frontier` lock fixture each card in flight shows its lock's session and the
 * time since the lock was taken (the clock pinned to the golden's `ts`, the stub's now), the stale marker where the
 * model set it, the lock source name in This frame and the stale-agent alert in Needs you.
 */
test.describe('agents', () => {
  test.use({ ...atWidth(1440), extraHTTPHeaders: FRONTIER_LOCKS, clockAt: LIVE.ts });

  const ago = (since: string): string => {
    const minutes = Math.floor((Date.parse(LIVE.ts) - Date.parse(since)) / 60_000);
    return new Intl.RelativeTimeFormat('en', { numeric: 'always' }).format(-minutes, 'minute');
  };

  test('agents: the in-flight card shows the agent chip with session and relative time, the source and the stale marker', async ({ page }) => {
    const answer = page.waitForResponse((res) => /\/live(\?|$)/.test(res.url()));
    await page.goto(BOARD);
    const frame = (await (await answer).json()) as LiveFrame;
    await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
    const running = frame.cards.filter((c) => c.lock !== undefined);
    expect(running.length).toBeGreaterThan(1);
    expect(running.some((c) => c.stale === true)).toBe(true);

    for (const card of running) {
      // spec 027: a running card with a run (the golden's T28) stands in the round's group, its agent chip with it.
      const chip = page.locator(`:is([data-section="inFlight"], [data-section="inRound"]) app-agent-chip[data-agent-of="${card.task}"]`);
      await expect(chip.locator('[data-agent-session]')).toHaveText(card.lock?.session ?? '');
      await expect(chip.locator('time[data-agent-elapsed]')).toHaveText(ago(card.since ?? ''));
      await expect(chip.locator('[data-agent-stale]')).toHaveCount(card.stale === true ? 1 : 0);
    }

    const source = page.locator('aside.shell-rail app-this-frame [data-lock-source]');
    await expect(source).toHaveAttribute('data-lock-source', 'frontier');
    await expect(source).toContainText('frontier');
    await expect(page.locator('aside.shell-rail app-this-frame [data-agents] app-agent-chip')).toHaveCount(frame.agents.length);
    for (const agent of frame.agents.filter((a) => a.stale)) {
      await expect(page.locator(`aside.shell-rail app-needs-you [data-stale-agent][data-session="${agent.session}"]`)).toBeVisible();
    }
  });

  test('agents: the stale alert keeps the session and each claim id on one line', async ({ page }) => {
    const answer = page.waitForResponse((res) => /\/live(\?|$)/.test(res.url()));
    await page.goto(BOARD);
    const frame = (await (await answer).json()) as LiveFrame;
    const stale = frame.agents.filter((a) => a.stale);
    expect(stale.length).toBeGreaterThan(0);
    for (const agent of stale) {
      const ids = page.locator(`aside.shell-rail app-needs-you [data-stale-agent][data-session="${agent.session}"] [data-alert-id]`);
      await expect(ids).toHaveText([agent.session, ...agent.claims]);
      await expectIdsWhole(ids);
    }
  });
});

/**
 * The rail's rows wrap their text instead of cutting it, so the claim id at the end of a row stays readable, and the state
 * chip sits on the first text line. Under the frontier locks, so This frame carries its agents row and Needs you its alert.
 */
test.describe('rail text', () => {
  test.use({ ...atWidth(1440), extraHTTPHeaders: FRONTIER_LOCKS });
  const ROWS = 'aside.shell-rail :is(app-this-frame [data-frame-event], app-needs-you [data-needs-card])';

  test('rail text: This frame and Needs you show each row text in full, wrapped rather than cut', async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
    const texts = page.locator(`${ROWS} .text`);
    expect(await texts.count()).toBeGreaterThan(0);
    for (const clip of await texts.evaluateAll((els) => els.map((el) => el.scrollWidth - el.clientWidth))) expect(clip).toBeLessThanOrEqual(0);
  });

  test('rail text: the state chip centres on the first text line', async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
    // spec 024: prototype value (principal: the prototype wins): This frame's rows are the compact .fevents lines without a chip.
    const rows = await chipOffsets(page.locator('aside.shell-rail app-needs-you [data-needs-card]'));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.offset, row.task).toBeLessThanOrEqual(0.5);
  });
});

/** How far each rail row's state chip sits from the centre of its text's first line, and the row's height. */
async function chipOffsets(rows: Locator): Promise<Array<{ task: string; offset: number; height: number }>> {
  return rows.evaluateAll((els) =>
    els.map((el) => {
      const task = el.querySelector('.mono')?.textContent.trim() ?? el.textContent.trim().slice(0, 12);
      const chip = el.querySelector('ui-state-chip ui-chip');
      const text = el.querySelector('.text');
      if (chip === null || text === null) return { task: `${task}: no chip or no text`, offset: Number.POSITIVE_INFINITY, height: 0 };
      const range = document.createRange();
      range.selectNodeContents(text);
      const line = range.getClientRects()[0];
      const box = chip.getBoundingClientRect();
      if (line === undefined) return { task: `${task}: empty text`, offset: Number.POSITIVE_INFINITY, height: 0 };
      return { task, offset: Math.abs(box.top + box.height / 2 - (line.top + line.height / 2)), height: el.getBoundingClientRect().height };
    }),
  );
}

/** Each id of the stale alert renders on one line: its box is no taller than one line of its own line height. */
async function expectIdsWhole(ids: Locator): Promise<void> {
  const boxes = await ids.evaluateAll((els) =>
    els.map((el) => ({ id: el.textContent, height: el.getBoundingClientRect().height, line: parseFloat(getComputedStyle(el).lineHeight) })),
  );
  expect(boxes.length).toBeGreaterThan(0);
  for (const box of boxes) {
    expect(Number.isFinite(box.line), `${box.id}: line height`).toBe(true);
    expect(box.height, box.id).toBeLessThanOrEqual(box.line + 0.5);
  }
}

/**
 * The page and the open sheet's scrolling body scroll on neither axis sideways, and every row text is shown in full with
 * room to read. The sheet's `.body` is its scroll container (`ui-sheet`), so it is measured, not the dialog.
 */
async function expectSheetFits(page: Page, rows: Locator): Promise<void> {
  const widths = await page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const body = document.querySelector('ui-sheet dialog[open] .body');
    return { page: root.scrollWidth - root.clientWidth, body: body === null ? null : body.scrollWidth - body.clientWidth };
  });
  expect(widths.page).toBeLessThanOrEqual(0);
  expect(widths.body, 'the open sheet has a scrolling body').not.toBeNull();
  expect(widths.body ?? 0).toBeLessThanOrEqual(0);
  const texts = await rows.locator('.text').evaluateAll((els) => els.map((el) => ({ clip: el.scrollWidth - el.clientWidth, width: el.clientWidth })));
  expect(texts.length).toBeGreaterThan(0);
  for (const text of texts) {
    expect(text.clip).toBeLessThanOrEqual(0);
    expect(text.width).toBeGreaterThanOrEqual(80);
  }
}

/** Opens the bottom bar's sheet and returns it with its two segments: This frame first, Needs you second. */
async function openRailSheet(page: Page): Promise<{ sheet: Locator; needsYou: Locator }> {
  await page.goto(BOARD);
  await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
  await page.locator('[data-bottom-bar] [data-bar-open]').click();
  const sheet = page.locator('ui-sheet dialog[open]');
  await expect(sheet.locator('app-this-frame [data-frame-event]').first()).toBeVisible();
  return { sheet, needsYou: sheet.locator('ui-segmented [aria-checked]').nth(1) };
}

/**
 * Below wide the rail lives in the bottom bar's sheet. Under the frontier locks This frame carries its agents row and
 * Needs you its stale alert, so both lists, the alert's whole ids and the chips on the first line are checked there, in
 * English and in German, the long case (state words and the alert sentence).
 */
for (const lang of ['en', 'de'] as const) {
  for (const width of [390, 600] as const) {
    test.describe(`rail sheet at ${String(width)} in ${lang}`, () => {
      test.use(atWidth(width));

      // One stub session per test, so the language set here never leaks into a case running in another worker.
      let session = '';
      test.beforeEach(async ({ page, request }, info) => {
        session = `rail-sheet-${lang}-${String(width)}-${info.testId}`;
        await page.context().setExtraHTTPHeaders({ ...FRONTIER_LOCKS, [SESSION_HEADER]: session });
        const saved = await request.put('/api/settings', { data: { language: lang }, headers: { [SESSION_HEADER]: session } });
        expect(saved.ok()).toBe(true);
      });
      test.afterEach(async ({ request }) => {
        await request.post('/api/__stub/reset', { headers: { [SESSION_HEADER]: session } });
      });

      test(`rail sheet: both lists fit the open sheet at ${String(width)} in ${lang}, texts in full and ids whole`, async ({ page }) => {
        const { sheet, needsYou } = await openRailSheet(page);
        const frameRows = sheet.locator('app-this-frame [data-frame-event]');
        await expectSheetFits(page, frameRows);
        // spec 024: prototype value (principal: the prototype wins): This frame's rows are the compact .fevents lines without a chip;
        // each still names its card.
        const named = await frameRows.evaluateAll((els) => els.map((el) => [el.getAttribute('data-frame-event'), el.querySelector('.fid')?.textContent]));
        expect(named.length).toBeGreaterThan(0);
        for (const [task, id] of named) expect(id).toBe(task);

        await needsYou.click();
        await expect(sheet.locator('app-needs-you [data-stale-agent]').first()).toBeVisible();
        const needsRows = sheet.locator('app-needs-you [data-needs-card]');
        await expectSheetFits(page, needsRows);
        for (const row of await chipOffsets(needsRows)) expect(row.offset, row.task).toBeLessThanOrEqual(0.5);
        await expectIdsWhole(sheet.locator('app-needs-you [data-alert-id]'));
      });
    });
  }
}

/** On a coarse pointer every rail row, in This frame and in Needs you, keeps its 44 px target and centres its chip. */
test.describe('rail sheet on a coarse pointer', () => {
  test.use({ ...atWidth(820), hasTouch: true, isMobile: true, extraHTTPHeaders: FRONTIER_LOCKS });

  test('rail sheet: on a coarse pointer each row is at least 44 px, a Needs you row with its chip centred on the first line', async ({ page }) => {
    const { sheet, needsYou } = await openRailSheet(page);
    const check = async (rows: Locator): Promise<void> => {
      const measured = await chipOffsets(rows);
      expect(measured.length).toBeGreaterThan(0);
      for (const row of measured) {
        expect(row.offset, row.task).toBeLessThanOrEqual(0.5);
        expect(row.height, row.task).toBeGreaterThanOrEqual(44);
      }
    };
    // spec 024: prototype value (principal: the prototype wins): This frame's rows are the compact .fevents lines without a chip;
    // each keeps its 44 px target and opens the card detail.
    const frameRows = sheet.locator('app-this-frame [data-frame-event]');
    const heights = await frameRows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);
    await needsYou.click();
    await expect(sheet.locator('app-needs-you [data-needs-card]').first()).toBeVisible();
    await check(sheet.locator('app-needs-you [data-needs-card]'));
  });
});

// ─── The workspace board (spec 008, T143 / T144, ISC-129 / ISC-129.1) ───────────────────────────────────────────────
//
// `/w/:ws/board` against the planning goldens the stub serves (`core/fixtures/<ws>.planning.golden.json`) and the
// harbor dashboard golden (`harbor.golden.json`: the rows' type, reason and command). Every expectation is read from
// them, never restated. Each test runs in its own stub session, so the remembered `board-query` it writes never reaches
// a test in another worker, and resets it afterwards.
//
// - `bun run e2e -- board -g "workspace board"` (T143, ISC-129): one column per stage of the workflow in table order
//   (harbor's own table, lantern's default one), each head counting `stageCounts`, every card in its column with its
//   fields; at 820 the same columns in the board's own scroller.
// - `bun run e2e -- board -g "all columns"` (T26, ISC-141): at 1440 every column of the default workflow, head or stub,
//   lies whole inside the unscrolled board scroller, which needs no horizontal scrolling: lantern as its tree holds it
//   (no workflow.md) and harbor's cards under the default table (`PUT /api/__stub/workflow`).
// - `bun run e2e -- board -g filters` (T144, ISC-129.1): a filter and a swimlane group in the query, restored by a
//   reload and, from the remembered `board-query`, by the bare route; "Clear filters" keeps group and column; `?col`
//   picks the compact tier's one column.

/** The fields of a planning golden the board groups read (structural: `core/src/planning.ts` is not imported here). */
interface PlanningHolderGolden {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly stage: string | null;
  readonly priority: string;
  readonly main: boolean;
  readonly archived: boolean;
  readonly assignee: { readonly id: string } | null;
}
interface PlanningGolden {
  readonly stages: readonly string[];
  readonly stageCounts: Readonly<Record<string, number>>;
  readonly features: ReadonlyArray<{ readonly id: string; readonly name: string; readonly holders: readonly PlanningHolderGolden[] }>;
  readonly milestones: ReadonlyArray<{ readonly name: string; readonly specs: ReadonlyArray<{ readonly slug: string }> }>;
  readonly ideas: ReadonlyArray<{
    readonly slug: string;
    readonly title: string;
    readonly type: string | null;
    readonly priority: string;
    readonly feature: string | null;
    readonly milestone: string | null;
  }>;
}
type DashboardRowGolden = { readonly slug: string; readonly type: string | null; readonly nextCommand: string | null; readonly nextReason: string };

const fixture = (name: string): unknown => JSON.parse(readFileSync(fileURLToPath(new URL(`../../core/fixtures/${name}`, import.meta.url)), 'utf8'));
const PLANNING = {
  harbor: fixture('harbor.planning.golden.json') as PlanningGolden,
  lantern: fixture('lantern.planning.golden.json') as PlanningGolden,
} as const;
const HARBOR_ROWS = (fixture('harbor.golden.json') as { specs: readonly DashboardRowGolden[] }).specs;
const STAGE_WORDS = (JSON.parse(readFileSync(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8')) as { stages: Readonly<Record<string, string>> })
  .stages;

/** One card the golden puts on the board: an active holder in one of its stages, or a story in `idea`. */
interface ExpectedCard {
  readonly key: string;
  readonly stage: string;
  readonly feature: string | null;
}

/** Every card of a workspace's board, from its planning golden: the active holders (one per slug) and the ideas. */
function goldenCards(planning: PlanningGolden): ExpectedCard[] {
  const specs = new Map<string, ExpectedCard>();
  for (const feature of planning.features) {
    for (const holder of feature.holders) {
      if (holder.archived || holder.stage === null || !planning.stages.includes(holder.stage)) continue;
      const known = specs.get(holder.slug);
      if (known === undefined || (holder.main && known.feature === null)) {
        specs.set(holder.slug, { key: `spec:${holder.slug}`, stage: holder.stage, feature: holder.main ? feature.id : null });
      }
    }
  }
  const ideas = planning.stages.includes('idea')
    ? planning.ideas.map((idea): ExpectedCard => ({ key: `idea:${idea.slug}`, stage: 'idea', feature: idea.feature }))
    : [];
  return [...specs.values(), ...ideas];
}

function holderOf(planning: PlanningGolden, id: string): PlanningHolderGolden {
  const found = planning.features.flatMap((f) => f.holders).find((h) => h.id === id && !h.archived);
  if (!found) throw new Error(`the planning golden holds no active spec ${id}`);
  return found;
}
function rowOf(slug: string): DashboardRowGolden {
  const found = HARBOR_ROWS.find((r) => r.slug === slug);
  if (!found) throw new Error(`the harbor dashboard golden holds no row ${slug}`);
  return found;
}

const wsBoard = (ws: string): string => `/w/${ws}/board`;
/** The columns of the scroller (medium, wide): a column with cards or a stub, each carrying `data-col`. */
const SCROLLER_COLUMNS = 'app-board-page .scroller section[data-col]';
const WS_CARDS = 'app-board-page app-board-card';
const BAND_HEADS = 'app-board-page .band-head h3.bh';
/** A column's full count: in the head of a column with cards, beside the label of a stub. */
const columnCount = (page: Page, stage: string): Locator =>
  page.locator(`app-board-page section[data-col="${stage}"] > header > .count, app-board-page section[data-col="${stage}"][data-stub] > .count`);
const renderedKeys = (cards: Locator): Promise<string[]> => cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-key') ?? '').sort());

/** One stub session per test, reset before and after, so a remembered query never outlives its test. */
function useStubSession(prefix: string): () => string {
  let session = '';
  test.beforeEach(async ({ page, request }, info) => {
    session = `${prefix}-${info.testId}`;
    await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
    await request.post('/api/__stub/reset', { headers: { [SESSION_HEADER]: session } });
  });
  test.afterEach(async ({ request }) => {
    await request.post('/api/__stub/reset', { headers: { [SESSION_HEADER]: session } });
  });
  return () => session;
}

/** The scroller's columns in table order, each head showing its `stageCounts` entry. */
async function expectColumns(page: Page, planning: PlanningGolden): Promise<void> {
  await expect(page.locator(SCROLLER_COLUMNS)).toHaveCount(planning.stages.length);
  expect(await page.locator(SCROLLER_COLUMNS).evaluateAll((cols) => cols.map((c) => c.getAttribute('data-col')))).toEqual([...planning.stages]);
  for (const stage of planning.stages) {
    await expect(columnCount(page, stage), `count of ${stage}`).toHaveText(String(planning.stageCounts[stage] ?? 0));
  }
}

test.describe('workspace board', () => {
  useStubSession('workspace-board');

  test.describe('at 1440', () => {
    test.use(atWidth(1440));

    test('workspace board: harbor shows one column per workflow stage in table order, counts equal stageCounts', async ({ page }) => {
      const planning = PLANNING.harbor;
      await page.goto(wsBoard('harbor'));
      await expectColumns(page, planning);

      // The column heads are the one header: no separate stage strip above the board.
      await expect(page.locator('app-board-page ui-segmented[data-mode="strip"]')).toHaveCount(0);

      // Every card of the golden sits in its stage's column, once; a stage without one is a stub.
      const cards = goldenCards(planning);
      expect(cards.length).toBe(Object.values(planning.stageCounts).reduce((n, c) => n + c, 0));
      await expect(page.locator(WS_CARDS)).toHaveCount(cards.length);
      for (const stage of planning.stages) {
        const keys = cards.filter((c) => c.stage === stage).map((c) => c.key).sort();
        const column = page.locator(`${SCROLLER_COLUMNS}[data-col="${stage}"]`);
        if (keys.length === 0) await expect(column, `${stage} is a stub`).toHaveAttribute('data-stub', '');
        else expect(await renderedKeys(column.locator('app-board-card')), `cards in ${stage}`).toEqual(keys);
      }
    });

    test('workspace board: cards carry type glyph, number, title, priority, feature, milestone, assignee and the reason line', async ({ page }) => {
      const planning = PLANNING.harbor;
      await page.goto(wsBoard('harbor'));
      await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(planning).length);
      const cardIn = (stage: string, key: string): Locator => page.locator(`app-board-page section[data-col="${stage}"] app-board-card[data-key="${key}"]`);
      const accessiblePhrase = (card: Locator): Promise<string | null> => card.locator('ui-reason .visually-hidden').evaluate((el) => el.textContent);

      // 008 waits in close-pending: the reason line carries the row's phrase and no command chip (close-pending has none).
      const s008 = holderOf(planning, '008');
      const r008 = rowOf(s008.slug);
      const f008 = planning.features.find((f) => f.holders.some((h) => h.slug === s008.slug && h.main));
      const c008 = cardIn('close-pending', `spec:${s008.slug}`);
      await expect(c008).toHaveCount(1);
      await expect(c008.locator('ui-type-glyph')).toHaveAttribute('data-type', String(r008.type));
      await expect(c008.locator('.num')).toHaveText(s008.id);
      await expect(c008.locator('a.title')).toHaveText(s008.title);
      await expect(c008.locator('ui-priority')).toHaveAttribute('data-level', s008.priority);
      await expect(c008.locator('.chip.feat')).toHaveText(String(f008?.id));
      await expect(c008.locator('.chip.feat')).toHaveAttribute('title', `Feature ${String(f008?.id)}: ${String(f008?.name)}`);
      await expect(c008.locator('ui-actor-chip')).toHaveAttribute('data-kind', 'person');
      await expect(c008.locator('ui-actor-chip')).toContainText(String(s008.assignee?.id));
      expect(r008.nextCommand).toBeNull();
      await expect(c008.locator('ui-reason')).toHaveCount(1);
      expect(await accessiblePhrase(c008)).toBe(r008.nextReason);
      await expect(c008.locator('ui-reason ui-command-chip')).toHaveCount(0);

      // 006 is the P1 card; it waits in review with the row's phrase and command.
      const s006 = holderOf(planning, '006');
      const r006 = rowOf(s006.slug);
      expect(s006.priority).toBe('P1');
      const c006 = cardIn(String(s006.stage), `spec:${s006.slug}`);
      await expect(c006).toHaveCount(1);
      await expect(c006.locator('ui-priority')).toHaveAttribute('data-level', 'P1');
      await expect(c006.locator('ui-priority [role="img"]')).toHaveAccessibleName('priority P1');
      await expect(c006.locator('ui-priority [role="img"] > span')).toHaveText('P1');
      await expect(c006.locator('ui-type-glyph')).toHaveAttribute('data-type', String(r006.type));
      await expect(c006.locator('.num')).toHaveText(s006.id);
      await expect(c006.locator('a.title')).toHaveText(s006.title);
      expect(await accessiblePhrase(c006)).toBe(r006.nextReason);
      await expect(c006.locator('ui-reason ui-command-chip')).toContainText(String(r006.nextCommand));

      // A story in idea: the idea chip with its slug in place of a number, its type's glyph, its feature and milestone,
      // no assignee and no reason line (a story does not wait).
      const story = planning.ideas.find((i) => i.feature !== null && i.milestone !== null && i.type !== null);
      if (!story) throw new Error('the harbor planning golden holds no story with a type, a feature and a milestone');
      const cIdea = cardIn('idea', `idea:${story.slug}`);
      await expect(cIdea).toHaveCount(1);
      await expect(cIdea).toHaveAttribute('data-kind', 'idea');
      await expect(cIdea.locator('.idea .slug')).toHaveText(story.slug);
      await expect(cIdea.locator('.num')).toHaveCount(0);
      await expect(cIdea.locator('ui-type-glyph')).toHaveAttribute('data-type', String(story.type));
      await expect(cIdea.locator('a.title')).toHaveText(story.title);
      await expect(cIdea.locator('ui-priority')).toHaveAttribute('data-level', story.priority);
      await expect(cIdea.locator('.chip.feat')).toHaveText(String(story.feature));
      await expect(cIdea.locator('.chip.ms')).toHaveText(String(story.milestone));
      await expect(cIdea.locator('ui-actor-chip')).toHaveCount(0);
      await expect(cIdea.locator('ui-reason')).toHaveCount(0);

      // Every spec card: number, title, priority and main feature as the golden holds them, the milestone chip exactly
      // where a milestone lists the spec (the first in target order), the assignee chip exactly where one is set.
      const milestoneOf = new Map<string, string>();
      for (const m of planning.milestones) for (const s of m.specs) if (!milestoneOf.has(s.slug)) milestoneOf.set(s.slug, m.name);
      for (const feature of planning.features) {
        for (const holder of feature.holders.filter((h) => !h.archived && h.main && h.stage !== null)) {
          const card = cardIn(String(holder.stage), `spec:${holder.slug}`);
          await expect(card, holder.slug).toHaveCount(1);
          await expect(card.locator('.num'), holder.slug).toHaveText(holder.id);
          await expect(card.locator('a.title'), holder.slug).toHaveText(holder.title);
          await expect(card.locator('ui-priority'), holder.slug).toHaveAttribute('data-level', holder.priority);
          await expect(card.locator('.chip.feat'), holder.slug).toHaveText(feature.id);
          const milestone = milestoneOf.get(holder.slug);
          if (milestone === undefined) await expect(card.locator('.chip.ms'), holder.slug).toHaveCount(0);
          else await expect(card.locator('.chip.ms'), holder.slug).toHaveText(milestone);
          await expect(card.locator('ui-actor-chip'), holder.slug).toHaveCount(holder.assignee === null ? 0 : 1);
        }
      }
    });

    test('workspace board: lantern shows the default table’s columns with its counts', async ({ page }) => {
      const planning = PLANNING.lantern;
      await page.goto(wsBoard('lantern'));
      await expectColumns(page, planning);
      const cards = goldenCards(planning);
      await expect(page.locator(WS_CARDS)).toHaveCount(cards.length);
      for (const card of cards) {
        await expect(page.locator(`${SCROLLER_COLUMNS}[data-col="${card.stage}"] app-board-card[data-key="${card.key}"]`), card.key).toHaveCount(1);
      }
    });
  });

  test.describe('at 820', () => {
    test.use(atWidth(820));

    test('workspace board: at 820 the same columns sit in the board’s own scroller and the page never scrolls sideways', async ({ page }) => {
      const planning = PLANNING.harbor;
      await page.goto(wsBoard('harbor'));
      await expect(page.locator('app-board-page')).toHaveAttribute('data-tier', 'medium');
      await expectColumns(page, planning);
      const measured = await page.evaluate(() => {
        const scroller = document.querySelector<HTMLElement>('app-board-page .scroller');
        const root = document.scrollingElement ?? document.documentElement;
        return {
          scroller: scroller && { scroll: scroller.scrollWidth, client: scroller.clientWidth, overflowX: getComputedStyle(scroller).overflowX },
          page: { scroll: root.scrollWidth, client: root.clientWidth },
        };
      });
      if (!measured.scroller) throw new Error('the board renders no scroller at 820');
      expect(measured.scroller.scroll, 'the columns overflow the scroller').toBeGreaterThan(measured.scroller.client);
      expect(['auto', 'scroll']).toContain(measured.scroller.overflowX);
      expect(measured.page.scroll, 'page scrollWidth').toBe(measured.page.client);
    });
  });
});

/** The board columns of the default table, as core derives them when a workspace has no `specs/workflow.md`. */
const DEFAULT_STAGES = boardStages({ rows: DEFAULT_WORKFLOW, source: 'default', diagnostics: [] });
/** The default table as a `specs/workflow.md` text, so the stub can put harbor's cards on it. */
const DEFAULT_TABLE = [
  '| type | stages | code_review |',
  '|------|--------|-------------|',
  ...DEFAULT_WORKFLOW.map((row) => `| ${row.type} | ${row.stages.join(' · ')} | ${row.codeReview} |`),
].join('\n');

/**
 * Every column of the scroller against the scroller's visible box (its padding box, `clientLeft` to `clientWidth`):
 * a column with cards by its head, a stub by itself; each one that sticks out, with by how many pixels.
 */
async function columnFit(page: Page): Promise<{ scrollLeft: number; scrollWidth: number; clientWidth: number; outside: string[] }> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('app-board-page .scroller');
    if (!scroller) throw new Error('the board renders no scroller');
    const left = scroller.getBoundingClientRect().left + scroller.clientLeft;
    const right = left + scroller.clientWidth;
    const outside: string[] = [];
    for (const column of scroller.querySelectorAll<HTMLElement>('section[data-col]')) {
      const part = column.hasAttribute('data-stub') ? column : column.querySelector<HTMLElement>(':scope > header');
      if (!part) throw new Error(`column ${String(column.dataset['col'])} has no head`);
      const box = part.getBoundingClientRect();
      const over = Math.ceil(Math.max(box.right - right, left - box.left));
      if (over > 0) outside.push(`${String(column.dataset['col'])} +${String(over)}px`);
    }
    return { scrollLeft: scroller.scrollLeft, scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth, outside };
  });
}

test.describe('all columns', () => {
  const session = useStubSession('all-columns');
  test.use(atWidth(1440));

  async function expectAllColumnsInView(page: Page, cards: number): Promise<void> {
    await expect(page.locator('app-board-page')).toHaveAttribute('data-tier', 'wide');
    await expect(page.locator(SCROLLER_COLUMNS)).toHaveCount(DEFAULT_STAGES.length);
    expect(await page.locator(SCROLLER_COLUMNS).evaluateAll((cols) => cols.map((c) => c.getAttribute('data-col')))).toEqual([...DEFAULT_STAGES]);
    await expect(page.locator(WS_CARDS)).toHaveCount(cards);
    const fit = await columnFit(page);
    expect(fit.scrollLeft, 'the scroller starts unscrolled').toBe(0);
    expect(fit.outside, 'columns outside the visible board at 1440').toEqual([]);
    expect(fit.scrollWidth, 'the board needs no horizontal scrolling at 1440').toBeLessThanOrEqual(fit.clientWidth + 1);
  }

  test('all columns: lantern, on the default workflow, shows every column whole in the board at 1440', async ({ page }) => {
    expect(PLANNING.lantern.stages).toEqual([...DEFAULT_STAGES]);
    await page.goto(wsBoard('lantern'));
    await expectAllColumnsInView(page, goldenCards(PLANNING.lantern).length);
  });

  test('all columns: harbor’s cards on the default workflow show every column whole in the board at 1440', async ({ page }) => {
    const put = await page.request.put(`${WORKFLOW_PATH}?ws=harbor`, {
      data: DEFAULT_TABLE,
      headers: { [SESSION_HEADER]: session(), 'Content-Type': 'text/markdown' },
    });
    expect(put.status()).toBe(204);
    await page.goto(wsBoard('harbor'));
    const cards = goldenCards({ ...PLANNING.harbor, stages: DEFAULT_STAGES });
    expect(new Set(cards.map((c) => c.stage)).size, 'harbor fills most columns of the default table').toBeGreaterThan(DEFAULT_STAGES.length / 2);
    await expectAllColumnsInView(page, cards.length);
  });
});

/** The query the URL carries, order-free: the router writes the keys in its own order. */
const urlQuery = (page: Page): URLSearchParams => new URL(page.url()).searchParams;
const BOARD_QUERY_PATH = '/api/workspaces/harbor/board-query';
/** The toolbar (T163): a trigger per filter key opening its popover checkbox list, and the active selections as chips. */
const TRIGGER = (key: string): string => `app-board-filters [data-trigger="${key}"]`;
const FILTER_ROW = (key: string, value: string): string => `app-board-filters ui-popover[data-filter="${key}"] [data-value="${value}"]`;
const ACTIVE_CHIPS = 'app-board-filters [data-chip]';
const LANE_RADIOS = 'app-board-filters [data-group] ui-segmented [role="radio"]';

test.describe('filters', () => {
  const session = useStubSession('board-filters');

  test.describe('at 1440', () => {
    test.use(atWidth(1440));

    test('filters: a feature filter and its swimlanes go to the URL, survive a reload, and the bare route restores them', async ({ page, request }) => {
      const planning = PLANNING.harbor;
      const all = goldenCards(planning);
      const featured = planning.features.find((f) => all.filter((c) => c.feature === f.id).length >= 2);
      if (!featured) throw new Error('the harbor planning golden holds no feature with two cards');
      const shown = all.filter((c) => c.feature === featured.id);

      await page.goto(wsBoard('harbor'));
      await expect(page.locator(WS_CARDS)).toHaveCount(all.length);
      expect(urlQuery(page).toString(), 'nothing remembered yet: the bare route stays bare').toBe('');

      const trigger = page.locator(TRIGGER('feature'));
      const featureRow = page.locator(FILTER_ROW('feature', featured.id));
      const laneFeature = page.locator(LANE_RADIOS).filter({ hasText: 'Feature' });
      await trigger.click();
      await expect(featureRow).toBeVisible();
      await featureRow.click();
      await expect.poll(() => urlQuery(page).getAll('feature')).toEqual([featured.id]);
      // The list stays open for a second pick; Escape closes it and focus returns to its trigger.
      await expect(featureRow.locator('input[type="checkbox"]')).toBeChecked();
      await page.keyboard.press('Escape');
      await expect(featureRow).toBeHidden();
      await expect(trigger).toBeFocused();

      // Every query the page shows is remembered: the PUT of the last one carries filter and group.
      const saved = page.waitForRequest((req) => {
        if (req.method() !== 'PUT' || new URL(req.url()).pathname !== BOARD_QUERY_PATH) return false;
        const body = req.postDataJSON() as { query?: unknown };
        const query = new URLSearchParams(typeof body.query === 'string' ? body.query : '');
        return query.getAll('feature').join() === featured.id && query.get('group') === 'feature';
      });
      await laneFeature.click();
      await saved;
      await expect.poll(() => urlQuery(page).get('group')).toBe('feature');

      const expectFiltered = async (): Promise<void> => {
        await expect(trigger).toHaveText('Feature · 1');
        await expect(page.locator(ACTIVE_CHIPS)).toHaveCount(1);
        await expect(page.locator(ACTIVE_CHIPS)).toHaveAttribute('data-chip', `feature:${featured.id}`);
        await expect(laneFeature).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator(WS_CARDS)).toHaveCount(shown.length);
        expect(await renderedKeys(page.locator(WS_CARDS))).toEqual(shown.map((c) => c.key).sort());
        await expect(page.locator('app-board-filters [data-shown] > span')).toHaveText(`${String(shown.length)} of ${String(all.length)} cards`);
        // One band across the board, the feature's: its id, name and card count.
        const heads = page.locator(BAND_HEADS);
        await expect(heads).toHaveCount(1);
        await expect(heads.locator('.mono')).toHaveText(featured.id);
        await expect(heads.locator('.name')).toHaveText(featured.name);
        await expect(heads.locator('.n')).toHaveText(`${String(shown.length)} cards`);
        // A column with a shown card keeps its full count in the head; a column the filter emptied is a stub showing 0
        // and naming how many cards it hides.
        for (const stage of planning.stages) {
          if (shown.some((c) => c.stage === stage)) {
            await expect(columnCount(page, stage), `${stage} keeps its full count`).toHaveText(String(planning.stageCounts[stage] ?? 0));
            continue;
          }
          const hidden = all.filter((c) => c.stage === stage).length;
          const stub = page.locator(`${SCROLLER_COLUMNS}[data-col="${stage}"][data-stub]`);
          await expect(stub, `${stage} is a stub`).toHaveCount(1);
          await expect(columnCount(page, stage), `${stage} stub count`).toHaveText('0');
          await expect(stub.locator('.vnote'), `${stage} stub note`).toHaveText(hidden > 0 ? `${String(hidden)} hidden by filters` : 'empty');
        }
      };
      await expectFiltered();

      // A reload lands on the same URL and restores chips, lanes and bands from it.
      await page.reload();
      expect(urlQuery(page).getAll('feature')).toEqual([featured.id]);
      expect(urlQuery(page).get('group')).toBe('feature');
      await expectFiltered();

      // The stub holds the remembered query; the bare route restores it and replaces its URL with it.
      const answer = await request.get(BOARD_QUERY_PATH, { headers: { [SESSION_HEADER]: session() } });
      expect(answer.status()).toBe(200);
      const remembered = new URLSearchParams(((await answer.json()) as { query: string }).query);
      expect(remembered.getAll('feature')).toEqual([featured.id]);
      expect(remembered.get('group')).toBe('feature');
      await page.goto(wsBoard('harbor'));
      await expect.poll(() => urlQuery(page).get('group')).toBe('feature');
      expect(new URL(page.url()).pathname).toBe(wsBoard('harbor'));
      expect(urlQuery(page).getAll('feature')).toEqual([featured.id]);
      await expectFiltered();
    });

    test('filters: "Clear filters" drops every filter value and keeps the swimlane group and the column', async ({ page }) => {
      const planning = PLANNING.harbor;
      const all = goldenCards(planning);
      const featured = planning.features.find((f) => all.some((c) => c.feature === f.id));
      if (!featured) throw new Error('the harbor planning golden holds no feature with a card');
      const col = planning.stages.find((s) => s !== 'build' && (planning.stageCounts[s] ?? 0) > 0) ?? planning.stages[0] ?? 'idea';

      await page.goto(`${wsBoard('harbor')}?feature=${featured.id}&group=feature&col=${col}`);
      await expect(page.locator(WS_CARDS)).toHaveCount(all.filter((c) => c.feature === featured.id).length);
      await page.locator('app-board-filters [data-shown] [data-clear]').click();

      await expect.poll(() => urlQuery(page).getAll('feature')).toEqual([]);
      expect(urlQuery(page).get('group')).toBe('feature');
      expect(urlQuery(page).get('col')).toBe(col);
      await expect(page.locator(WS_CARDS)).toHaveCount(all.length);
      await expect(page.locator('app-board-filters [data-shown]')).toHaveCount(0);
      await expect(page.locator(TRIGGER('feature'))).toHaveText('Feature');
      await expect(page.locator(ACTIVE_CHIPS)).toHaveCount(0);
      await expect(page.locator(LANE_RADIOS).filter({ hasText: 'Feature' })).toHaveAttribute('aria-checked', 'true');
      // A band per feature holding a card, by milestone and then rank (spec 037, ISC-197), each feature once, and the band
      // without a feature last when a card has none.
      const ranked = [...new Set(featureOrder(planning as unknown as PlanningModel).flatMap((group) => group.ids))];
      const withCards = ranked.filter((id) => all.some((c) => c.feature === id));
      const heads = page.locator(BAND_HEADS);
      await expect(heads).toHaveCount(withCards.length + (all.some((c) => c.feature === null) ? 1 : 0));
      expect((await heads.locator('.mono').allTextContents()).map((t) => t.trim())).toEqual(withCards);
    });
  });

  test.describe('at 390', () => {
    test.use(atWidth(390));

    test('filters: ?col= picks the column the compact switch and the tray highlight, and the one column shown', async ({ page }) => {
      const planning = PLANNING.harbor;
      const all = goldenCards(planning);
      for (const col of planning.stages.filter((s) => s !== 'build')) {
        await page.goto(`${wsBoard('harbor')}?col=${col}`);
        await expect(page.locator('app-board-page')).toHaveAttribute('data-tier', 'compact');
        const checked = page.locator('app-board-page .colswitch ui-segmented [role="radio"][aria-checked="true"]');
        await expect(checked, col).toHaveCount(1);
        await expect(checked, col).toHaveText(`${String(STAGE_WORDS[col])} ${String(all.filter((c) => c.stage === col).length)}`);
        await expect(page.locator('app-board-page [data-tray] [data-drop-col][data-current]'), col).toHaveAttribute('data-drop-col', col);
        await expect(page.locator('app-board-page section.one'), col).toHaveAttribute('data-col', col);
        await expect(page.locator('app-board-page section.one app-board-card'), col).toHaveCount(all.filter((c) => c.stage === col).length);
      }
    });
  });
});

// ─── Who a card is assigned to (spec 008, T148, ISC-131) ────────────────────────────────────────────────────────────
//
// `bun run e2e -- board -g assignee`: every harbor card whose planning holder names an assignee shows it as
// `ui-actor-chip`, the raw `u:` id in mono until the actors route maps a name for it, and the spec's status block shows
// the same actor; a card without an assignee shows no chip. The ids come from `harbor.planning.golden.json` and
// `harbor.spec.golden.json`, the display names are synthetic.
//
// The agent case: core's `assigneeOf` gives a spec the actor of its newest open claim lock before its last event, and
// the card shows that one assignee, so an agent's lock replaces the person chip with the agent chip. The stub serves
// `…/planning` from a golden built without locks under every lock fixture, so that test takes the locks from the
// stub's `…/live` answer under the `activity` fixture, lets `assigneeOf` pick the assignee, and serves the planning
// tree with it through `page.route`.

/** An actor as a golden serializes it (`ActorRef`, structural). */
interface ActorGolden {
  readonly raw: string;
  readonly kind: string;
  readonly id: string;
}
/** The main holder of one spec card, with the assignee's full ref. */
interface AssignedHolder {
  readonly id: string;
  readonly slug: string;
  readonly assignee: ActorGolden | null;
}
const ASSIGNEE_PLANNING = fixture('harbor.planning.golden.json') as {
  readonly stages: readonly string[];
  readonly features: ReadonlyArray<{
    readonly holders: ReadonlyArray<AssignedHolder & { readonly main: boolean; readonly archived: boolean; readonly stage: string | null }>;
  }>;
};
const SPEC_HEADS = fixture('harbor.spec.golden.json') as Readonly<Record<string, { readonly head: { readonly assignee: ActorGolden | null } }>>;
/** Every spec card of the harbor board, from its main holder (the holder `buildBoard` picks for the card). */
const SPEC_CARDS: readonly AssignedHolder[] = ASSIGNEE_PLANNING.features.flatMap((f) =>
  f.holders
    .filter((h) => h.main && !h.archived && h.stage !== null && ASSIGNEE_PLANNING.stages.includes(h.stage))
    .map((h) => ({ id: h.id, slug: h.slug, assignee: h.assignee })),
);
const PERSON_IDS = [...new Set(SPEC_CARDS.flatMap((c) => (c.assignee?.kind === 'person' ? [c.assignee.id] : [])))].sort();
/** One synthetic display name per person id of the golden. */
const NAMES = new Map(PERSON_IDS.map((id, i) => [id, `Sample Person ${String(i + 1)}`]));
const ACTORS_PATH = '/api/actors';
const PLANNING_PATH = '/api/workspaces/harbor/planning';

const cardOf = (page: Page, card: AssignedHolder): Locator => page.locator(`${WS_CARDS}[data-key="spec:${card.slug}"]`);
const statusChip = (page: Page): Locator => page.locator('app-status-block [data-assignee] ui-actor-chip');
const nameFor = (actor: ActorGolden, named: boolean): string | null => (named && actor.kind === 'person' ? (NAMES.get(actor.id) ?? null) : null);

/** The chip names `actor`: its kind, the raw ref as its title, the mapped name as text or else the id in mono. */
async function expectActor(chip: Locator, actor: ActorGolden, name: string | null): Promise<void> {
  await expect(chip).toHaveCount(1);
  await expect(chip).toHaveAttribute('data-kind', actor.kind);
  await expect(chip).toHaveAttribute('title', actor.raw);
  const label = chip.locator('.label');
  await expect(label).toHaveText(name ?? actor.id);
  if (name === null) await expect(label).toHaveClass(/\bmono\b/u);
  else await expect(label).not.toHaveClass(/\bmono\b/u);
}

/** Every harbor card as the golden assigns it (person names resolved when `named`), no chip where nobody is. */
async function expectCards(page: Page, named: boolean): Promise<void> {
  await page.goto(wsBoard('harbor'));
  await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(PLANNING.harbor).length);
  for (const card of SPEC_CARDS) {
    const chip = cardOf(page, card).locator('ui-actor-chip');
    if (card.assignee === null) await expect(chip, card.slug).toHaveCount(0);
    else await expectActor(chip, card.assignee, nameFor(card.assignee, named));
  }
  await expect(page.locator(`${WS_CARDS}[data-kind="idea"] ui-actor-chip`)).toHaveCount(0);
}

/** The status block of every spec card shows the card's assignee; an unassigned spec says so and shows no chip. */
async function expectStatusBlocks(page: Page, named: boolean): Promise<void> {
  for (const card of SPEC_CARDS) {
    expect(SPEC_HEADS[`specs/${card.slug}`]?.head.assignee?.id ?? null, `${card.slug}: head and holder agree`).toBe(card.assignee?.id ?? null);
    await page.goto(`/w/harbor/s/${card.id}/status`);
    if (card.assignee === null) {
      await expect(page.locator('app-status-block [data-unassigned]'), card.slug).toBeVisible();
      await expect(statusChip(page), card.slug).toHaveCount(0);
    } else {
      await expectActor(statusChip(page), card.assignee, nameFor(card.assignee, named));
    }
  }
}

test.describe('assignee', () => {
  const session = useStubSession('board-assignee');
  test.use(atWidth(1440));

  /** `PUT /api/actors` with the whole list: one synthetic name per person id of the golden. */
  const saveNames = async (request: APIRequestContext): Promise<void> => {
    const list = PERSON_IDS.map((id) => ({ id, displayName: NAMES.get(id) ?? id, gitIdentities: [] }));
    const saved = await request.put(ACTORS_PATH, { data: list, headers: { [SESSION_HEADER]: session() } });
    expect(saved.status()).toBe(200);
    expect(await saved.json()).toEqual(list);
  };

  test('assignee: a card whose spec has an assignee shows the raw id, its status block the same; a card without one shows no chip', async ({ page }) => {
    expect(PERSON_IDS.length, 'the harbor golden assigns a person').toBeGreaterThan(0);
    expect(SPEC_CARDS.some((c) => c.assignee === null), 'the harbor golden has an unassigned card').toBe(true);
    await expectCards(page, false);
    await expectStatusBlocks(page, false);
  });

  test('assignee: a name saved in the actors route shows on card and status block; after a reset the raw id again', async ({ page, request }) => {
    await saveNames(request);
    await expectCards(page, true);
    await expectStatusBlocks(page, true);

    // The mapping dropped, as a deleted data directory would: the raw id again on both surfaces.
    expect((await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session() } })).status()).toBe(204);
    expect(await (await request.get(ACTORS_PATH, { headers: { [SESSION_HEADER]: session() } })).json()).toEqual([]);
    await expectCards(page, false);
    await expectStatusBlocks(page, false);
  });

  test('assignee: a card an agent works shows the agent chip in place of the person chip, never a mapped name', async ({ page, request }) => {
    const headers = { [LOCKS_HEADER]: 'activity', [SESSION_HEADER]: session() };
    // Each spec's assignee by core's rule over the stub's live frame under the `activity` locks.
    const worked = new Map<string, ActorGolden>();
    for (const card of SPEC_CARDS) {
      const answer = await request.get(`/api/workspaces/harbor/specs/${card.id}/live`, { headers });
      expect(answer.status(), card.slug).toBe(200);
      const frame = (await answer.json()) as LiveFrame;
      const actor = assigneeOf({ claims: frame.cards.map((c) => c.claim), locks: frame.locks });
      if (actor?.kind === 'agent') worked.set(card.slug, actor);
    }
    expect(worked.size, 'the activity locks put an agent on a harbor spec').toBeGreaterThan(0);
    for (const slug of worked.keys()) {
      expect(SPEC_CARDS.find((c) => c.slug === slug)?.assignee?.kind, `${slug}: a person's card without the lock`).toBe('person');
    }

    await page.route(
      (url) => url.pathname === PLANNING_PATH,
      async (route) => {
        const sent = Object.entries(route.request().headers()).filter(([name]) => name.toLowerCase() !== 'if-none-match');
        const response = await route.fetch({ headers: Object.fromEntries(sent) });
        const body = (await response.json()) as { features: Array<{ holders: Array<{ slug: string; assignee: unknown }> }> };
        for (const feature of body.features) for (const holder of feature.holders) holder.assignee = worked.get(holder.slug) ?? holder.assignee;
        await route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(body) });
      },
    );
    await page.setExtraHTTPHeaders({ [LOCKS_HEADER]: 'activity' });
    await saveNames(request);

    await page.goto(wsBoard('harbor'));
    await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(PLANNING.harbor).length);
    for (const card of SPEC_CARDS) {
      const chip = cardOf(page, card).locator('ui-actor-chip');
      const agent = worked.get(card.slug);
      if (agent !== undefined) {
        // One chip, the agent's: the bot glyph, the word "agent" for assistive tech, the session id in mono.
        await expectActor(chip, agent, null);
        await expect(chip.locator('ui-icon')).toHaveCount(1);
        await expect(chip.locator('.vh')).toHaveText('agent');
        await expect(cardOf(page, card).locator('ui-actor-chip[data-kind="person"]'), card.slug).toHaveCount(0);
      } else if (card.assignee === null) {
        await expect(chip, card.slug).toHaveCount(0);
      } else {
        await expectActor(chip, card.assignee, nameFor(card.assignee, true));
      }
    }
  });
});

// ─── Moving a card (spec 008, T146, ISC-130) ─────────────────────────────────────────────────────────────────────────
//
// `bun run e2e -- board -g drag`: on harbor at 1440 a mouse drag of a card's grip onto a column core's table admits
// sends exactly one transition, lands the card there, shows the toast and moves both column counts by one; a drag onto
// a column the row does not list comes back 422 from the stub, the card stays in its column and the refusal notice
// under it carries the stub's phrase and command, without a toast. The grip opens "Move to…" (a popover at 1440, a
// sheet at 390) with each stage's hint, an allowed entry sends one transition, Escape gives focus back to the grip;
// Shift+→ on a focused card moves it to its next allowed stage. Which moves the stub accepts is web/CLAUDE.md
// "Driving the board writes from an e2e spec": 002 is held by the default `activity` lock, so the moved cards are
// 003, 005 and 006, whose stages and allowed targets come from the planning golden and core's table.

const HARBOR_WORKFLOW = (PLANNING.harbor as unknown as { readonly workflow: Workflow }).workflow;
const HARBOR_STAGES = PLANNING.harbor.stages as readonly WorkflowStage[];
const TRANSITION_PATH = /^\/api\/workspaces\/harbor\/specs\/[^/]+\/transition$/u;
const ALLOCATE_PATH = /^\/api\/workspaces\/harbor\/ideas\/[^/]+\/allocate$/u;
const TOAST = 'ui-toast .alert';
const MOVE_MENU = '[data-move-menu]';

/** A spec card of the harbor board as the goldens hold it: number, slug, stage and type. */
interface MovableSpec {
  readonly id: string;
  readonly slug: string;
  readonly key: string;
  readonly stage: WorkflowStage;
  readonly type: SpecType;
}
function movable(id: string): MovableSpec {
  const holder = holderOf(PLANNING.harbor, id);
  const type = rowOf(holder.slug).type as SpecType | null;
  if (holder.stage === null || type === null) throw new Error(`harbor ${id} has no stage or no type`);
  return { id, slug: holder.slug, key: `spec:${holder.slug}`, stage: holder.stage as WorkflowStage, type };
}
/** The columns core's table admits from the spec's stage, in board order (the board's `dropTargetsOf`). */
const targetsOf = (spec: MovableSpec): WorkflowStage[] =>
  HARBOR_STAGES.filter((s) => s !== spec.stage && allowedTransition(spec.stage, s, spec.type, HARBOR_WORKFLOW));
/** The hint the design gives a column for the lifted card: current, allowed, a fixed gate, or not next. */
const hintOf = (spec: MovableSpec, stage: WorkflowStage): string =>
  stage === spec.stage ? 'current' : targetsOf(spec).includes(stage) ? 'allowed' : FIXED_GATES.includes(stage) ? 'gate' : 'not-next';
/** A column the row does not list and that is no fixed gate, so the stub's 422 is the workflow's refusal. */
const notNextOf = (spec: MovableSpec): WorkflowStage => {
  const stage = HARBOR_STAGES.find((s) => hintOf(spec, s) === 'not-next');
  if (stage === undefined) throw new Error(`harbor ${spec.id} has no not-next column`);
  return stage;
};

const columnOf = (page: Page, stage: string): Locator => page.locator(`app-board-page section[data-col="${stage}"]`);
const cardIn = (page: Page, stage: string, key: string): Locator => columnOf(page, stage).locator(`app-board-card[data-key="${key}"]`);
const gripOf = (page: Page, key: string): Locator => page.locator(`app-board-page app-board-card[data-key="${key}"] [data-grip]`);
const noticeOf = (page: Page, stage: string, key: string): Locator =>
  columnOf(page, stage).locator('li', { has: page.locator(`app-board-card[data-key="${key}"]`) }).locator('app-refusal-notice');

/** Every POST the page sends (the app's own `fetch` included), in order. */
function postsOf(page: Page): Request[] {
  const posts: Request[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST') posts.push(req);
  });
  return posts;
}
const pathsOf = (posts: readonly Request[], path: RegExp): string[] => posts.map((r) => new URL(r.url()).pathname).filter((p) => path.test(p));
const answerTo = (page: Page, path: RegExp): Promise<PlaywrightResponse> =>
  page.waitForResponse((r) => path.test(new URL(r.url()).pathname) && r.request().method() === 'POST');

/**
 * A mouse drag as a person makes it: down on the grip, a few moves past the CDK's threshold (`dragStartDelay` is 0 for
 * a mouse), then over the target column, where `whileOver` may look at the hints before the button is released.
 */
async function mouseDrag(page: Page, grip: Locator, target: Locator, whileOver?: () => Promise<void>): Promise<void> {
  await grip.scrollIntoViewIfNeeded();
  const from = await grip.boundingBox();
  const to = await target.boundingBox();
  if (from === null || to === null) throw new Error('the grip or the target column is not rendered');
  const x0 = from.x + from.width / 2;
  const y0 = from.y + from.height / 2;
  const x1 = to.x + to.width / 2;
  const y1 = to.y + Math.min(to.height / 2, 96);
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 8, y0 + 8, { steps: 4 });
  await page.mouse.move(x1, y1, { steps: 16 });
  await page.mouse.move(x1 + 2, y1 + 2, { steps: 2 });
  if (whileOver) await whileOver();
  await page.mouse.up();
}

test.describe('drag', () => {
  useStubSession('board-drag');

  test.describe('at 1440', () => {
    test.use(atWidth(1440));

    test('drag: a mouse drag onto an allowed column sends one transition, moves the card, shows the toast and moves both counts', async ({ page }) => {
      const spec = movable('006');
      const to = targetsOf(spec)[0];
      if (to === undefined) throw new Error(`harbor ${spec.id} has no allowed target`);
      const counts = PLANNING.harbor.stageCounts;
      const posts = postsOf(page);
      await page.goto(wsBoard('harbor'));
      await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(PLANNING.harbor).length);
      await expect(cardIn(page, spec.stage, spec.key)).toHaveCount(1);
      await expect(page.locator(TOAST)).toHaveCount(0);

      const answered = answerTo(page, TRANSITION_PATH);
      await mouseDrag(page, gripOf(page, spec.key), columnOf(page, to), async () => {
        // While lifted, every column says what a drop there would be.
        for (const stage of HARBOR_STAGES) await expect(columnOf(page, stage), `hint on ${stage}`).toHaveAttribute('data-drop', hintOf(spec, stage));
      });
      const answer = await answered;
      expect(answer.status()).toBe(200);
      expect(answer.request().postDataJSON()).toMatchObject({ to });

      await expect(cardIn(page, to, spec.key)).toHaveCount(1);
      await expect(cardIn(page, spec.stage, spec.key)).toHaveCount(0);
      await expect(page.locator(TOAST)).toHaveText(`${spec.id} → ${String(STAGE_WORDS[to])}`);
      await expect(columnCount(page, spec.stage)).toHaveText(String((counts[spec.stage] ?? 0) - 1));
      await expect(columnCount(page, to)).toHaveText(String((counts[to] ?? 0) + 1));
      // A reload shows the session's moved tree; the drag sent one write and nothing else.
      await page.reload();
      await expect(cardIn(page, to, spec.key)).toHaveCount(1);
      await expect(columnCount(page, to)).toHaveText(String((counts[to] ?? 0) + 1));
      expect(pathsOf(posts, TRANSITION_PATH)).toEqual([`/api/workspaces/harbor/specs/${spec.id}/transition`]);
      expect(posts).toHaveLength(1);
    });

    test('drag: a drop the workflow refuses (422) springs the card back, the notice under it names the reason and the command, no toast', async ({ page }) => {
      const spec = movable('006');
      const to = notNextOf(spec);
      const counts = PLANNING.harbor.stageCounts;
      const posts = postsOf(page);
      await page.goto(wsBoard('harbor'));
      await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(PLANNING.harbor).length);

      const answered = answerTo(page, TRANSITION_PATH);
      await mouseDrag(page, gripOf(page, spec.key), columnOf(page, to), async () => {
        await expect(columnOf(page, to)).toHaveAttribute('data-drop', 'not-next');
        await expect(columnOf(page, to).locator('.drop-hint[data-hint="not-next"]')).toHaveText(`not next from ${String(STAGE_WORDS[spec.stage])}`);
      });
      const answer = await answered;
      expect(answer.status(), 'the stub refuses a move the row does not list').toBe(422);
      const refused = (await answer.json()) as { error: string; reason: string; command: string | null };
      expect(refused.error).toBe('transition-refused');
      expect(refused.command, 'the stub names the spec’s next command').not.toBeNull();

      // Back in its own column, the counts as the golden holds them.
      const card = cardIn(page, spec.stage, spec.key);
      await expect(card).toHaveCount(1);
      await expect(cardIn(page, to, spec.key)).toHaveCount(0);
      await expect(columnCount(page, spec.stage)).toHaveText(String(counts[spec.stage] ?? 0));
      await expect(columnCount(page, to)).toHaveText(String(counts[to] ?? 0));

      // The notice sits in the card's own list item, under the card.
      const notice = noticeOf(page, spec.stage, spec.key);
      await expect(notice).toHaveAttribute('data-refusal', 'refused');
      await expect(notice.locator('[data-head]')).toHaveText(`Not moved — ${spec.id} cannot enter ${String(STAGE_WORDS[to])}`);
      await expect(notice.locator('ui-reason .phrase')).toHaveText(refused.reason);
      await expect(notice.locator('ui-reason ui-command-chip')).toContainText(String(refused.command));
      await expect(page.locator(TOAST)).toHaveCount(0);
      expect(pathsOf(posts, TRANSITION_PATH)).toHaveLength(1);

      // ✕ dismisses it; the card stays.
      await notice.locator('[data-dismiss]').click();
      await expect(notice).toHaveCount(0);
      await expect(card).toHaveCount(1);
    });

    test('drag: the grip opens “Move to…” as a popover with every stage’s hint; Escape returns focus; an allowed entry moves the card', async ({ page }) => {
      const spec = movable('003');
      const to = targetsOf(spec)[0];
      if (to === undefined) throw new Error(`harbor ${spec.id} has no allowed target`);
      const posts = postsOf(page);
      await page.goto(wsBoard('harbor'));
      await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(PLANNING.harbor).length);

      const grip = gripOf(page, spec.key);
      await expect(grip).toHaveAttribute('aria-haspopup', 'dialog');
      await expect(grip).toHaveAccessibleName(`Move ${spec.id}`);
      await grip.focus();
      await page.keyboard.press('Enter');
      const menu = page.locator(MOVE_MENU);
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('data-surface', 'popover');
      const entries = menu.locator('[data-move-to]');
      expect(await entries.evaluateAll((els) => els.map((el) => el.getAttribute('data-move-to')))).toEqual([...HARBOR_STAGES]);
      for (const stage of HARBOR_STAGES) {
        const entry = menu.locator(`[data-move-to="${stage}"]`);
        const hint = hintOf(spec, stage);
        await expect(entry, stage).toHaveAttribute('data-hint', hint);
        if (hint === 'current') await expect(entry, stage).toHaveAttribute('aria-current', 'true');
        else await expect(entry, stage).not.toHaveAttribute('aria-current');
        if (hint === 'allowed') await expect(entry, stage).not.toHaveAttribute('aria-disabled');
        else await expect(entry, stage).toHaveAttribute('aria-disabled', 'true');
      }

      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(grip).toBeFocused();
      expect(posts).toHaveLength(0);

      // A disabled entry sends nothing; the allowed one sends the one transition and the card lands.
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      // `aria-disabled`, not `disabled`: the entry stays focusable so its reason is read, and Enter on it does nothing.
      await menu.locator(`[data-move-to="${notNextOf(spec)}"]`).focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      expect(posts).toHaveLength(0);
      const answered = answerTo(page, TRANSITION_PATH);
      await menu.locator(`[data-move-to="${to}"]`).click();
      expect((await answered).status()).toBe(200);
      await expect(menu).toHaveCount(0);
      await expect(cardIn(page, to, spec.key)).toHaveCount(1);
      await expect(cardIn(page, spec.stage, spec.key)).toHaveCount(0);
      await expect(page.locator(TOAST)).toHaveText(`${spec.id} → ${String(STAGE_WORDS[to])}`);
      await expect(gripOf(page, spec.key)).toBeFocused();
      expect(pathsOf(posts, TRANSITION_PATH)).toEqual([`/api/workspaces/harbor/specs/${spec.id}/transition`]);
      expect(posts).toHaveLength(1);
    });

    test('drag: Shift+ArrowRight on a focused card moves it to its next allowed stage with one transition', async ({ page }) => {
      const spec = movable('005');
      const at = HARBOR_STAGES.indexOf(spec.stage);
      const to = HARBOR_STAGES.slice(at + 1).find((s) => targetsOf(spec).includes(s));
      if (to === undefined) throw new Error(`harbor ${spec.id} has no allowed stage to its right`);
      const posts = postsOf(page);
      await page.goto(wsBoard('harbor'));
      await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(PLANNING.harbor).length);

      await cardIn(page, spec.stage, spec.key).locator('a.title').focus();
      const answered = answerTo(page, TRANSITION_PATH);
      await page.keyboard.press('Shift+ArrowRight');
      const answer = await answered;
      expect(answer.status()).toBe(200);
      expect(answer.request().postDataJSON()).toMatchObject({ to });
      await expect(cardIn(page, to, spec.key)).toHaveCount(1);
      await expect(cardIn(page, spec.stage, spec.key)).toHaveCount(0);
      await expect(page.locator(MOVE_MENU)).toHaveCount(0);
      await expect(gripOf(page, spec.key)).toBeFocused();
      expect(pathsOf(posts, TRANSITION_PATH)).toEqual([`/api/workspaces/harbor/specs/${spec.id}/transition`]);
      expect(posts).toHaveLength(1);
    });
  });

  test.describe('at 390', () => {
    test.use(atWidth(390));

    test('drag: at 390 “Move to…” is a bottom sheet; Escape closes it and focus returns to the grip', async ({ page }) => {
      const spec = movable('006');
      const posts = postsOf(page);
      await page.goto(`${wsBoard('harbor')}?col=${spec.stage}`);
      await expect(page.locator('app-board-page')).toHaveAttribute('data-tier', 'compact');
      const grip = gripOf(page, spec.key);
      await grip.click();
      const menu = page.locator(MOVE_MENU);
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('data-surface', 'sheet');
      for (const stage of HARBOR_STAGES) await expect(menu.locator(`[data-move-to="${stage}"]`), stage).toHaveAttribute('data-hint', hintOf(spec, stage));
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(grip).toBeFocused();
      expect(posts).toHaveLength(0);
    });
  });
});

// ─── Allocating a story (spec 008, T147, ISC-130.2) ──────────────────────────────────────────────────────────────────
//
// `bun run e2e -- board -g allocate`: a story dragged (or moved through "Move to…") onto the first stage of its type
// opens the allocation dialog naming the folder `specs/NNN-<slug>/`, the files it writes and the story file it removes,
// all from the contract's `WRITE_PATHS.allocate`. "Not yet" sends nothing; Allocate sends exactly one allocation and
// opens the new spec the stub answers; `registry-webhooks`, which the story index does not name, comes back 422
// `not-in-index`: the notice under its card, no navigation.

const STORY_OK = 'console-audit-log';
const STORY_UNINDEXED = 'registry-webhooks';
const DIALOG = '[data-allocate-dialog]';

interface StoryCard {
  readonly slug: string;
  readonly key: string;
  readonly first: WorkflowStage;
  readonly path: string;
}
function storyOf(slug: string): StoryCard {
  const idea = (PLANNING.harbor.ideas as ReadonlyArray<{ slug: string; type: string | null; path?: string }>).find((i) => i.slug === slug);
  if (idea?.type === undefined || idea.type === null || idea.path === undefined) throw new Error(`the harbor planning golden holds no typed story ${slug}`);
  const first = workflowStagesOf(idea.type as SpecType, HARBOR_WORKFLOW)[0];
  if (first === undefined) throw new Error(`the ${idea.type} row has no first stage`);
  return { slug, key: `idea:${slug}`, first, path: idea.path };
}

/** The dialog names the folder, the files and the story file of `WRITE_PATHS.allocate`, the number left open. */
async function expectAllocateDialog(page: Page, story: StoryCard): Promise<Locator> {
  const paths = writePathsOf('allocate', `NNN-${story.slug}`, story.slug);
  const folder = String(paths.creates);
  expect(folder).toBe(`specs/NNN-${story.slug}/`);
  expect(paths.removes).toEqual([story.path]);
  const dialog = page.locator(DIALOG);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('data-slug', story.slug);
  await expect(dialog.locator('[data-allocate-folder]')).toHaveText(folder);
  await expect(dialog.locator('[data-allocate-file]')).toHaveText(paths.writes.map((p) => p.slice(folder.length)));
  await expect(dialog.locator('[data-allocate-number]')).toBeVisible();
  await expect(dialog.locator('[data-allocate-story]')).toHaveText(story.path);
  return dialog;
}

test.describe('allocate', () => {
  useStubSession('board-allocate');
  test.use(atWidth(1440));

  test('allocate: a story dropped on the first stage of its type, or moved there from the menu, opens the dialog; Not yet sends nothing; Allocate sends one and opens the new spec', async ({ page }) => {
    const story = storyOf(STORY_OK);
    const posts = postsOf(page);
    await page.goto(wsBoard('harbor'));
    await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(PLANNING.harbor).length);
    await expect(cardIn(page, 'idea', story.key)).toHaveCount(1);
    const dropStory = (): Promise<void> =>
      mouseDrag(page, gripOf(page, story.key), columnOf(page, story.first), async () => {
        await expect(columnOf(page, story.first)).toHaveAttribute('data-drop', 'allowed');
      });

    // A drop asks; "Not yet" closes the dialog and sends nothing.
    await dropStory();
    await (await expectAllocateDialog(page, story)).locator('[data-allocate-cancel]').click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(cardIn(page, 'idea', story.key)).toHaveCount(1);
    expect(posts, 'Not yet sends no request').toHaveLength(0);

    // "Move to…": the first stage's entry asks the same; "Not yet" gives focus back to the grip.
    await gripOf(page, story.key).click();
    await expect(page.locator(MOVE_MENU)).toHaveAttribute('data-surface', 'popover');
    const entry = page.locator(`${MOVE_MENU} [data-move-to="${story.first}"]`);
    await expect(entry).toHaveAttribute('data-hint', 'allowed');
    await entry.click();
    await expect(page.locator(MOVE_MENU)).toHaveCount(0);
    await (await expectAllocateDialog(page, story)).locator('[data-allocate-cancel]').click();
    await expect(page.locator(DIALOG)).toHaveCount(0);
    await expect(gripOf(page, story.key)).toBeFocused();
    expect(posts, 'Not yet sends no request').toHaveLength(0);

    // A drop again, and Allocate: one allocation, then the new spec's page.
    await dropStory();
    await expectAllocateDialog(page, story);
    const answered = answerTo(page, ALLOCATE_PATH);
    await page.locator(`${DIALOG} [data-allocate-confirm]`).click();
    const answer = await answered;
    expect(answer.status()).toBe(200);
    const written = (await answer.json()) as { id: string; folder: string };
    expect(written.folder).toBe(`specs/${written.id}-${story.slug}/`);
    await expect(page).toHaveURL(new RegExp(`/w/harbor/s/${written.id}(?:[/?#]|$)`, 'u'));
    expect(pathsOf(posts, ALLOCATE_PATH)).toEqual([`/api/workspaces/harbor/ideas/${story.slug}/allocate`]);
    expect(posts).toHaveLength(1);
  });

  test('allocate: a story the index does not name comes back not-in-index; the notice stays under its card and the page does not navigate', async ({ page }) => {
    const story = storyOf(STORY_UNINDEXED);
    const posts = postsOf(page);
    await page.goto(wsBoard('harbor'));
    await expect(page.locator(WS_CARDS)).toHaveCount(goldenCards(PLANNING.harbor).length);

    await mouseDrag(page, gripOf(page, story.key), columnOf(page, story.first));
    await expectAllocateDialog(page, story);
    const answered = answerTo(page, ALLOCATE_PATH);
    await page.locator(`${DIALOG} [data-allocate-confirm]`).click();
    const answer = await answered;
    expect(answer.status()).toBe(422);
    expect(await answer.json()).toMatchObject({ error: 'allocate-refused', reason: 'not-in-index' });

    await expect(page.locator(DIALOG)).toHaveCount(0);
    const notice = noticeOf(page, 'idea', story.key);
    await expect(notice).toHaveAttribute('data-refusal', 'unallocated');
    await expect(notice.locator('[data-head]')).toHaveText(`Not allocated — ${story.slug} stays an idea`);
    await expect(notice.locator('ui-reason .phrase')).toHaveText(`The ideas index specs/ideas/README.md does not name ${story.slug}`);
    await expect(cardIn(page, 'idea', story.key)).toHaveCount(1);
    await expect(page).toHaveURL(/\/w\/harbor\/board(?:\?|$)/u);
    await expect(page.locator(TOAST)).toHaveCount(0);
    expect(pathsOf(posts, ALLOCATE_PATH)).toHaveLength(1);
    expect(posts).toHaveLength(1);
  });
});

// principal 2026-10-13: the column heads are the board's one header and stay on screen while the cards scroll, in the
// swimlane views too, one head high; any column folds and opens by hand, the choice in the URL (`?fold=`, `?open=`).
test.describe('column heads', () => {
  useStubSession('board-heads');
  test.use({ viewport: { width: 1440, height: 640 } });

  for (const group of ['feature', 'milestone'] as const) {
    test(`heads: with ${group} swimlanes the heads stay at the scroller's top, one head high, while the bands scroll`, async ({ page }) => {
      await page.goto(`${wsBoard('harbor')}?group=${group}`);
      const scroller = page.locator('app-board-page .scroller');
      await expect(page.locator('app-board-page .band-head').first()).toBeVisible();
      const head = page.locator('app-board-page .grid[data-grouped] > section.col').first();
      const before = await head.boundingBox();
      if (before === null) throw new Error('no column section in the grouped grid');
      expect(before.height, 'the sticky head row is one head high').toBeLessThanOrEqual(48);
      const scrolled = await scroller.evaluate((el) => {
        el.scrollTop = 160;
        return el.scrollTop;
      });
      expect(scrolled, 'the bands are taller than the board, so the scroller scrolls').toBeGreaterThan(0);
      // Stuck flush with the scroller's top edge: no gap above the head through which a card would show.
      const top = Math.round((await scroller.boundingBox())?.y ?? -1);
      await expect.poll(async () => Math.round((await head.boundingBox())?.y ?? -1)).toBe(top);
      const covered = await scroller.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const probes = [24, Math.round(r.width / 2), r.width - 40].map((x) => document.elementFromPoint(r.left + x, r.top + 4));
        return probes.every((hit) => hit !== null && hit.closest('.grid[data-grouped] > section') !== null);
      });
      expect(covered, 'only column heads at the scroller top, no band or card').toBe(true);
    });
  }

  test('heads: a column with cards folds from its head, an empty one opens from its stub, both written to the URL', async ({ page }) => {
    await page.goto(wsBoard('harbor'));
    await page.locator('app-board-page section[data-col="review"] .head [data-fold-toggle]').click();
    await expect(page).toHaveURL(/fold=review/);
    await expect(page.locator('app-board-page section[data-col="review"]')).toHaveAttribute('data-stub', '');
    const stub = page.locator('app-board-page section[data-stub]:not([data-col="review"])').first();
    const stage = await stub.getAttribute('data-col');
    await stub.locator('[data-fold-toggle]').click();
    await expect(page).toHaveURL(new RegExp(`open=${stage ?? ''}`));
    await expect(page.locator(`app-board-page section[data-col="${stage ?? ''}"]`)).not.toHaveAttribute('data-stub', '');
    await page.reload();
    await expect(page.locator('app-board-page section[data-col="review"]')).toHaveAttribute('data-stub', '');
  });
});
