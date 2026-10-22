/**
 * Spec 064 · the Specs list's columns on `/w/harbor/specs`, measured in real Chromium against the stub API under
 * `X-Spectant-Stub-Locks: working` (so harbor 002, 005, 006 and 009 carry the agent dot), with the "show all" fold
 * open so every active row, mark or none, and both ideas are on the page:
 *
 *   bun run test:browser -- spec-list-columns -g "spec columns"     ISC-487, T56: at 820 and 1440 px each of the ten
 *                                                                   cells starts at the same x in every spec row
 *   bun run test:browser -- spec-list-columns -g "idea columns"     ISC-488, T56: an idea row's id, title, prio, phase
 *                                                                   and star start where a spec row's do
 *   bun run test:browser -- spec-list-columns -g "more toggle"      ISC-489, T56: the toggle reads "…", keeps its long
 *                                                                   name, stands at one x and overlaps no other cell
 *   bun run test:browser -- spec-list-columns -g "compact columns"  ISC-490, T56: at 390 px both lines of spec and
 *                                                                   idea rows share their columns
 *   bun run test:browser -- spec-list-columns -g "sticky head"      ISC-509, T68: the column header's cells start at
 *                                                                   the rows' columns; one viewport height further
 *                                                                   down it stands right under the app header
 *
 * Threshold: 1 px everywhere.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { LOCKS_HEADER } from '../stub-api';

const LIST = '/w/harbor/specs';
const TOLERANCE = 1;
const TEN = ['id', 'title', 'more', 'mark', 'agent', 'prio', 'track', 'phase', 'meter', 'star'] as const;
const IDEA_CELLS = ['id', 'title', 'prio', 'phase', 'star'] as const;

interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

interface Cell extends Box {
  readonly name: string;
}

interface Row extends Box {
  readonly kind: 'spec' | 'idea' | 'head';
  readonly key: string;
  readonly marked: boolean;
  /** The rendered cells (a cell the tier hides with `display: none` is left out). */
  readonly cells: readonly Cell[];
  /** The "…" toggle, when the row has one. */
  readonly more: (Box & { readonly text: string; readonly name: string; readonly spec: string }) | null;
}

/** Opens the list with the fold open, so every active row and both ideas are rendered. */
async function openList(page: Page): Promise<void> {
  await page.goto(LIST);
  await expect(page.locator('app-spec-row').first()).toBeVisible();
  const fold = page.locator('[data-fold="specs"] [data-show-all]');
  if ((await fold.count()) > 0) {
    await fold.click();
    await expect(page.locator('ol.rows-rest')).toBeVisible();
  }
  await expect(page.locator('app-idea-row')).toHaveCount(2);
}

/** Every rendered row of the list (the column header included) with its cells' boxes, in page order. */
async function rowsOf(page: Page): Promise<Row[]> {
  return page.evaluate(() => {
    const shown = (el: Element): boolean => el.getClientRects().length > 0;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const kindOf = (el: Element): 'spec' | 'idea' | 'head' =>
      el.tagName === 'APP-IDEA-ROW' ? 'idea' : el.tagName === 'APP-SPEC-TABLE-HEAD' ? 'head' : 'spec';
    return [...document.querySelectorAll('app-spec-table-head, app-spec-row, app-idea-row')].filter(shown).map((row) => {
      const toggle = row.querySelector<HTMLButtonElement>('button.row-more');
      return {
        ...box(row),
        kind: kindOf(row),
        key: row.getAttribute('data-idea') ?? row.querySelector('[data-cell="id"]')?.textContent.trim() ?? '',
        marked: row.querySelector('[data-waits-mark], [data-next-mark]') !== null,
        cells: [...row.children]
          .filter((cell) => cell.hasAttribute('data-cell') && shown(cell))
          .map((cell) => ({ name: cell.getAttribute('data-cell') ?? '', ...box(cell) })),
        more:
          toggle && shown(toggle)
            ? { ...box(toggle), text: toggle.textContent.trim(), name: toggle.getAttribute('aria-label') ?? '', spec: toggle.dataset['more'] ?? '' }
            : null,
      };
    });
  });
}

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
const cellOf = (row: Row, name: string): Cell | undefined => row.cells.find((cell) => cell.name === name);
const leftsOf = (rows: readonly Row[], name: string): number[] => rows.flatMap((row) => cellOf(row, name)?.left ?? []);
const overlap = (a: Box, b: Box): number =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'working' } });

