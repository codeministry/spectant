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
 *   with its session (ISC-90); no horizontal overflow and no lane scrolling on its own at 390 and 600 (ISC-93).
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
  test.use({ ...atWidth(1440), extraHTTPHeaders: { 'X-Spectant-Stub-Locks': 'frontier' } });

  test('a task under a frontier lock shows in flight with the session name', async ({ page }) => {
    await page.goto(BOARD);
    await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
    // The stub's frontier fixture relabels the golden's lock and adds one session on the first waiting open claim
    // (web/e2e/stub-api.ts `lockFixtures`): T27 keeps spec-002-ISC-74, T28 gets spec-002-ISC-75.
    for (const [task, session] of [
      ['T27', 'spec-002-ISC-74'],
      ['T28', 'spec-002-ISC-75'],
    ] as const) {
      const card = page.locator(`[data-section="inFlight"] article[data-card="${task}"]`);
      await expect(card).toHaveAttribute('data-state', 'running');
      await expect(card.locator('[data-session]')).toContainText(session);
    }
  });
});

for (const width of [390, 600] as const) {
  test.describe(`overflow at ${String(width)}`, () => {
    test.use(atWidth(width));

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
  test.use({ ...atWidth(1440), extraHTTPHeaders: { 'X-Spectant-Stub-Locks': 'frontier' }, clockAt: LIVE.ts });

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
});
