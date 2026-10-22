/**
 * The app in the 600 px cmux side panel (ISC-63, ISC-63.1). One file, one `test.describe` per surface, each the probe
 * of its claim through `-g`:
 *
 *   bun run e2e -- narrow -g dashboard     ISC-63 (T73): the workspace dashboard `/w/harbor` and, since spec 058, its
 *                                          spec list `/w/harbor/specs` (the two pages the root was split into)
 *   bun run e2e -- narrow -g column        ISC-63.1 (T74): a workspace column of the overview `/`
 *   bun run e2e -- narrow -g board         ISC-129.2 (T145): the workspace board `/w/harbor/board` at compact
 *
 * "No horizontal overflow" is checked on every scroll container the page has, not only the document: the document
 * (`scrollingElement`), `<body>`, the shell body and `<main>` must each have `scrollWidth === clientWidth`; no element
 * of the shell may end past the viewport unless an ancestor that itself fits clips it (an ellipsised title); and no
 * element of the page may be a horizontal scroll container with content past its box. Each state runs in both themes
 * and in English and German, the long case (the language is served per page through `page.route`, so the stub's
 * shared settings stay untouched).
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, pinClock, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER, STATE_HEADER } from './stub-api';

const THEMES = ['light', 'dark'] as const;
const LANGUAGES = ['en', 'de'] as const;
type Language = (typeof LANGUAGES)[number];

interface Layout {
  readonly viewport: number;
  /** Every scroll container on the page's path: its name, `scrollWidth` and `clientWidth`. */
  readonly containers: ReadonlyArray<{ readonly name: string; readonly scroll: number; readonly client: number }>;
  /** Elements whose right edge lies past the viewport and that no fitting ancestor clips, with the overshoot. */
  readonly wide: readonly string[];
  /** Elements inside `host` that scroll sideways with content past their box. */
  readonly scrollers: readonly string[];
}

/** Measures the layout of the shell with `host` as the page under test; runs in the page. */
async function layout(page: Page, host: string): Promise<Layout> {
  return page.evaluate((selector) => {
    const viewport = document.documentElement.clientWidth;
    const name = (el: Element): string => {
      const first = typeof el.className === 'string' ? (el.className.trim().split(/\s+/)[0] ?? '') : '';
      return first === '' ? el.tagName.toLowerCase() : `${el.tagName.toLowerCase()}.${first}`;
    };
    const path = (el: Element): string => {
      const parts: string[] = [];
      for (let at: Element | null = el; at && parts.length < 4; at = at.parentElement) parts.unshift(name(at));
      return parts.join(' > ');
    };
    const clips = (el: Element): boolean => getComputedStyle(el).overflowX !== 'visible';
    const clipped = (el: Element): boolean => {
      for (let at = el.parentElement; at && at !== document.body; at = at.parentElement) {
        if (clips(at) && at.getBoundingClientRect().right <= viewport + 0.5) return true;
      }
      return false;
    };

    const root = document.scrollingElement ?? document.documentElement;
    const containers = [
      { name: 'document', el: root },
      { name: 'body', el: document.body },
      { name: '.shell-body', el: document.querySelector('.shell-body') },
      { name: 'main', el: document.querySelector('main') },
      { name: selector, el: document.querySelector(selector) },
    ].flatMap(({ name: n, el }) => (el ? [{ name: n, scroll: el.scrollWidth, client: el.clientWidth }] : []));

    const wide: string[] = [];
    const shell = document.querySelector('app-shell');
    for (const el of shell ? [shell, ...shell.querySelectorAll('*')] : []) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.right <= viewport + 0.5 || clipped(el)) continue;
      wide.push(`${path(el)} +${String(Math.round(rect.right - viewport))}`);
    }

    const scrollers: string[] = [];
    const pageHost = document.querySelector(selector);
    for (const el of pageHost ? [pageHost, ...pageHost.querySelectorAll('*')] : []) {
      const overflowX = getComputedStyle(el).overflowX;
      if ((overflowX === 'auto' || overflowX === 'scroll') && el.scrollWidth > el.clientWidth) scrollers.push(path(el));
    }
    return { viewport, containers, wide, scrollers };
  }, host);
}

