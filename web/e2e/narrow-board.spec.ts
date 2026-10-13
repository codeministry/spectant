/**
 * The Board in a narrow container (T93, ISC-93): `bun run e2e -- narrow -g board` is the claim's probe. At the 600 px
 * cmux panel (and the 390 phone for good measure), with the live frame and with a history frame (`?frame=3`):
 *
 * - the page has no horizontal overflow: `document.scrollingElement.scrollWidth === clientWidth`;
 * - no lane scrolls on its own: no lane, and nothing inside the lanes, is a scroll container (`overflow` auto or
 *   scroll) whose content exceeds its box, and no lane's content is wider or taller than the lane;
 * - every lane header, sticky at compact, stays inside the viewport's width.
 *
 * `board.spec.ts` holds the same overflow check under its own `overflow at …` names; this file is the probe's.
 *
 * The workspace board at 820 px (spec 019, T28, ISC-141.1): `bun run e2e -- narrow-board -g "hidden columns"`. With
 * feature swimlanes, the columns right of the board's own scroller box are named with their card counts in the
 * overflow line `[data-board-hidden]`, and every swimlane whose cards all lie in those columns carries a hint
 * `[data-lane-hidden]` inside the visible box that names the count and the column, so no lane looks empty. Empty
 * stubs are not hidden columns. Every expectation is measured from the rendered columns, never restated.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { Frame, LiveFrame } from '../../core/src/files.ts';
import { atWidth, expect, test } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const SPEC = 'specs/002-web-console';
const read = (name: string): unknown => {
  const path = fileURLToPath(new URL(`../../core/fixtures/${name}`, import.meta.url));
  const value = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[SPEC];
  if (value === undefined) throw new Error(`${name} holds no ${SPEC}`);
  return value;
};
const FRAMES = read('harbor.frames.golden.json') as Frame[];
const LIVE = read('harbor.live.golden.json') as LiveFrame;
const HISTORY = FRAMES.find((f) => f.index === 3);
if (!HISTORY) throw new Error('harbor.frames.golden.json holds no frame 3');

const BOARD = '/w/harbor/s/002/board';
const CARDS = 'app-board-tab article[data-card]';
const LANES = 'app-board-tab [data-lanes] > section[data-lane]';

const FRAMES_UNDER_TEST = [
  { name: 'live frame', url: BOARD, cards: LIVE.cards.length },
  { name: 'frame 3', url: `${BOARD}?frame=3`, cards: HISTORY.cards.length },
] as const;

interface Layout {
  readonly page: { readonly scroll: number; readonly client: number };
  readonly viewport: number;
  /** Per lane: how far its content exceeds its box. */
  readonly lanes: ReadonlyArray<{ readonly lane: string; readonly x: number; readonly y: number }>;
  /** Every element in the lanes that is a scroll container with content past its box. */
  readonly scrollers: readonly string[];
  /** Per lane header: its left and right edge in the viewport. */
  readonly heads: ReadonlyArray<{ readonly lane: string; readonly left: number; readonly right: number }>;
}

async function layout(page: Page): Promise<Layout> {
  // Spec 024: cards may still be settling (the 240 ms FLIP of a frame step); measure once finite animations are done.
  await page.evaluate(() => Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming().iterations !== Infinity).map((a) => a.finished)));
  return page.evaluate((selector) => {
    const root = document.scrollingElement ?? document.documentElement;
    const lanes = [...document.querySelectorAll<HTMLElement>(selector)];
    const scrolls = (value: string): boolean => value === 'auto' || value === 'scroll';
    const scrollers: string[] = [];
    for (const lane of lanes) {
      for (const el of [lane, ...lane.querySelectorAll<HTMLElement>('*')]) {
        const style = getComputedStyle(el);
        const x = scrolls(style.overflowX) && el.scrollWidth > el.clientWidth;
        const y = scrolls(style.overflowY) && el.scrollHeight > el.clientHeight;
        if (x || y) scrollers.push(`${lane.dataset['lane'] ?? '?'} ${el.tagName.toLowerCase()}.${el.className}`);
      }
    }
    return {
      page: { scroll: root.scrollWidth, client: root.clientWidth },
      viewport: document.documentElement.clientWidth,
      lanes: lanes.map((el) => ({ lane: el.dataset['lane'] ?? '?', x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight })),
      scrollers,
      heads: lanes.flatMap((el) => {
        const head = el.querySelector<HTMLElement>('.lane-head');
        if (!head) return [];
        const box = head.getBoundingClientRect();
        return [{ lane: el.dataset['lane'] ?? '?', left: box.left, right: box.right }];
      }),
    };
  }, LANES);
}

