/**
 * The Matrix tab against the stub API (T92, ISC-92): `bun run e2e -- board -g matrix`. Every expectation is derived
 * here from the harbor 002 goldens the stub serves (`harbor.frames.golden.json`, `harbor.live.golden.json`,
 * `harbor.spec.golden.json` for the lane order), independently of core's `buildMatrix`, so the table is checked against
 * the frames themselves.
 *
 * - matrix rows: one row per task that ever had a card, grouped by lane in constitution order, operator last.
 * - matrix columns: one per frame in scrubber order plus the re-cut column before R3 dispatch; the live column last.
 * - matrix cells: each frame cell's state equals the card's state in that frame, `absent` (dashed) once the task had a
 *   card and has none, `none` before its first; every one of the eleven card states renders at least once.
 * - matrix jump: the R2 result cell of T27 lands on `/board?frame=<i>` with the frame chip "History · R2"; a live cell
 *   lands on `/board` at live, without `frame`.
 * - matrix scroll: at 390 the labelled region scrolls horizontally while the page does not.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { CardState, Frame, FrameCard, LiveFrame } from '../../core/src/files.ts';
import { atWidth, expect, test } from './fixtures';

const SPEC = 'specs/002-web-console';
const read = (name: string): unknown => {
  const path = fileURLToPath(new URL(`../../core/fixtures/${name}`, import.meta.url));
  const value = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[SPEC];
  if (value === undefined) throw new Error(`${name} holds no ${SPEC}`);
  return value;
};
const HISTORY = read('harbor.frames.golden.json') as Frame[];
const LIVE = read('harbor.live.golden.json') as LiveFrame;
const LANES = (read('harbor.spec.golden.json') as { lanes: Array<{ name: string }> }).lanes.map((lane) => lane.name);
const FRAMES: readonly Frame[] = [...HISTORY, LIVE];
const EN = JSON.parse(readFileSync(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8')) as {
  states: { card: Record<CardState, string> };
};
const ELEVEN: readonly CardState[] = Object.keys(EN.states.card) as CardState[];

const MATRIX = '/w/harbor/s/002/matrix';
const BOARD = '/w/harbor/s/002/board';

/** The latest card of every task, first seen order, grouped by lane: constitution lanes, then others, operator last. */
function expectedRows(): string[] {
  const latest = new Map<string, FrameCard>();
  for (const frame of FRAMES) for (const c of frame.cards) latest.set(c.task, c);
  const cards = [...latest.values()];
  const rank = (lane: string): number => (lane === 'operator' ? 1e6 : LANES.includes(lane) ? LANES.indexOf(lane) : 1e3);
  return cards.map((c, i) => ({ c, i })).sort((a, b) => rank(a.c.lane) - rank(b.c.lane) || a.i - b.i).map(({ c }) => c.task);
}

/** Column kinds in order: a re-cut column before each frame that carries `recut`. */
const expectedKinds = (): string[] => FRAMES.flatMap((f) => (f.recut === undefined ? [f.kind] : ['recut', f.kind]));

/** The data-state of every cell of a row, re-cut cells `none`. */
function expectedStates(task: string): string[] {
  let seen = false;
  return FRAMES.flatMap((frame) => {
    const own = frame.cards.find((c) => c.task === task);
    if (own !== undefined) seen = true;
    const state = own?.state ?? (seen ? 'absent' : 'none');
    return frame.recut === undefined ? [state] : ['none', state];
  });
}