function expectNoHorizontalOverflow(found: Layout, width: number): void {
  expect(found.viewport, 'viewport width').toBe(width);
  expect(found.containers.map((c) => c.name)).toContain('document');
  for (const c of found.containers) expect(c.scroll, `${c.name} scrollWidth vs clientWidth ${String(c.client)}`).toBe(c.client);
  expect(found.wide, 'elements past the viewport').toEqual([]);
  expect(found.scrollers, 'horizontal scrollers with hidden content').toEqual([]);
}

/** Serves `language` from `/api/settings` to this page only; the stub keeps its shared in-memory settings. */
async function speak(page: Page, language: Language): Promise<void> {
  if (language === 'en') return;
  await page.route('**/api/settings', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const settings = (await response.json()) as Record<string, unknown>;
    return route.fulfill({ response, json: { ...settings, language } });
  });
}

/**
 * The two workspace pages (spec 058, ISC-394): the dashboard `/w/harbor` (KPI band, TL;DR, waiting, Next up and
 * warnings in one column, no spec list) and the Specs page `/w/harbor/specs` (the spec list and its sort sheet). The
 * list states moved with the list; the old `/w/harbor?…` addresses redirect there.
 */
const WORKSPACE_PAGES = [
  { page: 'dashboard', host: 'app-dashboard-page', states: [{ name: 'default', url: '/w/harbor', sortSheet: false }] },
  {
    page: 'specs page',
    host: 'app-specs-page',
    states: [
      { name: 'default', url: '/w/harbor/specs', sortSheet: false },
      { name: 'takeable, sorted by next', url: '/w/harbor/specs?takeable=1&sort=next', sortSheet: false },
      // Spec 064 (T62): the stage chips; the old `?phase=` address redirects to `?stage=` and is measured after it.
      { name: 'stage filter', url: '/w/harbor/specs?stage=build', sortSheet: false },
      { name: 'old phase address', url: '/w/harbor/specs?phase=building', sortSheet: false },
      // Spec 064 (T49, ISC-491): the ideas alone, plain rows of the list under no heading of their own.
      { name: 'ideas only', url: '/w/harbor/specs?stage=idea', sortSheet: false },
      { name: 'sort sheet open', url: '/w/harbor/specs', sortSheet: true },
    ],
  },
] as const;
type WorkspacePage = (typeof WORKSPACE_PAGES)[number]['page'];

/** Opens `url` in the compact tier and waits until every section of `page` is rendered. */
async function openWorkspacePage(page: Page, which: WorkspacePage, url: string): Promise<void> {
  await pinClock(page);
  await page.goto(url);
  await expect(page.locator('app-shell')).toHaveAttribute('data-tier', 'compact');
  await expect(page).toHaveURL((at) => at.pathname === (which === 'dashboard' ? '/w/harbor' : '/w/harbor/specs'));
  if (which === 'dashboard') {
    const host = page.locator('app-dashboard-page');
    await expect(host.locator('app-kpi-band')).toBeVisible();
    await expect(host.locator('app-brief')).toBeVisible();
    await expect(host.locator('app-warnings-panel')).toBeVisible();
    // Spec 058: the dashboard carries no spec list.
    await expect(page.locator('app-spec-table')).toHaveCount(0);
  } else {
    await expect(page.locator('app-specs-page [data-panel="specs"]')).toBeVisible();
    // A spec row or, under `?stage=idea`, an idea row: every row is an item of the list `ol.rows`.
    await expect(page.locator('app-specs-page [data-panel="specs"] ol.rows > li').first()).toBeVisible();
  }
}

