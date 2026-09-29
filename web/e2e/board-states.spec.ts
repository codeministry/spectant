/**
 * The eleven card states on the harbor 002 fixture (T90, ISC-88): `bun run e2e -- board -g states`, threshold 11.
 *
 * Every frame of the scrubber (each `?frame=i` of `core/fixtures/harbor.frames.golden.json`, then live from
 * `harbor.live.golden.json`) in both densities (`?density=compact` and the default) is rendered, and every card is read
 * back: the union of the rendered glyph states equals exactly the eleven `CardState`s, each state shows its
 * `states.card.*` word in the chip, its (shape, tone) pair is its own, and its 3 px inline-start edge is the state's
 * colour: one colour per tone, the same wherever the state shows, and different for every other tone. Opening one card's
 * detail by its id button lists the card's state history across the frames, as the goldens give it. `board.spec.ts`
 * covers the live frame; this file covers the whole fixture.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CardState, Frame, FrameCard, LiveFrame } from '../../core/src/files.ts';
import { atWidth, expect, test } from './fixtures';

/** The eleven card states, in `core/src/files.ts` order. */
const ALL_STATES: readonly CardState[] = [
  'waiting',
  'dispatched',
  'running',
  'question',
  'concerns',
  'fail',
  'done',
  'closed',
  'absent',
  'operatorOpen',
  'operatorDone',
];

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
/** Every card of the board: the lanes, and at wide the operator steps in the shell rail's "Your steps". */
const CARDS = ':is(app-board-tab, app-rail-slot) article[data-card]';
const ALL_FRAMES: ReadonlyArray<Frame | LiveFrame> = [...FRAMES, LIVE];
const urlOf = (frame: Frame | LiveFrame, compact: boolean): string => {
  const params = [...(frame.kind === 'live' ? [] : [`frame=${String(frame.index)}`]), ...(compact ? ['density=compact'] : [])];
  return params.length === 0 ? BOARD : `${BOARD}?${params.join('&')}`;
};

/** What one rendered card shows for its state. */
interface Seen {
  readonly state: string;
  readonly glyph: string;
  readonly chip: string;
  readonly shape: string;
  readonly tone: string;
  readonly edgeColor: string;
  readonly edgeWidth: string;
}

