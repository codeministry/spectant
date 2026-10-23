/**
 * Spec 064 · the Specs list's columns on `/w/harbor/specs`, measured in real Chromium against the stub API under
 * `X-Spectant-Stub-Locks: working` (so harbor 002, 005, 006 and 009 carry the agent dot), with the "show all" fold
 * open so every active row, mark or none, and both ideas are on the page:
 *
 *   bun run test:browser -- spec-list-columns -g "spec columns"     ISC-487, T56: at 820 and 1440 px each of the ten
 *                                                                   cells starts at the same x in every spec row
 *   bun run test:browser -- spec-list-columns -g "idea columns"     ISC-488, T56: an idea row's id, title, feature,
 *                                                                   prio, phase and star start where a spec row's do
 *   bun run test:browser -- spec-list-columns -g "headings centred" at 820 and 1440 px every column heading but Title
 *                                                                   stands in the middle of its box, Title at its start
 *   bun run test:browser -- spec-list-columns -g "title cut"        at 390, 820 and 1440 px a spec row's title is one
 *                                                                   line cut by an ellipsis, the waits chip after it
 *                                                                   uncut; no row has a "…" toggle or a description
 *   bun run test:browser -- spec-list-columns -g "compact columns"  ISC-490, T56: at 390 px both lines of spec and
 *                                                                   idea rows share their columns
 *   bun run test:browser -- spec-list-columns -g "sticky head"      ISC-509, T68: the column header's cells start at
 *                                                                   the rows' columns; one viewport height further
 *                                                                   down it stands right under the app header
 *
 * Spec 068 · Next up on the dashboard `/w/harbor`, its rows the list's (`app-spec-row`, variant `next`):
 *
 *   bun run test:browser -- spec-list-columns -g "next up columns"  ISC-546, T5: at 390, 820 and 1440 px every cell of
 *                                                                   every row starts at its heading's x (at 390 px,
 *                                                                   with headings for the first line only, at the
 *                                                                   first row's cell)
 *   bun run test:browser -- spec-list-columns -g "next up entry"    ISC-546, T5: no `next-up-entry.*` file is left
 *   bun run test:browser -- spec-list-columns -g "next up fit"      ISC-547, T14: at 390, 700, 820 and 1440 px in
 *                                                                   spec-light and spec-dark no page overflow, every
 *                                                                   title and copy chip inside the Next up card
 *
 * Threshold: 1 px everywhere.
 */
import { readdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from '../fixtures';
import { LOCKS_HEADER } from '../stub-api';

const LIST = '/w/harbor/specs';
const TOLERANCE = 1;
const TEN = ['id', 'title', 'feature', 'mark', 'agent', 'prio', 'track', 'phase', 'meter', 'star'] as const;
const IDEA_CELLS = ['id', 'title', 'feature', 'prio', 'phase', 'star'] as const;

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
    return [...document.querySelectorAll('app-spec-table-head, app-spec-row, app-idea-row')].filter(shown).map((row) => ({
      ...box(row),
      kind: kindOf(row),
      key: row.getAttribute('data-idea') ?? row.querySelector('[data-cell="id"]')?.textContent.trim() ?? '',
      marked: row.querySelector('[data-waits-mark], [data-next-mark]') !== null,
      cells: [...row.children]
        .filter((cell) => cell.hasAttribute('data-cell') && shown(cell))
        .map((cell) => ({ name: cell.getAttribute('data-cell') ?? '', ...box(cell) })),
    }));
  });
}

const spread = (values: readonly number[]): number => Math.max(...values) - Math.min(...values);
const cellOf = (row: Row, name: string): Cell | undefined => row.cells.find((cell) => cell.name === name);
const leftsOf = (rows: readonly Row[], name: string): number[] => rows.flatMap((row) => cellOf(row, name)?.left ?? []);

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

    test(`headings centred: every column heading but Title stands in the middle of its box, Title at its start at ${String(width)} px`, async ({ page }) => {
      await openList(page);
      const heads = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('app-spec-table-head > [data-cell]')]
          .filter((cell) => cell.getClientRects().length > 0 && cell.textContent.trim() !== '')
          .map((cell) => {
            const box = cell.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(cell);
            const ink = range.getBoundingClientRect();
            return {
              name: cell.dataset['cell'] ?? '',
              offset: (ink.left + ink.right) / 2 - (box.left + box.right) / 2,
              start: ink.left - box.left,
              // A block heading too long for its box ends in an ellipsis, start-aligned by CSS; the flex one (Priority)
              // spills evenly on both sides instead.
              cut: getComputedStyle(cell).display !== 'flex' && cell.scrollWidth > cell.clientWidth + 1,
            };
          }),
      );
      expect(heads.map((h) => h.name)).toEqual(expect.arrayContaining(['id', 'title', 'mark', 'prio', 'phase', 'meter']));
      for (const h of heads) {
        if (h.name === 'title') expect(Math.abs(h.start), 'Title at its start').toBeLessThanOrEqual(TOLERANCE);
        else if (!h.cut) expect(Math.abs(h.offset), `${h.name} off centre by ${String(h.offset)}`).toBeLessThanOrEqual(TOLERANCE);
      }
    });
  });
}