test.describe('narrow dashboard', () => {
  const width = WIDTHS.panel;

  for (const theme of THEMES) {
    test.describe(`${theme} theme`, () => {
      test.use({ ...atWidth(width), colorScheme: theme });

      for (const language of LANGUAGES) {
        for (const { page: which, host, states } of WORKSPACE_PAGES) {
          for (const state of states) {
            test(`${which} at ${String(width)}, ${theme}, ${language}, ${state.name}: no horizontal overflow`, async ({ page }) => {
              await speak(page, language);
              await openWorkspacePage(page, which, state.url);
              await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
              await expect(page.locator('html')).toHaveAttribute('lang', language);
              if (state.sortSheet) {
                await page.locator('app-spec-table [data-control="sort"]').click();
                await expect(page.locator('app-spec-table ui-sheet dialog')).toBeVisible();
              }

              expectNoHorizontalOverflow(await layout(page, host), width);
            });
          }
        }
      }
    });
  }

  // Negative control: the measurement must see an overflow when one exists, or a green above proves nothing.
  test.describe('negative control', () => {
    test.use(atWidth(width));

    test(`dashboard at ${String(width)}: the guard reports an injected overflow`, async ({ page }) => {
      await openWorkspacePage(page, 'dashboard', '/w/harbor');
      await page.addStyleTag({ content: 'app-kpi-band { min-inline-size: 720px; }' });

      const found = await layout(page, 'app-dashboard-page');
      const document = found.containers.find((c) => c.name === 'document');
      expect(document?.scroll ?? 0).toBeGreaterThan(document?.client ?? 0);
      expect(found.wide.some((entry) => entry.includes('app-kpi-band'))).toBe(true);
      expect(() => {
        expectNoHorizontalOverflow(found, width);
      }).toThrow();
    });

    test(`specs page at ${String(width)}: the guard reports an injected overflow`, async ({ page }) => {
      await openWorkspacePage(page, 'specs page', '/w/harbor/specs');
      await page.addStyleTag({ content: 'app-specs-page { min-inline-size: 720px !important; }' });

      const found = await layout(page, 'app-specs-page');
      const document = found.containers.find((c) => c.name === 'document');
      expect(document?.scroll ?? 0).toBeGreaterThan(document?.client ?? 0);
      expect(found.wide.some((entry) => entry.includes('app-specs-page'))).toBe(true);
      expect(() => {
        expectNoHorizontalOverflow(found, width);
      }).toThrow();
    });
  });
});

const OVERVIEW = { host: 'app-overview-page', column: '[data-ui="workspace-column"]' } as const;

/** The overview states the stub serves per session (ISC-16.1) and the columns each one renders. */
const OVERVIEW_STATES = [
  { state: 'two-workspaces', columns: 2 },
  { state: 'unreadable', columns: 2 },
  { state: 'empty', columns: 0 },
] as const;
type OverviewState = (typeof OVERVIEW_STATES)[number]['state'];

/** Each workspace column (the component and the plain unreadable one): its `data-ws`, `scrollWidth`, `clientWidth`. */
async function columns(page: Page): Promise<ReadonlyArray<{ ws: string; scroll: number; client: number }>> {
  return page.locator(OVERVIEW.column).evaluateAll((els) =>
    els.map((el) => ({ ws: el.getAttribute('data-ws') ?? '?', scroll: el.scrollWidth, client: el.clientWidth })),
  );
}

/**
 * Opens `/` in its own stub session serving `state`, in the compact tier, and waits until every column is settled:
 * no skeleton or busy column left.
 */
async function openOverview(page: Page, name: string, state: OverviewState): Promise<void> {
  await page.setExtraHTTPHeaders({ [SESSION_HEADER]: name, [STATE_HEADER]: state });
  const reset = await page.request.post(RESET_PATH, { headers: { [SESSION_HEADER]: name } });
  expect(reset.status()).toBe(204);
  await pinClock(page);
  await page.goto('/');
  await expect(page.locator('app-shell')).toHaveAttribute('data-tier', 'compact');
  await expect(page.locator(OVERVIEW.host)).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"]')).toHaveCount(0);
}