for (const width of [1440, 390]) {
  test.describe(`matrix at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`matrix rows, columns and cells equal the goldens at ${String(width)}`, async ({ page }) => {
      await page.goto(MATRIX);
      const region = page.getByRole('region', { name: 'Matrix: tasks by frame' });
      await expect(region).toBeVisible();
      await expect(region).toHaveAttribute('tabindex', '0');

      const rows = expectedRows();
      await expect(page.locator('tbody tr[data-row]')).toHaveCount(rows.length);
      expect(await page.locator('tbody tr[data-row]').evaluateAll((trs) => trs.map((tr) => tr.getAttribute('data-row')))).toEqual(rows);
      expect(await page.locator('tbody[data-lane]').evaluateAll((groups) => groups.map((g) => g.getAttribute('data-lane')))).toEqual(
        LANES.filter((lane) => lane !== 'operator' && FRAMES.some((f) => f.cards.some((c) => c.lane === lane))).concat('operator'),
      );
      expect(await page.locator('thead th[data-column]').evaluateAll((ths) => ths.map((th) => th.getAttribute('data-kind')))).toEqual(expectedKinds());
      expect(expectedKinds()).toEqual(['dispatch', 'result', 'dispatch', 'result', 'recut', 'dispatch', 'result', 'live']);

      const rendered = await page
        .locator('tbody tr[data-row]')
        .evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.getAttribute('data-state') ?? '')));
      expect(rendered).toEqual(rows.map(expectedStates));
      expect(ELEVEN.filter((state) => !rendered.flat().includes(state))).toEqual([]);

      // T34: none before the re-cut, waiting in R3, a dashed absent cell live; T33 dashed after the re-cut
      const t34live = page.locator('tr[data-row="T34"] td[data-kind="live"]');
      await expect(t34live).toHaveAttribute('data-state', 'absent');
      await expect(t34live.locator('ui-glyph')).toHaveAttribute('data-shape', 'dashed-square');
      await expect(page.locator('tr[data-row="T34"] td[data-recut="added"]')).toHaveCount(1);
      await expect(page.locator('tr[data-row="T33"] td[data-state="absent"] ui-glyph[data-shape="dashed-square"]')).toHaveCount(3);
      await expect(page.locator('tr[data-row="T27"] td[data-kind="live"] a')).toHaveAttribute('aria-label', `T27, Live: ${EN.states.card.running}`);
    });

    test(`matrix jump: the R2 result cell of T27 opens the board at that frame, a live cell at live (${String(width)})`, async ({ page }) => {
      const r2 = HISTORY.find((f) => f.kind === 'result' && f.round === 2);
      if (!r2) throw new Error('the frames golden holds no R2 result');
      await page.goto(MATRIX);
      const cell = page.locator(`tr[data-row="T27"] td[data-kind="result"] a[href$="frame=${String(r2.index)}"]`);
      await expect(cell).toHaveAttribute('aria-label', `T27, R2 result: ${EN.states.card[r2.cards.find((c) => c.task === 'T27')?.state ?? 'waiting']}`);
      await cell.click();
      await expect(page).toHaveURL(new RegExp(`${BOARD}\\?frame=${String(r2.index)}$`));
      await expect(page.locator('[data-frame-chip="history"]')).toContainText('History · R2');

      await page.goto(MATRIX);
      await page.locator('tr[data-row="T27"] td[data-kind="live"] a').click();
      await expect(page).toHaveURL(new RegExp(`${BOARD}$`));
      await expect(page.locator('[data-frame-chip="live"]')).toBeVisible();
    });
  });
}

test.describe('matrix scroll at 390', () => {
  test.use(atWidth(390));

  test('matrix scroll: the region scrolls horizontally, the page does not', async ({ page }) => {
    await page.goto(MATRIX);
    const region = page.getByRole('region', { name: 'Matrix: tasks by frame' });
    await expect(page.locator('tbody tr[data-row]').first()).toBeVisible();
    const box = await region.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(box.scroll).toBeGreaterThan(box.client);
    await region.evaluate((el) => el.scrollTo({ left: 120 }));
    expect(await region.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    const page_ = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(page_.scroll).toBeLessThanOrEqual(page_.inner);
    // the sticky first column stays put while the frames scroll under it
    const first = page.locator('tbody tr[data-row] th.task').first();
    expect((await first.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
    const cellWidth = await page.locator('tbody td[data-kind="result"]').first().evaluate((td) => td.getBoundingClientRect().width);
    expect(cellWidth).toBe(44);
  });
});