for (const width of [WIDTHS.tablet, WIDTHS.desktop]) {
  test.describe(`spec list at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`spec columns (ISC-487): every cell of every spec row starts at its column's x at ${String(width)} px`, async ({ page }) => {
      await openList(page);
      const specs = (await rowsOf(page)).filter((row) => row.kind === 'spec');
      expect(specs.length).toBeGreaterThan(4);
      expect(specs.some((row) => row.marked), 'a row with a mark').toBe(true);
      expect(specs.some((row) => !row.marked), 'a row without a mark').toBe(true);
      for (const name of TEN) {
        const lefts = leftsOf(specs, name);
        // A column the tier drops (the stage track below 900 px of list) is hidden in every row, never in some.
        if (lefts.length === 0) continue;
        expect(lefts.length, `${name}: rendered in every row`).toBe(specs.length);
        expect(spread(lefts), `${name} left edges ${JSON.stringify(specs.map((row) => [row.key, cellOf(row, name)?.left]))}`).toBeLessThanOrEqual(TOLERANCE);
      }
    });

    test(`idea columns (ISC-488): an idea row's cells start at the spec rows' columns at ${String(width)} px`, async ({ page }) => {
      await openList(page);
      const rows = await rowsOf(page);
      const spec = rows.find((row) => row.kind === 'spec');
      const ideas = rows.filter((row) => row.kind === 'idea');
      expect(ideas).toHaveLength(2);
      for (const name of IDEA_CELLS) {
        const at = spec && cellOf(spec, name)?.left;
        expect(at, `${name} in the spec row`).toBeDefined();
        for (const idea of ideas) {
          expect(Math.abs((cellOf(idea, name)?.left ?? Number.NaN) - (at ?? 0)), `${idea.key} ${name}`).toBeLessThanOrEqual(TOLERANCE);
        }
      }
    });

    test(`stage centred: every stage chip, idea pill and the "Stage" heading sit in the middle of their column at ${String(width)} px`, async ({ page }) => {
      await openList(page);
      const offsets = await page.evaluate(() => {
        const mid = (el: Element | Range): number => {
          const r = el.getBoundingClientRect();
          return (r.left + r.right) / 2;
        };
        /** The ink inside a cell: the chip, or the heading's text through a range. */
        const ink = (cell: Element): number => {
          const chip = cell.querySelector('ui-chip');
          if (chip) return mid(chip);
          const range = document.createRange();
          range.selectNodeContents(cell);
          return mid(range);
        };
        return [...document.querySelectorAll('app-spec-table-head, app-spec-row, app-idea-row')]
          .map((row) => row.querySelector(':scope > [data-cell="phase"]'))
          .filter((cell): cell is Element => cell !== null && cell.getClientRects().length > 0 && cell.textContent.trim() !== '')
          .map((cell) => ({ row: cell.parentElement?.tagName ?? '', offset: ink(cell) - mid(cell) }));
      });
      expect(offsets.some((o) => o.row === 'APP-SPEC-TABLE-HEAD'), 'the heading').toBe(true);
      expect(offsets.some((o) => o.row === 'APP-IDEA-ROW'), 'an idea pill').toBe(true);
      for (const o of offsets) expect(Math.abs(o.offset), `${o.row} off centre by ${String(o.offset)}`).toBeLessThanOrEqual(TOLERANCE);
    });
  });
}

