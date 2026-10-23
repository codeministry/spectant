/**
 * Spec 020 (next-step guidance), the start `/` against the stub API (T18, ISC-238):
 * `bun run --cwd web e2e -- -g "guidance start"`.
 *
 * With `X-Spectant-Stub-Waits: 0 | 1 | 7` the first workspace column holds 0, 1 or 4 entries in `guidance.waits` (`7`
 * is harbor, whose seven waiting items core folds into one entry per spec since spec 070, ISC-568). At
 * 1440 × 900 every workspace tile's list area (`app-tile-list`, spec 066, ISC-518) counts what waits and shows at most
 * three rows, the specs in progress first, then the waiting entries in core's order, each linking to its spec with its
 * icon-only copy chip where it has a command, and, past them, "Show all n" with the right n linking to `/w/<ws>` (spec
 * 066: no `#waiting` fragment any more); with nothing in the list one sentence stands instead. Next up is not on the
 * start, and the first tile's list area lies above the fold without scrolling. Following "Show all n" lands on the
 * workspace dashboard, whose `#waiting` section lists every entry in core's order once its own "Show all n" is open. Every expectation is read from the API bodies the page renders
 * (`GET /api/workspaces`, each dashboard) and the English catalogue (`guidance-sentence.ts`), never hand-typed.
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { type GuidanceView, sentenceOf } from './guidance-sentence';
import { WAITS_HEADER, WAITS_STATES, type StubWaitsState } from './stub-api';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const EN = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as {
  guidance: { waits: { empty: string; showAll: string; label: string } };
  nextUp: { title: string };
  overview: { tile: { showAll: string } };
};

/** How many rows a tile's list area on `/` holds before "Show all n" (`TILE_ROW_LIMIT`, spec 066, ISC-518). */
const ROWS = 3;

/** The fields of a guidance entry read here (structural; `GuidanceEntryView` plus the reference and the command). */
type Entry = GuidanceView['waits'][number] & { readonly ref: string | null; readonly command: string | null };
type WorkspaceRow = { readonly slug: string; readonly readable: boolean };
type DashboardBody = { readonly guidance?: { readonly waits: readonly Entry[] } };

const text = (s: string | null | undefined): string => (s ?? '').replace(/\s+/gu, ' ').trim();

/** The workspace list the start renders, fetched with the page's stub headers. */
async function workspacesOf(request: APIRequestContext, headers: Record<string, string>): Promise<WorkspaceRow[]> {
  const answer = await request.get('/api/workspaces', { headers });
  expect(answer.status(), 'GET /api/workspaces').toBe(200);
  return ((await answer.json()) as WorkspaceRow[]).filter((w) => w.readable);
}

/** `guidance.waits` of a workspace's dashboard; a server with a clock always sets guidance. */
async function waitsOf(request: APIRequestContext, ws: string, headers: Record<string, string>): Promise<readonly Entry[]> {
  const answer = await request.get(`/api/workspaces/${encodeURIComponent(ws)}/dashboard`, { headers });
  expect(answer.status(), `GET dashboard of ${ws}`).toBe(200);
  const body = (await answer.json()) as DashboardBody;
  expect(body.guidance, `${ws}: the dashboard carries guidance`).toBeDefined();
  return body.guidance?.waits ?? [];
}

/** One rendered flat tile (spec 064, ISC-478): its spec id, its sentence (the description), link and copied command. */
type TileView = { id: string; reason: string; href: string | null; command: string | null };
async function tilesOf(scope: Locator): Promise<TileView[]> {
  return scope.locator('ui-flat-tile').evaluateAll((els) =>
    els.map((el) => {
      const link = el.querySelector('a[aria-describedby]');
      const described = link?.getAttribute('aria-describedby') ?? '';
      return {
        id: el.querySelector('[data-tile-id]')?.textContent.trim() ?? '',
        reason: described === '' ? '' : (document.getElementById(described)?.textContent ?? ''),
        href: link?.getAttribute('href') ?? null,
        command: el.querySelector('ui-command-chip code')?.textContent.trim() ?? null,
      };
    }),
  );
}

