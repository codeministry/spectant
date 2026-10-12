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
import type { CardState, Frame, LiveFrame } from '../../core/src/files.ts';
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';

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
/** Every card of the board: the lanes, and at wide the operator steps in the shell rail's "Your steps" (T88). */
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
      const card = page.locator(`${CARDS}[data-state="${state}"]`).first();
      await expect(card.locator(`.r1 > ui-glyph svg[data-state="${state}"]`)).toHaveCount(1);
      await expect(card.locator(`ui-state-chip[data-state="${state}"]`)).toHaveText(EN.states.card[state]);
      const glyph = card.locator('.r1 > ui-glyph');
      pairs.add(`${String(await glyph.getAttribute('data-shape'))}/${String(await glyph.getAttribute('data-tone'))}`);
      const edge = await card.evaluate((el) => getComputedStyle(el).borderInlineStartWidth);
      expect(edge, state).toBe('3px');
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
    await expect(page.locator('[data-frame-chip="history"]')).toContainText(`History · ${last.label}`);
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
      const waiting = LIVE.cards.filter((c) => c.state === 'waiting');
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
      const card = page.locator(`[data-section="inFlight"] article[data-card="${task}"]`);
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
    for (const c of LIVE.cards) {
      await expect(page.locator(`app-flow-view [data-band="${c.lane}"] [data-column="${COLUMN_OF[c.state]}"] article[data-card="${c.task}"]`)).toHaveCount(1);
    }

    const order = bandOrder(LIVE.cards);
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
  const SESSION = { 'X-Spectant-Stub-Session': 'board-rail' };
  test.beforeEach(async ({ request }) => {
    await request.post('/api/__stub/reset', { headers: SESSION });
  });

  test.describe('at 1440', () => {
    test.use({ ...atWidth(1440), extraHTTPHeaders: SESSION });

    test('rail: This frame, Needs you and Your steps are the rail blocks; a tick posts through the checkbox write', async ({ page }) => {
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

      const steps = await rail.locator('app-your-steps [data-step]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-step')));
      expect(steps).toEqual(OPERATOR.map((c) => c.task));
      // The operator lane lives only in the rail at wide.
      await expect(page.locator('[data-lanes] section[data-lane="operator"]')).toHaveCount(0);

      const open = OPERATOR.find((c) => c.state === 'operatorOpen');
      if (!open) throw new Error('the live golden holds no open operator step');
      const row = rail.locator(`app-your-steps [data-step="${open.task}"]`);
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
    test.use({ ...atWidth(390), extraHTTPHeaders: SESSION });

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
      const chip = page.locator(`[data-section="inFlight"] app-agent-chip[data-agent-of="${card.task}"]`);
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
    const rows = await chipOffsets(page.locator(ROWS));
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
        for (const row of await chipOffsets(frameRows)) expect(row.offset, row.task).toBeLessThanOrEqual(0.5);

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

  test('rail sheet: on a coarse pointer each row is at least 44 px and its chip centres on the first line', async ({ page }) => {
    const { sheet, needsYou } = await openRailSheet(page);
    const check = async (rows: Locator): Promise<void> => {
      const measured = await chipOffsets(rows);
      expect(measured.length).toBeGreaterThan(0);
      for (const row of measured) {
        expect(row.offset, row.task).toBeLessThanOrEqual(0.5);
        expect(row.height, row.task).toBeGreaterThanOrEqual(44);
      }
    };
    await check(sheet.locator('app-this-frame [data-frame-event]'));
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

      // The strip names the same stages in the same order, each with its column's card count.
      const strip = 'app-board-page .strip ui-segmented[data-mode="strip"] button[data-key]';
      expect(await page.locator(strip).evaluateAll((s) => s.map((b) => b.getAttribute('data-key')))).toEqual([...planning.stages]);
      for (const stage of planning.stages) {
        await expect(page.locator(`${strip}[data-key="${stage}"] .count`), `strip ${stage}`).toHaveText(String(planning.stageCounts[stage] ?? 0));
      }

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

/** The query the URL carries, order-free: the router writes the keys in its own order. */
const urlQuery = (page: Page): URLSearchParams => new URL(page.url()).searchParams;
const BOARD_QUERY_PATH = '/api/workspaces/harbor/board-query';
const FILTER_CHIPS = (key: string): string => `app-board-filters [data-filter="${key}"] ui-filter-chips button`;
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

      const featureChip = page.locator(FILTER_CHIPS('feature')).filter({ hasText: featured.id });
      const laneFeature = page.locator(LANE_RADIOS).filter({ hasText: 'Feature' });
      await featureChip.click();
      await expect.poll(() => urlQuery(page).getAll('feature')).toEqual([featured.id]);

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
        await expect(featureChip).toHaveAttribute('aria-pressed', 'true');
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
      await expect(page.locator(FILTER_CHIPS('feature')).first()).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(LANE_RADIOS).filter({ hasText: 'Feature' })).toHaveAttribute('aria-checked', 'true');
      // A band per feature holding a card, in master order, and the band without a feature last when a card has none.
      const withCards = planning.features.filter((f) => all.some((c) => c.feature === f.id)).map((f) => f.id);
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