test.describe('states', () => {
  test.use(atWidth(1440));

  test('states: every frame in both densities renders all eleven states with glyph, chip word, own shape and tone, state-coloured 3 px edge', async ({ page }) => {
    test.setTimeout(120_000);
    const seen: Seen[] = [];
    for (const frame of ALL_FRAMES) {
      for (const compact of [false, true]) {
        await page.goto(urlOf(frame, compact));
        await expect(page.locator(CARDS)).toHaveCount(frame.cards.length);
        const cards = await page.locator(CARDS).evaluateAll((els) =>
          els.map((el) => {
            const glyph = el.querySelector(':scope > .r1 > ui-glyph');
            const style = getComputedStyle(el);
            return {
              state: el.getAttribute('data-state') ?? '',
              glyph: glyph?.querySelector('svg[data-state]')?.getAttribute('data-state') ?? '',
              chip: (el.querySelector('ui-state-chip')?.textContent ?? '').trim(),
              shape: glyph?.getAttribute('data-shape') ?? '',
              tone: glyph?.getAttribute('data-tone') ?? '',
              edgeColor: style.borderInlineStartColor,
              edgeWidth: style.borderInlineStartWidth,
            };
          }),
        );
        const where = urlOf(frame, compact);
        expect(cards.map((c) => c.state).sort(), where).toEqual(frame.cards.map((c) => c.state).sort());
        seen.push(...cards);
      }
    }

    // The union of the rendered glyph states is exactly the eleven.
    const rendered = [...new Set(seen.map((s) => s.glyph))].sort();
    expect(rendered).toEqual([...ALL_STATES].sort());
    expect(rendered.length).toBeGreaterThanOrEqual(11);

    const byState = new Map<string, Seen>();
    for (const s of seen) {
      expect(s.glyph, `glyph of a ${s.state} card`).toBe(s.state);
      expect(s.chip, `chip of ${s.state}`).toBe(EN.states.card[s.state as CardState]);
      expect(s.edgeWidth, `edge of ${s.state}`).toBe('3px');
      const first = byState.get(s.state);
      if (first === undefined) byState.set(s.state, s);
      // A state looks the same in every frame and both densities.
      else expect({ shape: s.shape, tone: s.tone, edge: s.edgeColor }, s.state).toEqual({ shape: first.shape, tone: first.tone, edge: first.edgeColor });
    }

    const reps = ALL_STATES.map((state) => {
      const rep = byState.get(state);
      if (rep === undefined) throw new Error(`no ${state} card rendered`);
      expect(rep.shape, state).not.toBe('');
      expect(rep.tone, state).not.toBe('');
      return rep;
    });
    // No two states share the (shape, tone) pair.
    expect(new Set(reps.map((r) => `${r.shape}/${r.tone}`)).size).toBe(ALL_STATES.length);
    // The edge is the state's colour: states of one tone share it, states of different tones never do.
    for (const a of reps) {
      for (const b of reps) {
        if (a === b) continue;
        if (a.tone === b.tone) expect(a.edgeColor, `${a.state} and ${b.state} share the ${a.tone} tone`).toBe(b.edgeColor);
        else expect(a.edgeColor, `${a.state} (${a.tone}) against ${b.state} (${b.tone})`).not.toBe(b.edgeColor);
      }
    }
  });

  test('states: the id button opens the card detail with its state history across the frames', async ({ page }) => {
    // The live card whose task went through the most states; its history is every frame holding the same id and text.
    const historyOf = (card: FrameCard): Array<[string, string]> =>
      ALL_FRAMES.flatMap((f) => {
        const hit = f.cards.find((c) => c.task === card.task && c.text === card.text);
        return hit === undefined ? [] : [[String(f.index), hit.state] as [string, string]];
      });
    const card = [...LIVE.cards].sort((a, b) => new Set(historyOf(b).map((h) => h[1])).size - new Set(historyOf(a).map((h) => h[1])).size)[0];
    if (card === undefined) throw new Error('the live golden holds no card');
    const expected = historyOf(card);
    expect(new Set(expected.map((h) => h[1])).size).toBeGreaterThan(1);

    await page.goto(BOARD);
    await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
    await page.locator(`${CARDS}[data-card="${card.task}"] button.id`).click();
    const detail = page.locator(`dialog[open] [data-card-detail][data-task="${card.task}"]`);
    await expect(detail).toBeVisible();
    const rows = detail.locator('[data-history] li');
    await expect(rows).toHaveCount(expected.length);
    expect(await rows.evaluateAll((els) => els.map((li) => [li.getAttribute('data-history-frame') ?? '', li.getAttribute('data-history-state') ?? '']))).toEqual(expected);
    for (const [i, [, state]] of expected.entries()) {
      await expect(rows.nth(i)).toContainText(EN.states.card[state as CardState]);
    }
  });

  test('states: a Needs you row in the rail opens the same card detail, with its state word', async ({ page }) => {
    const card = LIVE.needsYou[0];
    if (card === undefined) throw new Error('the live golden holds no Needs you card');
    await page.goto(BOARD);
    await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
    await page.locator(`aside.shell-rail app-needs-you [data-needs-card="${card.task}"]`).click();
    const detail = page.locator(`dialog[open] [data-card-detail][data-task="${card.task}"]`);
    await expect(detail.locator('ui-state-chip').first()).toHaveText(EN.states.card[card.state]);
    await expect(detail.locator('[data-history] li').last()).toHaveAttribute('data-history-state', card.state);
    await page.keyboard.press('Escape');
    await expect(page.locator('dialog[open] [data-card-detail]')).toHaveCount(0);
  });
});
