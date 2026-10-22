/**
 * Spec 067 · T40 · ISC-538 (`bun run e2e -- narrow-planning sidebar -g "overflow"`): with the 480 px detail sidebar open,
 * no page that opens it — the planning tree, the Gantt lens, the diagram, the workspace board, the Specs list, the
 * dashboard and the idea page — scrolls sideways at 600, 820 or 1440 px: `document.scrollingElement.scrollWidth ===
 * clientWidth` (the shell has no inner scroller; the document scrolls, as `narrow-planning.spec.ts` measures it). The
 * open panel itself ends inside the viewport. Docked at 1440 px the Specs list keeps its fixed columns (ISC-487): every
 * cell of every visible spec row starts at its column's x, and no row runs under the docked panel.
 *
 * Against the stub API with `X-Spectant-Stub-Sidebar: on`: harbor 003 carries the 200-character title, so the chosen
 * spec stresses the title's wrapping in the head on every host but the idea page, which shows its story.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, pinClock, test, WIDTHS } from './fixtures';
import { SIDEBAR_HEADER } from './stub-api';

/** The detail token (`--detail`); a panel narrower than the viewport is this wide. */
const DETAIL = 480;
const TOLERANCE = 1;
const LONG = 'spec:003';

const HOSTS = [
  { name: 'planning tree', url: `/w/harbor/planning/tree?sel=${LONG}` },
  { name: 'gantt', url: `/w/harbor/planning/gantt?sel=${LONG}` },
  { name: 'diagram', url: `/w/harbor/planning/graph?sel=${LONG}` },
  { name: 'workspace board', url: `/w/harbor/board?sel=${LONG}` },
  { name: 'specs list', url: `/w/harbor/specs?sel=${LONG}` },
  { name: 'dashboard', url: `/w/harbor?sel=${LONG}` },
  { name: 'idea page', url: '/w/harbor/ideas/console-audit-log?sel=idea:console-audit-log' },
] as const;

/** The presentations the shell may pick at a width (design.md § Across viewports). */
const PRESENTATIONS: Readonly<Record<number, readonly string[]>> = {
  [WIDTHS.panel]: ['sheet'],
  [WIDTHS.tablet]: ['overlay'],
  [WIDTHS.desktop]: ['docked', 'floating'],
};

interface Overflow {
  readonly scroll: number;
  readonly client: number;
  /** The open panel's box, null without one. */
  readonly panel: { readonly left: number; readonly right: number; readonly width: number } | null;
}

async function overflowOf(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const panel = document.querySelector('app-detail-sidebar[data-presentation] .panel')?.getBoundingClientRect();
    return { scroll: root.scrollWidth, client: root.clientWidth, panel: panel ? { left: panel.left, right: panel.right, width: panel.width } : null };
  });
}

/** Waits until every running transition and animation (the panel sliding in, the rail widening) has finished. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
}

/** Opens `url` with the sidebar on its selection and waits for the panel's title. */
async function openWithSidebar(page: Page, url: string, width: number): Promise<string> {
  await pinClock(page);
  await page.setExtraHTTPHeaders({ [SIDEBAR_HEADER]: 'on' });
  await page.goto(url);
  const sidebar = page.locator('app-detail-sidebar[data-presentation]');
  await expect(sidebar.locator('[data-part="title"]')).toBeVisible();
  const presentation = (await sidebar.getAttribute('data-presentation')) ?? '';
  expect(PRESENTATIONS[width], `presentation at ${String(width)}`).toContain(presentation);
  return presentation;
}

for (const width of [WIDTHS.panel, WIDTHS.tablet, WIDTHS.desktop]) {
  test.describe(`sidebar overflow at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const host of HOSTS) {
      test(`overflow (ISC-538): ${host.name} with the sidebar open has no horizontal page overflow at ${String(width)} px`, async ({ page }) => {
        const presentation = await openWithSidebar(page, host.url, width);
        if (host.url.includes(LONG)) await expect(page.locator('app-detail-sidebar [data-part="title"]')).toHaveText(/.{200}/u);
        await settle(page);
        const result = await overflowOf(page);
        expect(result.scroll, `${host.name} ${presentation}: document scrollWidth == clientWidth`).toBe(result.client);
        expect(result.panel, 'the sidebar panel has a box').not.toBeNull();
        if (!result.panel) return;
        expect(result.panel.left).toBeGreaterThanOrEqual(-TOLERANCE);
        expect(result.panel.right, 'the panel ends inside the viewport').toBeLessThanOrEqual(result.client + TOLERANCE);
        if (presentation !== 'sheet') expect(Math.abs(result.panel.width - DETAIL), `panel width ${String(result.panel.width)}`).toBeLessThanOrEqual(TOLERANCE);
      });
    }
  });
}

interface Cell {
  readonly name: string;
  readonly left: number;
}

interface Row {
  readonly key: string;
  readonly right: number;
  readonly cells: readonly Cell[];
}

test.describe('sidebar overflow: specs list docked at 1440', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('overflow (ISC-538, ISC-487): docked beside the Specs list, every visible spec row keeps its fixed columns', async ({ page }) => {
    const presentation = await openWithSidebar(page, `/w/harbor/specs?sel=${LONG}`, WIDTHS.desktop);
    expect(presentation).toBe('docked');
    const fold = page.locator('[data-fold="specs"] [data-show-all]');
    if ((await fold.count()) > 0) {
      await fold.click();
      await expect(page.locator('ol.rows-rest')).toBeVisible();
    }
    await settle(page);
    const { rows, panelLeft, overflow } = await page.evaluate(() => {
      const shown = (el: Element): boolean => el.getClientRects().length > 0;
      const root = document.scrollingElement ?? document.documentElement;
      const list: Row[] = [...document.querySelectorAll('app-spec-row')].filter(shown).map((row) => ({
        key: row.querySelector('[data-cell="id"]')?.textContent.trim() ?? '',
        right: row.getBoundingClientRect().right,
        cells: [...row.children]
          .filter((cell) => cell.hasAttribute('data-cell') && shown(cell))
          .map((cell) => ({ name: cell.getAttribute('data-cell') ?? '', left: cell.getBoundingClientRect().left })),
      }));
      const panel = document.querySelector('app-detail-sidebar[data-presentation] .panel')?.getBoundingClientRect();
      return { rows: list, panelLeft: panel?.left ?? Number.NaN, overflow: root.scrollWidth - root.clientWidth };
    });
    expect(overflow, 'no horizontal page overflow').toBe(0);
    expect(rows.length).toBeGreaterThan(4);
    const names = new Set(rows.flatMap((row) => row.cells.map((cell) => cell.name)));
    expect([...names]).toEqual(expect.arrayContaining(['id', 'title']));
    for (const name of names) {
      const lefts = rows.flatMap((row) => row.cells.find((cell) => cell.name === name)?.left ?? []);
      expect(lefts.length, `${name}: rendered in every row`).toBe(rows.length);
      const spread = Math.max(...lefts) - Math.min(...lefts);
      expect(spread, `${name} left edges ${JSON.stringify(rows.map((row) => [row.key, row.cells.find((cell) => cell.name === name)?.left]))}`).toBeLessThanOrEqual(TOLERANCE);
    }
    for (const row of rows) expect(row.right, `${row.key} ends before the docked panel`).toBeLessThanOrEqual(panelLeft + TOLERANCE);
  });
});