function expectNarrowLayout(found: Layout): void {
  expect(found.page.scroll, 'page scrollWidth').toBe(found.page.client);
  expect(found.lanes.length).toBeGreaterThan(0);
  for (const lane of found.lanes) {
    expect(lane.x, `lane ${lane.lane} overflows sideways`).toBeLessThanOrEqual(0);
    expect(lane.y, `lane ${lane.lane} overflows downwards`).toBeLessThanOrEqual(0);
  }
  expect(found.scrollers).toEqual([]);
  expect(found.heads.length).toBe(found.lanes.length);
  for (const head of found.heads) {
    expect(head.left, `lane ${head.lane} header left edge`).toBeGreaterThanOrEqual(0);
    expect(head.right, `lane ${head.lane} header right edge`).toBeLessThanOrEqual(found.viewport);
  }
}

for (const width of [600, 390] as const) {
  test.describe(`board at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const frame of FRAMES_UNDER_TEST) {
      test(`board at ${String(width)}, ${frame.name}: no horizontal page overflow and no lane scroller`, async ({ page }) => {
        await page.goto(frame.url);
        await expect(page.locator(CARDS)).toHaveCount(frame.cards);
        expectNarrowLayout(await layout(page));
      });
    }

    test(`board at ${String(width)}: the sticky lane headers stay within the viewport while the page scrolls`, async ({ page }) => {
      await page.goto(BOARD);
      await expect(page.locator(CARDS)).toHaveCount(LIVE.cards.length);
      // Below 640 one lane shows at a time (spec 024, design.md "Kanban bleibt", correction 2): scroll the shown one.
      const lanes = page.locator(`${LANES}:visible`);
      const last = lanes.last();
      await last.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 200);
      expectNarrowLayout(await layout(page));
    });
  });
}

// ─── The workspace board at 820: hidden columns (spec 019, T28, ISC-141.1) ──────────────────────────────────────────

/** Feature swimlanes, set in the URL so the probe never hangs on a remembered or default group. */
const WS_BOARD = '/w/harbor/board?group=feature';
const HARBOR_STAGE_COUNTS = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../../core/fixtures/harbor.planning.golden.json', import.meta.url)), 'utf8')) as {
    stageCounts: Readonly<Record<string, number>>;
  }
).stageCounts;
const STAGE_WORDS = (
  JSON.parse(readFileSync(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8')) as { stages: Readonly<Record<string, string>> }
).stages;
const wordOf = (stage: string): string => {
  const word = STAGE_WORDS[stage];
  if (word === undefined) throw new Error(`en.json names no stage ${stage}`);
  return word;
};
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A stage word as a whole word: `Close` never matches inside `Close-pending`. */
const wordPattern = (word: string): string => `(?<![\\w-])${escaped(word)}(?![\\w-])`;
/** `Build 1` as one entry of the line: the word whole, then its count, `1` never inside `12`; `null` is any count. */
const entryOf = (word: string, count: number | null): RegExp => new RegExp(`${wordPattern(word)}\\s*${count === null ? '\\d+' : String(count)}(?!\\d)`);

interface BoardColumn {
  readonly stage: string;
  readonly stub: boolean;
  /** The column's left edge lies at or past the scroller box's right edge. */
  readonly hidden: boolean;
  /** The column's full count, as its head (or its stub) shows it. */
  readonly count: number;
}
interface BoardLane {
  readonly name: string;
  readonly top: number;
  readonly bottom: number;
  /** Cards of this lane per column, in column order. */
  readonly cards: readonly number[];
}
interface BoxText {
  readonly text: string;
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}
interface BoardOverflow {
  readonly box: { readonly left: number; readonly right: number };
  readonly columns: readonly BoardColumn[];
  readonly lanes: readonly BoardLane[];
  readonly hints: readonly BoxText[];
}

/** The scroller box, its columns (hidden or not), the swimlanes with their cards per column, and every lane hint. */
async function boardOverflow(page: Page): Promise<BoardOverflow> {
  return page.evaluate(() => {
    const scroller = document.querySelector<HTMLElement>('app-board-page .scroller');
    const grid = scroller?.querySelector<HTMLElement>(':scope > .grid');
    if (!scroller || !grid) throw new Error('the workspace board renders no scroller');
    const box = scroller.getBoundingClientRect();
    const gridBox = grid.getBoundingClientRect();
    const rows: Array<{ head: HTMLElement; cells: HTMLElement[] }> = [];
    for (const el of grid.children) {
      if (!(el instanceof HTMLElement)) continue;
      if (el.classList.contains('band-head')) rows.push({ head: el, cells: [] });
      else if (el.classList.contains('cell')) rows.at(-1)?.cells.push(el);
    }
    const sections = [...grid.querySelectorAll<HTMLElement>(':scope > section[data-col]')];
    const columns = sections.map((section) => {
      const head = section.querySelector<HTMLElement>(':scope > header') ?? section;
      const count = section.querySelector<HTMLElement>(':scope > header > .count, :scope > .count');
      return {
        stage: section.dataset['col'] ?? '?',
        stub: section.hasAttribute('data-stub'),
        hidden: head.getBoundingClientRect().left >= box.right - 1,
        count: Number(count?.textContent.trim() ?? 'NaN'),
      };
    });
    const lanes = rows.map((row, r) => {
      const next = rows[r + 1];
      return {
        name: row.head.innerText.replace(/\s+/g, ' ').trim(),
        top: row.head.getBoundingClientRect().top,
        bottom: next ? next.head.getBoundingClientRect().top : gridBox.bottom,
        cards: sections.map((_, i) => row.cells[i]?.querySelectorAll('app-board-card').length ?? 0),
      };
    });
    const hints = [...document.querySelectorAll<HTMLElement>('app-board-page [data-lane-hidden]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { text: el.innerText.replace(/\s+/g, ' ').trim(), top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    return { box: { left: box.left, right: box.right }, columns, lanes, hints };
  });
}

test.describe('hidden columns', () => {
  test.use(atWidth(820));
  let session = '';
  test.beforeEach(async ({ page, request }, info) => {
    session = `narrow-board-hidden-${info.testId}-${String(info.retry)}`;
    await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
    expect((await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } })).status()).toBe(204);
  });
  test.afterEach(async ({ request }) => {
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  });

  test('hidden columns: at 820 the overflow line names every hidden column with its cards, and no swimlane looks empty', async ({ page }) => {
    const total = Object.values(HARBOR_STAGE_COUNTS).reduce((sum, n) => sum + n, 0);
    await page.goto(WS_BOARD);
    await expect(page.locator('app-board-page')).toHaveAttribute('data-tier', 'medium');
    await expect(page.locator('app-board-page app-board-card')).toHaveCount(total);
    await expect(page.locator('app-board-page .band-head').first()).toBeVisible();

    const found = await boardOverflow(page);
    for (const column of found.columns) expect(column.count, `count of ${column.stage}`).toBe(HARBOR_STAGE_COUNTS[column.stage] ?? 0);
    // Only columns with cards count: an empty stub (or an empty column) right of the box hides nothing.
    const hidden = found.columns.filter((c) => c.hidden && c.count > 0);
    const shown = found.columns.filter((c) => !c.hidden && c.count > 0);
    expect(hidden.length, 'at 820 some columns with cards lie right of the scroller box').toBeGreaterThan(0);

    // (1) The overflow line names every hidden column with its count, and no column in view.
    const line = page.locator('app-board-page [data-board-hidden]');
    await expect.soft(line, 'the overflow line [data-board-hidden] is shown').toBeVisible();
    if ((await line.count()) === 1) {
      const text = (await line.innerText()).replace(/\s+/g, ' ');
      for (const column of hidden) {
        expect.soft(text, `the line names ${column.stage} with ${String(column.count)}`).toMatch(entryOf(wordOf(column.stage), column.count));
      }
      for (const column of shown) {
        expect.soft(text, `the line leaves out ${column.stage}, which is in view`).not.toMatch(entryOf(wordOf(column.stage), null));
      }
    }

    // (2) Every lane whose cards all lie in hidden columns says so inside the visible box: count and column.
    const unseen = found.lanes.filter(
      (lane) =>
        lane.cards.every((n, i) => n === 0 || found.columns[i]?.hidden === true) &&
        lane.cards.some((n, i) => n > 0 && found.columns[i]?.hidden === true),
    );
    expect(unseen.length, 'some swimlane holds cards only in hidden columns').toBeGreaterThan(0);
    for (const lane of unseen) {
      const hints = found.hints.filter((h) => (h.top + h.bottom) / 2 >= lane.top && (h.top + h.bottom) / 2 < lane.bottom);
      expect.soft(hints, `lane "${lane.name}" carries one [data-lane-hidden] hint`).toHaveLength(1);
      const hint = hints[0];
      if (hint === undefined) continue;
      expect.soft(hint.left, `lane "${lane.name}": the hint starts inside the box`).toBeGreaterThanOrEqual(found.box.left - 1);
      expect.soft(hint.right, `lane "${lane.name}": the hint ends inside the box`).toBeLessThanOrEqual(found.box.right + 1);
      const count = lane.cards.reduce((sum, n) => sum + n, 0);
      expect.soft(hint.text, `lane "${lane.name}": the hint names ${String(count)}`).toMatch(new RegExp(`(?<!\\d)${String(count)}(?!\\d)`));
      found.columns.forEach((column, i) => {
        if ((lane.cards[i] ?? 0) === 0) return;
        expect.soft(hint.text, `lane "${lane.name}": the hint names ${column.stage}`).toMatch(new RegExp(wordPattern(wordOf(column.stage))));
      });
    }
  });
});