for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
  test.describe(`spec list toggles and head at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`more toggle (ISC-489): "…" with its long name, one x, clear of every other cell at ${String(width)} px`, async ({ page }) => {
      await openList(page);
      const rows = (await rowsOf(page)).filter((row) => row.more !== null);
      expect(rows.length, 'rows with a toggle').toBeGreaterThan(0);
      for (const row of rows) {
        const more = row.more;
        if (!more) continue;
        expect(more.text, `${row.key}: visible text`).toBe('…');
        expect(more.name, `${row.key}: accessible name`).toContain(more.spec);
        expect(more.name.length, `${row.key}: the long name`).toBeGreaterThan(more.spec.length + 4);
        for (const cell of row.cells.filter((c) => c.name !== 'more')) {
          expect(overlap(more, cell), `${row.key}: toggle over ${cell.name}`).toBeLessThanOrEqual(0.5);
        }
      }
      expect(spread(rows.map((row) => row.more?.left ?? Number.NaN)), 'toggle x').toBeLessThanOrEqual(TOLERANCE);
    });
  });
}

/*
 * Harbor's list ends within the reference screens (844, 1180 and 900 px tall), so the sticky probe runs in shorter ones
 * (a short window or panel): 640 px at 390, 360 at 820 and 1440. The page is then at least one screen height longer
 * than the screen, and after a scroll by that height the list still runs on under the header row.
 */
const STICKY_HEIGHT: Readonly<Record<number, number>> = { [WIDTHS.phone]: 640, [WIDTHS.tablet]: 360, [WIDTHS.desktop]: 360 };

for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
  test.describe(`spec list head at ${String(width)}`, () => {
    test.use({ viewport: { width, height: STICKY_HEIGHT[width] ?? 360 } });

    test(`sticky head (ISC-509): the column header on the rows' columns, under the app header after a scroll at ${String(width)} px`, async ({ page }) => {
      await openList(page);
      const rows = await rowsOf(page);
      const head = rows.find((row) => row.kind === 'head');
      const spec = rows.find((row) => row.kind === 'spec');
      expect(head, 'the column header row').toBeDefined();
      if (!head || !spec) return;
      expect(head.bottom - head.top, 'head height').toBeCloseTo(32, 0);
      const names = head.cells.map((cell) => cell.name);
      expect(names.slice(0, 2)).toEqual(['id', 'title']);
      if (width === WIDTHS.phone) expect(names, 'only the first compact line').not.toContain('prio');
      for (const cell of head.cells) {
        const at = cellOf(spec, cell.name)?.left;
        expect(Math.abs(cell.left - (at ?? Number.NaN)), `head ${cell.name} vs row ${spec.key}`).toBeLessThanOrEqual(TOLERANCE);
      }

      await page.evaluate(() => window.scrollTo({ top: window.innerHeight, behavior: 'instant' }));
      await page.waitForFunction(() => window.scrollY >= window.innerHeight - 1);
      const stuck = await page.evaluate(() => {
        const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect() ?? null;
        return { head: box('app-spec-table-head'), header: box('app-shell-header'), viewport: window.innerHeight, scrolled: window.scrollY };
      });
      expect(stuck.scrolled, 'the page scrolled one viewport height').toBeGreaterThanOrEqual(stuck.viewport - TOLERANCE);
      expect(stuck.head && stuck.header).toBeTruthy();
      const top = stuck.head?.top ?? Number.NaN;
      expect(Math.abs(top - (stuck.header?.bottom ?? Number.NaN)), `head top ${String(top)} vs header bottom`).toBeLessThanOrEqual(TOLERANCE);
      expect(stuck.head?.bottom ?? Infinity).toBeLessThanOrEqual(stuck.viewport);
    });
  });
}

test.describe('spec list at 390', () => {
  test.use(atWidth(WIDTHS.phone));

  test('compact columns (ISC-490): both lines of spec and idea rows share their columns at 390 px', async ({ page }) => {
    await openList(page);
    const rows = (await rowsOf(page)).filter((row) => row.kind !== 'head');
    expect(rows.some((row) => row.kind === 'idea')).toBe(true);
    const names = new Set(rows.flatMap((row) => row.cells.map((cell) => cell.name)));
    for (const name of names) {
      const lefts = leftsOf(rows, name);
      expect(spread(lefts), `${name} left edges ${JSON.stringify(rows.map((row) => [row.key, cellOf(row, name)?.left]))}`).toBeLessThanOrEqual(TOLERANCE);
      // The line a cell sits on: the first above the row's middle, the second below it, the same in every row.
      const lines = rows.flatMap((row) => {
        const cell = cellOf(row, name);
        return cell ? [(cell.top + cell.bottom) / 2 < (row.top + row.bottom) / 2 ? 1 : 2] : [];
      });
      expect(new Set(lines).size, `${name} on one line in every row`).toBe(1);
    }
  });
});
