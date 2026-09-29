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
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import type { Frame, LiveFrame } from '../../core/src/files.ts';
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
      const lanes = page.locator(LANES);
      const last = lanes.last();
      await last.scrollIntoViewIfNeeded();
      await page.mouse.wheel(0, 200);
      expectNarrowLayout(await layout(page));
    });
  });
}