/** A tile as the API's entry should render it. */
const tileOf = (ws: string, e: Entry): TileView => ({ id: e.spec, reason: text(sentenceOf(e.reason)), href: `/w/${ws}/s/${e.spec}`, command: e.command });

/** One waiting row of a tile's list area on `/` (spec 066, ISC-518): its spec id, ref, link and copied command. */
type RowView = { id: string; ref: string | null; href: string | null; command: string | null };
async function waitingRowsOf(list: Locator): Promise<RowView[]> {
  return list.locator('li[data-tile-row][data-kind="waiting"]').evaluateAll((els) =>
    els.map((el) => ({
      id: el.getAttribute('data-id') ?? '',
      ref: el.querySelector('[data-ref]')?.textContent.trim() ?? null,
      href: el.querySelector('a[data-tile-link]')?.getAttribute('href') ?? null,
      command: el.querySelector('ui-command-chip[data-icon-only] code')?.textContent.trim() ?? null,
    })),
  );
}

/** A waiting row as the API's entry should render it. */
const rowOf = (ws: string, e: Entry): RowView => ({ id: e.spec, ref: e.ref, href: `/w/${ws}/s/${e.spec}`, command: e.command });

/** The list area of one tile (spec 066, ISC-518; the waits block before), checked against that workspace's `waits`. */
async function expectBlock(page: Page, ws: string, waits: readonly Entry[]): Promise<void> {
  const tile = page.locator(`[data-ui="workspace-column"][data-ws="${ws}"]`);
  const list = tile.locator('[data-tile-block="list"] app-tile-list');
  await expect(list, `${ws}: the tile holds its list area`).toBeVisible();
  await expect(tile.locator('[data-ui="waits-block"]'), `${ws}: the waits block left the tile (it stays on /w/<ws>)`).toHaveCount(0);
  await expect(list.locator('[data-tile-count="waits"]'), `${ws}: the counter names every waiting entry`).toContainText(String(waits.length));
  const working = await list.locator('li[data-tile-row][data-kind="working"]').count();
  const total = working + waits.length;
  const more = list.locator('a[data-tile-more]');
  await expect(list.locator('li[data-tile-row]'), `${ws}: at most ${ROWS} rows`).toHaveCount(Math.min(ROWS, total));
  if (total === 0) {
    await expect(list.locator('[data-tile-empty]'), `${ws}: one sentence instead of an empty list`).toHaveText(EN.guidance.waits.empty);
    await expect(more).toHaveCount(0);
    return;
  }
  await expect(list.locator('[data-tile-empty]')).toHaveCount(0);
  for (const row of await list.locator('li[data-tile-row]').all()) await expect(row).toBeVisible();
  // The specs in progress stand first; the waiting entries fill the places left, the first ones in core's order.
  const shown = waits.slice(0, Math.max(0, ROWS - working));
  expect(
    await waitingRowsOf(list),
    `${ws}: the waiting rows are the first entries in core's order, each a link to its spec, its chip its command`,
  ).toEqual(shown.map((e) => rowOf(ws, e)));
  if (total > ROWS) {
    await expect(more, `${ws}: "Show all n" names every entry`).toHaveText(EN.overview.tile.showAll.replace('{{n}}', String(total)));
    await expect(more, `${ws}: "Show all n" leads to the workspace dashboard, without a fragment`).toHaveAttribute('href', `/w/${ws}`);
  } else {
    await expect(more).toHaveCount(0);
  }
}