for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
  test.describe(`spec list titles at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`title cut: a spec row's title is one line ending in an ellipsis, the waits chip after it uncut at ${String(width)} px`, async ({ page }) => {
      await openList(page);
      const titles = await page.evaluate(() =>
        [...document.querySelectorAll('app-spec-row')].map((row) => {
          const link = row.querySelector<HTMLElement>('a.row-link');
          const chip = row.querySelector<HTMLElement>('ui-waits-chip.rwaits');
          const style = link ? getComputedStyle(link) : null;
          return {
            id: link?.dataset['specRow'] ?? '',
            cut: link ? link.scrollWidth > link.clientWidth : false,
            height: link?.getBoundingClientRect().height ?? Number.NaN,
            line: style ? Number.parseFloat(style.lineHeight) : Number.NaN,
            ellipsis: style?.textOverflow === 'ellipsis' && style.whiteSpace === 'nowrap',
            linkRight: link?.getBoundingClientRect().right ?? Number.NaN,
            chip: chip ? { left: chip.getBoundingClientRect().left, cut: chip.scrollWidth > chip.clientWidth } : null,
            titleRight: row.querySelector('[data-cell="title"]')?.getBoundingClientRect().right ?? Number.NaN,
          };
        }),
      );
      expect(titles.length).toBeGreaterThan(4);
      if (width === WIDTHS.phone) expect(titles.some((t) => t.cut), 'a cut title at 390').toBe(true);
      for (const t of titles) {
        expect(t.ellipsis, `${t.id}: ellipsis, one line`).toBe(true);
        expect(t.height, `${t.id}: one line`).toBeLessThanOrEqual(t.line + TOLERANCE);
        if (t.chip) {
          expect(t.chip.cut, `${t.id}: waits chip uncut`).toBe(false);
          expect(t.chip.left, `${t.id}: waits chip after the title`).toBeGreaterThanOrEqual(t.linkRight);
          expect(t.chip.left, `${t.id}: waits chip inside the title cell`).toBeLessThan(t.titleRight);
        }
      }
      await expect(page.locator('app-spec-table :is([data-more], .row-more, [data-cell="more"], app-spec-row .d, [id^="desc-"])')).toHaveCount(0);
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

/*
 * Spec 068 · Next up on the dashboard `/w/harbor`: the spec list's rows (`app-spec-row`, variant `next`) under its
 * column headings, the copy chip in a `command` cell of its own. A "show all" fold, if any, is opened.
 */
const DASHBOARD = '/w/harbor';
const NEXT_UP_DIR = new URL('../../src/app/features/dashboard/next-up-list/', import.meta.url);
const THEMES = ['light', 'dark'] as const;

/** Opens the dashboard with every Next up entry on the page. */
async function openNextUp(page: Page): Promise<void> {
  await page.goto(DASHBOARD);
  await expect(page.locator('app-spec-row[data-next-row]').first()).toBeVisible();
  const fold = page.locator('app-next-up-list [data-show-all] button').first();
  if ((await fold.count()) > 0 && (await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
}

/** Next up's column head (if shown) and its rows, each with its cells' boxes, in page order. */
async function nextRowsOf(page: Page): Promise<{ head: Row | undefined; rows: Row[] }> {
  const all = await page.evaluate(() => {
    const shown = (el: Element): boolean => el.getClientRects().length > 0;
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    return [...document.querySelectorAll('[data-next-cols] app-spec-table-head, app-spec-row[data-next-row]')].filter(shown).map((row) => ({
      ...box(row),
      kind: row.tagName === 'APP-SPEC-TABLE-HEAD' ? ('head' as const) : ('spec' as const),
      key: row.getAttribute('data-next-entry') ?? '',
      marked: row.querySelector('[data-next-mark]') !== null,
      cells: [...row.children]
        .filter((cell) => cell.hasAttribute('data-cell') && shown(cell))
        .map((cell) => ({ name: cell.getAttribute('data-cell') ?? '', ...box(cell) })),
    }));
  });
  return { head: all.find((row) => row.kind === 'head'), rows: all.filter((row) => row.kind === 'spec') };
}

for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
  test.describe(`next up at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`next up columns (ISC-546): every cell of every Next up row starts at its heading's x at ${String(width)} px`, async ({ page }) => {
      await openNextUp(page);
      const { head, rows } = await nextRowsOf(page);
      expect(rows.length, 'Next up rows').toBeGreaterThan(1);
      const [first] = rows;
      if (!first) return;
      const names = first.cells.map((cell) => cell.name);
      expect(names).toEqual(expect.arrayContaining(['id', 'title', 'command']));
      // From 640 px of list the head shows a heading over every cell of the row's first line; below 848 px the command
      // chip has a line of its own and no heading, and below 640 px only the first compact line has headings. A cell
      // without a shown heading is held against the same cell of the first row.
      const lineEnd = cellOf(first, 'title')?.bottom ?? Number.NaN;
      const lineOne = first.cells.filter((cell) => cell.top < lineEnd - TOLERANCE).map((cell) => cell.name);
      if (width !== WIDTHS.phone) expect(head?.cells.map((cell) => cell.name), 'a heading per cell of the first line').toEqual(lineOne);
      for (const row of rows) {
        expect(row.cells.map((cell) => cell.name), `${row.key}: the first row's cells`).toEqual(names);
        for (const cell of row.cells) {
          const at = (head && cellOf(head, cell.name)) ?? cellOf(first, cell.name);
          expect(Math.abs(cell.left - (at?.left ?? Number.NaN)), `${row.key} ${cell.name} at ${String(cell.left)} vs ${String(at?.left)}`).toBeLessThanOrEqual(TOLERANCE);
        }
      }
      await expect(page.locator('app-next-up-entry')).toHaveCount(0);
    });
  });
}