test.describe('narrow column', () => {
  const width = WIDTHS.panel;

  for (const theme of THEMES) {
    test.describe(`${theme} theme`, () => {
      test.use({ ...atWidth(width), colorScheme: theme });

      for (const language of LANGUAGES) {
        for (const { state, columns: count } of OVERVIEW_STATES) {
          test(`column at ${String(width)}, ${theme}, ${language}, ${state}: no horizontal overflow`, async ({ page }, info) => {
            await speak(page, language);
            await openOverview(page, `narrow-column-${info.testId}-${String(info.retry)}`, state);
            await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
            await expect(page.locator('html')).toHaveAttribute('lang', language);
            await expect(page.locator(OVERVIEW.column)).toHaveCount(count);
            // spec 024: the shared empty-state markup.
            if (count === 0) await expect(page.locator(`${OVERVIEW.host} [data-overview-empty]`)).toBeVisible();

            for (const column of await columns(page)) {
              expect(column.scroll, `column ${column.ws} scrollWidth vs clientWidth ${String(column.client)}`).toBe(column.client);
            }
            expectNoHorizontalOverflow(await layout(page, OVERVIEW.host), width);
          });
        }
      }
    });
  }

  // Negative control: the measurement must see an overflow in a column when one exists, or a green above proves nothing.
  test.describe('negative control', () => {
    test.use(atWidth(width));

    test(`column at ${String(width)}: the guard reports an injected overflow`, async ({ page }, info) => {
      await openOverview(page, `narrow-column-control-${info.testId}-${String(info.retry)}`, 'two-workspaces');
      // Spec 066 (ISC-518): every block of the tile and its card clip what they hold, so an overflow inside a block
      // (the old `.ws-head` injection) is cut off by design and reaches no scroll container. The control widens the
      // tile's card itself, the column host's own child, which no fitting ancestor clips.
      await page.addStyleTag({ content: 'app-workspace-column > ui-card.tile-frame { min-inline-size: 720px; }' });

      const found = await layout(page, OVERVIEW.host);
      expect((await columns(page)).some((c) => c.scroll > c.client)).toBe(true);
      expect(found.wide.some((entry) => /ui-card\.tile-frame \+\d+$/u.test(entry)), `the guard names the widened card: ${found.wide.join('; ')}`).toBe(true);
      expect(() => {
        expectNoHorizontalOverflow(found, width);
      }).toThrow();
    });
  });
});

const BOARD_PAGE = {
  host: 'app-board-page',
  url: '/w/harbor/board',
  radios: 'app-board-page .colswitch [role="radio"]',
  column: 'app-board-page section[data-col]',
  bar: 'app-board-page [data-colbar]',
} as const;

/**
 * Opens the workspace board in its own stub session (one test's remembered `?col` never restores in another), in the
 * compact tier, and waits until the column switch and the one column are rendered.
 */
async function openBoardPage(page: Page, name: string): Promise<void> {
  await page.setExtraHTTPHeaders({ [SESSION_HEADER]: name });
  const reset = await page.request.post(RESET_PATH, { headers: { [SESSION_HEADER]: name } });
  expect(reset.status()).toBe(204);
  await pinClock(page);
  await page.goto(BOARD_PAGE.url);
  await expect(page.locator('app-shell')).toHaveAttribute('data-tier', 'compact');
  await expect(page.locator(BOARD_PAGE.radios).first()).toBeVisible();
  await expect(page.locator(BOARD_PAGE.column)).toHaveCount(1);
}

/**
 * The board's layout, measured as for every other surface: the toolbar (T163) wraps its triggers, chips and swimlane
 * switch at compact, so no part of the board scrolls sideways.
 */
async function boardLayout(page: Page): Promise<Layout> {
  return layout(page, BOARD_PAGE.host);
}

/** Every column section of the board that is rendered and visible: its `data-col`. */
async function visibleColumns(page: Page): Promise<string[]> {
  return page
    .locator(BOARD_PAGE.column)
    .evaluateAll((els) => els.filter((el) => el.checkVisibility() && el.getBoundingClientRect().height > 0).map((el) => el.getAttribute('data-col') ?? '?'));
}