test.describe('guidance start', () => {
  test.use(atWidth(WIDTHS.desktop));

  // `7` names harbor's seven waiting items; core folds them into one entry per spec (spec 070, ISC-568): 006, 002, 005
  // and 004. Four entries still pass the tile's three rows and the dashboard's three tiles, so "Show all n" stays covered.
  const COUNTS: Readonly<Record<StubWaitsState, number>> = { '0': 0, '1': 1, '7': 4 };

  for (const variant of WAITS_STATES) {
    test(`start: ${variant} waiting — the list area per tile, its rows and "Show all n", no Next up, above the fold`, async ({ page, request }) => {
      const headers = { [WAITS_HEADER]: variant };
      await page.context().setExtraHTTPHeaders(headers);
      const workspaces = await workspacesOf(request, headers);
      expect(workspaces.length, 'the start lists workspaces').toBeGreaterThan(0);
      const waits = new Map<string, readonly Entry[]>();
      for (const w of workspaces) waits.set(w.slug, await waitsOf(request, w.slug, headers));
      const firstWs = workspaces[0]?.slug ?? '';
      expect(waits.get(firstWs)?.length, `the first column (${firstWs}) holds ${COUNTS[variant]} waiting entries`).toBe(COUNTS[variant]);

      await page.goto('/');
      for (const w of workspaces) await expectBlock(page, w.slug, waits.get(w.slug) ?? []);

      // Next up stays off the start (spec 024, T79).
      await expect(page.locator('[data-next-up]')).toHaveCount(0);
      await expect(page.locator('main').getByText(EN.nextUp.title, { exact: true })).toHaveCount(0);

      // The first tile's list area lies whole above the fold, without scrolling.
      expect(await page.evaluate(() => window.scrollY), 'the start is not scrolled').toBe(0);
      const box = await page.locator(`[data-ui="workspace-column"][data-ws="${firstWs}"] [data-tile-block="list"]`).boundingBox();
      expect(box, 'the first list area has a box').not.toBeNull();
      expect(box?.y ?? -1, 'the list area starts inside the viewport').toBeGreaterThanOrEqual(0);
      expect((box?.y ?? 0) + (box?.height ?? Infinity), 'the list area ends above the fold').toBeLessThanOrEqual(900);
    });
  }

  test('start: "Show all n" leads to the workspace dashboard, whose #waiting section lists every entry', async ({ page, request }) => {
    const headers = { [WAITS_HEADER]: '7' };
    await page.context().setExtraHTTPHeaders(headers);
    const ws = (await workspacesOf(request, headers))[0]?.slug ?? '';
    const waits = await waitsOf(request, ws, headers);
    expect(waits.length, 'harbor: one entry per waiting spec (spec 070)').toBe(COUNTS['7']);
    expect(waits.length, 'more entries than the tile has rows, so "Show all n" stands').toBeGreaterThan(ROWS);

    await page.goto('/');
    // Spec 066: the tile's "Show all n" leads to `/w/<ws>` without the `#waiting` fragment (a design decision), so the
    // dashboard opens at its top, unfocused, and its own "Show all n" unfolds the rest.
    await page.locator(`[data-ui="workspace-column"][data-ws="${ws}"] [data-tile-block="list"] a[data-tile-more]`).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}$`, 'u'));

    const section = page.locator('#waiting');
    await expect(section).toHaveAttribute('data-count', String(waits.length));
    const showAll = section.locator('[data-show-all]');
    if ((await showAll.getAttribute('data-open')) === null) await showAll.locator('[data-fold-toggle]').click();
    await expect(showAll, 'the dashboard\'s "Show all n" opens').toHaveAttribute('data-open', '');
    const tiles = section.locator('ui-flat-tile');
    await expect(tiles, 'every entry stands as a tile').toHaveCount(waits.length);
    for (const tile of await tiles.all()) await expect(tile).toBeVisible();
    await expect(section).toBeInViewport();

    // Every tile in core's order with its sentence as its description, and its own copy chip where it has a command.
    const listed = (await tilesOf(section)).map((t) => ({ ...t, reason: text(t.reason) }));
    expect(listed, 'the section lists every entry in core\'s order with its sentence and its chip').toEqual(waits.map((e) => tileOf(ws, e)));
  });
});