test('next up entry gone (ISC-546): no `next-up-entry.*` file is left beside the Next up list', () => {
  expect(readdirSync(NEXT_UP_DIR).filter((name) => name.startsWith('next-up-entry.'))).toEqual([]);
});

/** The narrowest window whose Next up list is already in the one-line tier (650 px of list, 640 at least). */
const NARROWEST_ONE_LINE = 700;

for (const theme of THEMES) {
  for (const width of [WIDTHS.phone, NARROWEST_ONE_LINE, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`next up fit at ${String(width)} in spec-${theme}`, () => {
      test.use({ ...atWidth(width), colorScheme: theme });

      test(`next up fit (ISC-547): no page overflow, every Next up title and copy chip inside the card at ${String(width)} px in spec-${theme}`, async ({ page }) => {
        await openNextUp(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
        const fit = await page.evaluate(() => {
          const box = (el: Element | null) => {
            const r = el?.getBoundingClientRect();
            return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null;
          };
          return {
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            card: box(document.querySelector('[data-next-card]')),
            rows: [...document.querySelectorAll('app-spec-row[data-next-row]')].map((row) => ({
              key: row.getAttribute('data-next-entry') ?? '',
              title: box(row.querySelector(':scope > [data-cell="title"]')),
              chip: box(row.querySelector('ui-command-chip')),
            })),
          };
        });
        expect(fit.scrollWidth, 'page scroll width').toBeLessThanOrEqual(fit.clientWidth);
        expect(fit.rows.length, 'Next up rows').toBeGreaterThan(1);
        expect(fit.rows.some((row) => row.chip !== null), 'a row with a copy chip').toBe(true);
        const card = fit.card;
        expect(card, 'the Next up card').not.toBeNull();
        if (!card) return;
        for (const row of fit.rows) {
          expect(row.title, `${row.key}: its title cell`).not.toBeNull();
          // The chip never starves the title (spec 068, T13): the title cell keeps at least 120 px in every tier.
          expect((row.title?.right ?? 0) - (row.title?.left ?? 0), `${row.key}: title width`).toBeGreaterThanOrEqual(120);
          for (const [part, b] of [['title', row.title], ['chip', row.chip]] as const) {
            if (!b) continue;
            const where = `${row.key} ${part} ${JSON.stringify(b)} in card ${JSON.stringify(card)}`;
            expect(b.left, where).toBeGreaterThanOrEqual(card.left - TOLERANCE);
            expect(b.right, where).toBeLessThanOrEqual(card.right + TOLERANCE);
            expect(b.top, where).toBeGreaterThanOrEqual(card.top - TOLERANCE);
            expect(b.bottom, where).toBeLessThanOrEqual(card.bottom + TOLERANCE);
          }
        }
      });
    });
  }
}
