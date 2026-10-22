/**
 * Spec 020 (next-step guidance), the start `/` against the stub API (T18, ISC-238):
 * `bun run --cwd web e2e -- -g "guidance start"`.
 *
 * With `X-Spectant-Stub-Waits: 0 | 1 | 7` the first workspace column holds 0, 1 or 7 entries in `guidance.waits`. At
 * 1440 × 900 every column's block "Waits on you" shows at most three flat tiles (spec 064, ISC-478: none highlighted,
 * each linking to its spec, its sentence the tile's description, its copy chip where it has a command) and, past them,
 * "Show all n" with the right n linking to `/w/<ws>#waiting`; with nothing waiting one sentence stands instead. Next up
 * is not on the start, and the first column's block lies above the fold without scrolling. Following "Show all n"
 * lands on the workspace dashboard's `#waiting` section, open and
 * focused, listing every entry in core's order. Every expectation is read from the API bodies the page renders
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
};

/** How many flat tiles stand on `/` before "Show all n" (`TILE_LIMIT`, spec 064, ISC-478). */
const TILES = 3;

/** The fields of a guidance entry read here (structural; `GuidanceEntryView` plus the command). */
type Entry = GuidanceView['waits'][number] & { readonly command: string | null };
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

/** The block of one column, checked against that workspace's `waits`. */
async function expectBlock(page: Page, ws: string, waits: readonly Entry[]): Promise<void> {
  const block = page.locator(`[data-ui="workspace-column"][data-ws="${ws}"] [data-ui="waits-block"]`);
  await expect(block, `${ws}: the column holds the block`).toBeVisible();
  await expect(block).toHaveAttribute('data-count', String(waits.length));
  await expect(block.getByRole('heading', { name: EN.guidance.waits.label })).toBeVisible();
  const more = block.locator('[data-more]');
  // No top card and no "+n more" rows any more: every entry is the same flat tile (ISC-478).
  await expect(block.locator('[data-top], [data-row]'), `${ws}: no highlighted entry, no row`).toHaveCount(0);
  if (waits.length === 0) {
    await expect(block.locator('[data-empty]'), `${ws}: one sentence instead of an empty block`).toHaveText(EN.guidance.waits.empty);
    await expect(block.locator('ui-flat-tile')).toHaveCount(0);
    await expect(more).toHaveCount(0);
    return;
  }
  await expect(block.locator('[data-empty]')).toHaveCount(0);
  const shown = waits.slice(0, TILES);
  for (const tile of await block.locator('ui-flat-tile').all()) await expect(tile).toBeVisible();
  const tiles = await tilesOf(block);
  expect(
    tiles.map((t) => ({ ...t, reason: text(t.reason) })),
    `${ws}: at most ${TILES} tiles, the first entries in core's order, each a link to its spec, its sentence the description, its chip its command`,
  ).toEqual(shown.map((e) => tileOf(ws, e)));
  if (waits.length > TILES) {
    await expect(more.locator('[data-visible]'), `${ws}: "Show all n" names every entry`).toHaveText(EN.guidance.waits.showAll.replace('{{count}}', String(waits.length)));
    await expect(more).toHaveAttribute('href', `/w/${ws}#waiting`);
  } else {
    await expect(more).toHaveCount(0);
  }
}

test.describe('guidance start', () => {
  test.use(atWidth(WIDTHS.desktop));

  const COUNTS: Readonly<Record<StubWaitsState, number>> = { '0': 0, '1': 1, '7': 7 };

  for (const variant of WAITS_STATES) {
    test(`start: ${variant} waiting — the block per column, its tiles and "Show all n", no Next up, above the fold`, async ({ page, request }) => {
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

      // The first column's block lies whole above the fold, without scrolling.
      expect(await page.evaluate(() => window.scrollY), 'the start is not scrolled').toBe(0);
      const box = await page.locator(`[data-ui="workspace-column"][data-ws="${firstWs}"] [data-ui="waits-block"]`).boundingBox();
      expect(box, 'the first block has a box').not.toBeNull();
      expect(box?.y ?? -1, 'the block starts inside the viewport').toBeGreaterThanOrEqual(0);
      expect((box?.y ?? 0) + (box?.height ?? Infinity), 'the block ends above the fold').toBeLessThanOrEqual(900);
    });
  }

  test('start: "Show all n" leads to the dashboard\'s #waiting section, open and focused, listing every entry', async ({ page, request }) => {
    const headers = { [WAITS_HEADER]: '7' };
    await page.context().setExtraHTTPHeaders(headers);
    const ws = (await workspacesOf(request, headers))[0]?.slug ?? '';
    const waits = await waitsOf(request, ws, headers);
    expect(waits.length).toBe(7);

    await page.goto('/');
    await page.locator(`[data-ui="workspace-column"][data-ws="${ws}"] [data-ui="waits-block"] [data-more]`).click();
    await expect(page).toHaveURL(new RegExp(`/w/${ws}#waiting$`, 'u'));

    const section = page.locator('#waiting');
    await expect(section, 'the #waiting section is focused').toBeFocused();
    await expect(section).toHaveAttribute('data-count', String(waits.length));
    await expect(section.locator('[data-show-all]'), 'arriving over #waiting opens "Show all n"').toHaveAttribute('data-open', '');
    const tiles = section.locator('ui-flat-tile');
    await expect(tiles, 'every entry stands as a tile').toHaveCount(waits.length);
    for (const tile of await tiles.all()) await expect(tile).toBeVisible();
    await expect(section).toBeInViewport();

    // Every tile in core's order with its sentence as its description, and its own copy chip where it has a command.
    const listed = (await tilesOf(section)).map((t) => ({ ...t, reason: text(t.reason) }));
    expect(listed, 'the section lists every entry in core\'s order with its sentence and its chip').toEqual(waits.map((e) => tileOf(ws, e)));
  });
});
