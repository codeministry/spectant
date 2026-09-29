/**
 * The Board tab against the stub API (T81, ISC-87 to ISC-90, ISC-93). Every expectation is read from the harbor 002
 * goldens the stub serves (`core/fixtures/harbor.frames.golden.json`, `harbor.live.golden.json`), never restated here.
 *
 * - `bun run e2e -- board -g states` (ISC-88): every card state of the live frame renders with its glyph, the chip word
 *   of the `states.card.*` catalogue and its own (shape, tone) pair; scrubbing every frame renders every state the
 *   goldens hold.
 * - `bun run e2e -- board -g waiting` (ISC-89): waiting cards sit in their reason's group and the rendered cards equal
 *   the frame's cards, at 390 and 1440.
 * - The scrubber steps `?frame` and the frame chip follows; `?view=flow` shows the board's own later-task note; under
 *   the `frontier` lock fixture the locked task is in flight with its session (ISC-90); no horizontal overflow and no
 *   lane scrolling on its own at 390 and 600 (ISC-93).
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
const CARDS = 'app-board-tab article[data-card]';
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

  test('?view=flow shows the board with its later-task note, not the area placeholder', async ({ page }) => {
    await page.goto(`${BOARD}?view=flow`);
    await expect(page.locator('app-board-tab [data-flow-placeholder]')).toContainText('comes with a later task');
    await expect(page.locator('[data-page="placeholder"]')).toHaveCount(0);
    await expect(page.locator('app-board-tab ui-segmented [aria-checked="true"]')).toHaveText('Flow');
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
      const card = page.locator(`[data-section="inFlight"] ${CARDS.replace('app-board-tab ', '')}[data-card="${task}"]`);
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