/** The order the switch's segments follow: the drop tray's slots, one per stage in the board's order. */
async function stageOrder(page: Page): Promise<string[]> {
  return page.locator(`${BOARD_PAGE.host} .tray [data-drop-col]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-drop-col') ?? '?'));
}

/**
 * The board fits `width`: the shell container (`container: shell` on `app-shell`) is compact and does not scroll
 * sideways, nor does any scroll container of the page; exactly one column is visible and the wide scroller is absent.
 */
async function expectBoardFits(page: Page, width: number): Promise<void> {
  const shell = await page
    .locator('app-shell')
    .evaluate((el) => ({ width: el.getBoundingClientRect().width, scroll: el.scrollWidth, client: el.clientWidth }));
  expect(shell.width, 'shell container width').toBeLessThanOrEqual(width);
  expect(shell.width, 'shell container in the compact tier').toBeLessThan(640);
  expect(shell.scroll, `app-shell scrollWidth vs clientWidth ${String(shell.client)}`).toBe(shell.client);
  expectNoHorizontalOverflow(await boardLayout(page), width);
  expect(await visibleColumns(page), 'visible columns').toHaveLength(1);
  await expect(page.locator(`${BOARD_PAGE.host} .scroller`), 'no wide scroller at compact').toHaveCount(0);
}

/**
 * The workspace board at compact (T145, ISC-129.2), probe `bun run e2e -- narrow -g board`. In the 600 px shell
 * container and at the 390 px phone the page and the shell never scroll sideways and the radio column switch shows
 * exactly one column; a switch writes `?col` and swaps the column; at 390 the sticky column bar takes the switch's
 * place once it has scrolled away.
 */
test.describe('narrow board page', () => {
  for (const width of [WIDTHS.panel, WIDTHS.phone]) {
    for (const theme of THEMES) {
      test.describe(`board at ${String(width)}, ${theme} theme`, () => {
        test.use({ ...atWidth(width), colorScheme: theme });

        for (const language of LANGUAGES) {
          test(`board at ${String(width)}, ${theme}, ${language}: one column, no horizontal overflow`, async ({ page }, info) => {
            await speak(page, language);
            await openBoardPage(page, `narrow-board-${info.testId}-${String(info.retry)}`);
            await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
            await expect(page.locator('html')).toHaveAttribute('lang', language);
            await expectBoardFits(page, width);
          });
        }
      });
    }

    test.describe(`board at ${String(width)}, column switch`, () => {
      test.use(atWidth(width));

      test(`board at ${String(width)}: switching the column changes ?col and the visible column`, async ({ page }, info) => {
        await openBoardPage(page, `narrow-board-switch-${info.testId}-${String(info.retry)}`);
        const order = await stageOrder(page);
        const [from] = await visibleColumns(page);
        const to = order.find((stage) => stage !== from);
        if (from === undefined || to === undefined) throw new Error(`no second column to switch to: ${order.join(', ')}`);
        const radios = page.locator(BOARD_PAGE.radios);
        await expect(radios).toHaveCount(order.length);
        await expect(radios.nth(order.indexOf(from))).toHaveAttribute('aria-checked', 'true');
        expect(new URL(page.url()).searchParams.get('col')).not.toBe(to);

        await radios.nth(order.indexOf(to)).click();
        await expect.poll(() => new URL(page.url()).searchParams.get('col')).toBe(to);
        await expect(page.locator(BOARD_PAGE.column)).toHaveAttribute('data-col', to);
        await expect(radios.nth(order.indexOf(to))).toHaveAttribute('aria-checked', 'true');
        await expect(page.locator(`${BOARD_PAGE.radios}[aria-checked="true"]`)).toHaveCount(1);
        expect(await visibleColumns(page)).toEqual([to]);
        await expectBoardFits(page, width);

        // `?col` is router state: a reload lands on the same column.
        await page.reload();
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', 'compact');
        await expect(page.locator(BOARD_PAGE.column)).toHaveCount(1);
        await expect(page.locator(BOARD_PAGE.column)).toHaveAttribute('data-col', to);
        await expectBoardFits(page, width);
      });
    });
  }

  test.describe('board at 390, sticky column bar', () => {
    test.use(atWidth(WIDTHS.phone));

    test('board at 390: the sticky column bar appears after scrolling past the switch', async ({ page }, info) => {
      await openBoardPage(page, `narrow-board-bar-${info.testId}-${String(info.retry)}`);
      // The fixture's longest column holds two cards, so the 844 px page cannot scroll the switch away; this block
      // stands in for a column longer than the screen. Only the page's height changes, never its width.
      await page.addStyleTag({ content: 'app-board-page section.one { min-block-size: 150vh !important; }' });
      const bar = page.locator(BOARD_PAGE.bar);
      const row = bar.locator('.barrow');
      await expect(bar).not.toHaveAttribute('data-away');
      await expect(row).toBeHidden();

      const below = await page
        .locator(`${BOARD_PAGE.host} .colswitch`)
        .evaluate((el) => el.getBoundingClientRect().bottom + window.scrollY);
      await page.evaluate((y) => {
        window.scrollTo(0, y);
      }, below);
      await expect(bar).toHaveAttribute('data-away', '');
      await expect(row).toBeVisible();
      await expect(row.locator('.barname .sl')).not.toBeEmpty();

      // Stuck under the 64 px sticky header row, inside the viewport's width, and the page still fits.
      const box = await row.boundingBox();
      expect(box, 'bar box').not.toBeNull();
      // spec 024: one-row header on every width (principal 2026-10-13)
      expect(Math.round(box?.y ?? -1), 'bar top under the compact header').toBe(64);
      expect(box?.x ?? -1, 'bar left edge').toBeGreaterThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? Infinity), 'bar right edge').toBeLessThanOrEqual(WIDTHS.phone + 0.5);
      expectNoHorizontalOverflow(await boardLayout(page), WIDTHS.phone);

      // Back at the top the switch is in view again and the bar steps aside.
      await page.evaluate(() => {
        window.scrollTo(0, 0);
      });
      await expect(bar).not.toHaveAttribute('data-away');
    });
  });

  test.describe('board at 390, toolbar with active filters', () => {
    test.use(atWidth(WIDTHS.phone));

    test('board at 390: the toolbar wraps its triggers, chips and swimlanes without sideways overflow', async ({ page }, info) => {
      await speak(page, 'de');
      const name = `narrow-board-toolbar-${info.testId}-${String(info.retry)}`;
      await page.setExtraHTTPHeaders({ [SESSION_HEADER]: name });
      expect((await page.request.post(RESET_PATH, { headers: { [SESSION_HEADER]: name } })).status()).toBe(204);
      await pinClock(page);
      await page.goto(`${BOARD_PAGE.url}?feature=F6&milestone=none&type=spike&type=bug&assignee=unassigned&group=milestone`);
      await expect(page.locator('app-shell')).toHaveAttribute('data-tier', 'compact');
      await expect(page.locator('app-board-filters [data-chip]')).toHaveCount(5);
      await expect(page.locator('app-board-filters [data-shown]')).toBeVisible();
      expectNoHorizontalOverflow(await boardLayout(page), WIDTHS.phone);
      const shell = await page.locator('app-shell').evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(shell.scroll, 'app-shell scrollWidth').toBe(shell.client);
    });
  });

  // Negative control: the board's measurement must see an overflow when one exists, or a green above proves nothing.
  test.describe('board negative control', () => {
    test.use(atWidth(WIDTHS.panel));

    test(`board at ${String(WIDTHS.panel)}: the guard reports an injected overflow`, async ({ page }, info) => {
      await openBoardPage(page, `narrow-board-control-${info.testId}-${String(info.retry)}`);
      await page.addStyleTag({ content: 'app-board-page .colswitch { min-inline-size: 720px !important; }' });
      const found = await boardLayout(page);
      expect(found.wide.some((entry) => entry.includes('colswitch'))).toBe(true);
      expect(() => {
        expectNoHorizontalOverflow(found, WIDTHS.panel);
      }).toThrow();
    });
  });
});
