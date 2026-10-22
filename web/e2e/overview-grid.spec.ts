/**
 * Spec 066 (overview calm grid), the list area of a workspace tile on `/` against the stub API (T6, ISC-518):
 * `bun run e2e -- overview-grid -g "list area"`.
 *
 * Every tile's list area (`app-tile-list` inside `[data-tile-block="list"]`) holds at most three rows: first the specs
 * in work (`data-kind="working"`), then what waits (`data-kind="waiting"`), each row a link to its spec
 * (`/w/<ws>/s/<id>`). Above the rows stand both counters, always, also at 0; below them the reserved foot
 * `[data-tile-foot]`, which carries "Show all n" (`a[data-tile-more]`, n = in work + waiting, to `/w/<ws>`) only past
 * three entries. With no entry one empty line stands (`guidance.waits.empty`) and the free places stay without a
 * placeholder. Run under `X-Spectant-Stub-Waits` 0, 1 and 7 and `X-Spectant-Stub-Locks: working`, at 1440 and 390 px.
 * Every expectation is read from the API bodies the page renders (`GET /api/workspaces`, each dashboard's `specs[].taken`
 * through the same rule as `workingOf`, and `guidance.waits`) and the stub's constants, never hand-typed.
 */
import { readFileSync } from 'node:fs';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { LOCKS_HEADER, STUB_RUN, STUB_WAITS, STUB_WORKING, WAITS_HEADER } from './stub-api';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const EN = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as {
  guidance: { waits: { empty: string } };
};

/** How many rows the list area holds (design.md § Listenbereich, ISC-518). */
const ROWS = 3;

type Kind = 'working' | 'waiting';
type Row = { readonly kind: Kind; readonly id: string; readonly href: string };
type WorkspaceRow = { readonly slug: string; readonly readable: boolean };
type DashboardBody = {
  readonly specs?: ReadonlyArray<{ readonly id?: string; readonly taken?: ReadonlyArray<{ readonly session?: string }> }>;
  readonly guidance?: { readonly waits: ReadonlyArray<{ readonly spec: string }> };
};

/** What one tile's list area must show, read from the workspace's dashboard body. */
type Expected = { readonly ws: string; readonly working: readonly string[]; readonly waits: readonly string[] };

async function workspacesOf(request: APIRequestContext, headers: Record<string, string>): Promise<string[]> {
  const answer = await request.get('/api/workspaces', { headers });
  expect(answer.status(), 'GET /api/workspaces').toBe(200);
  return ((await answer.json()) as WorkspaceRow[]).filter((w) => w.readable).map((w) => w.slug);
}

/** The specs in work (a row with a `taken` entry naming a session, served order, as `workingOf`) and the waiting specs. */
async function expectedOf(request: APIRequestContext, ws: string, headers: Record<string, string>): Promise<Expected> {
  const answer = await request.get(`/api/workspaces/${encodeURIComponent(ws)}/dashboard`, { headers });
  expect(answer.status(), `GET dashboard of ${ws}`).toBe(200);
  const body = (await answer.json()) as DashboardBody;
  expect(body.guidance, `${ws}: the dashboard carries guidance`).toBeDefined();
  const working = (body.specs ?? [])
    .filter((row) => typeof row.id === 'string' && (row.taken ?? []).some((lock) => typeof lock.session === 'string'))
    .map((row) => row.id ?? '');
  return { ws, working, waits: (body.guidance?.waits ?? []).map((e) => e.spec) };
}

/** The rows the list area must show: in work before waiting, at most three, each linking to its spec. */
const rowsOf = (e: Expected): Row[] =>
  [
    ...e.working.map((id): Row => ({ kind: 'working', id, href: `/w/${e.ws}/s/${id}` })),
    ...e.waits.map((id): Row => ({ kind: 'waiting', id, href: `/w/${e.ws}/s/${id}` })),
  ].slice(0, ROWS);

/** The list area of a tile, picked by its `data-ws`. */
const listOf = (page: Page, ws: string): Locator => page.locator(`[data-ui="workspace-column"][data-ws="${ws}"] [data-tile-block="list"]`);

/** The number standing alone in a counter's text ("In progress 4", "Waits on you 0"). */
const holds = (n: number): RegExp => new RegExp(`(^|\\D)${String(n)}(\\D|$)`, 'u');

/** The list area checked against the API's entries: counters, rows, empty line, foot and "Show all n". */
async function expectList(page: Page, e: Expected): Promise<void> {
  const list = listOf(page, e.ws);
  await expect(list, `${e.ws}: the tile holds its list area`).toBeVisible();

  const counters = { working: list.locator('[data-tile-count="working"]'), waits: list.locator('[data-tile-count="waits"]') };
  await expect(counters.working, `${e.ws}: the counter "in work" counts every spec in work`).toHaveText(holds(e.working.length));
  await expect(counters.waits, `${e.ws}: the counter "waiting" counts every waiting entry`).toHaveText(holds(e.waits.length));

  const expected = rowsOf(e);
  const rows = list.locator('li[data-tile-row]');
  await expect(rows, `${e.ws}: at most ${String(ROWS)} rows`).toHaveCount(expected.length);
  const shown = await rows.evaluateAll((els) =>
    els.map((el) => ({
      kind: el.getAttribute('data-kind') ?? '',
      id: el.getAttribute('data-id') ?? '',
      href: el.querySelector('a[data-tile-link]')?.getAttribute('href') ?? '',
    })),
  );
  expect(shown, `${e.ws}: in work before waiting, in served order, each row a link to its spec`).toEqual(expected);
  for (const row of await rows.all()) await expect(row).toBeVisible();

  // The counters stand above the rows; the free places stay without a placeholder.
  const placement = await list.evaluate((el) => {
    const counter = el.querySelector('[data-tile-count]');
    const firstRow = el.querySelector('li[data-tile-row], [data-tile-empty]');
    const before = counter !== null && firstRow !== null && (counter.compareDocumentPosition(firstRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    const fillers = [...el.querySelectorAll('li')].filter((li) => !li.hasAttribute('data-tile-row') && !li.hasAttribute('data-tile-empty')).length;
    return { before, fillers };
  });
  expect(placement.before, `${e.ws}: the counters stand above the rows`).toBe(true);
  expect(placement.fillers, `${e.ws}: no placeholder fills a free place`).toBe(0);

  const empty = list.locator('[data-tile-empty]');
  if (expected.length === 0) {
    await expect(empty, `${e.ws}: one empty line stands instead of rows`).toHaveCount(1);
    await expect(empty).toContainText(EN.guidance.waits.empty);
  } else {
    await expect(empty, `${e.ws}: no empty line beside rows`).toHaveCount(0);
  }

  await expect(list.locator('[data-tile-foot]'), `${e.ws}: the foot is always reserved`).toHaveCount(1);
  const more = list.locator('a[data-tile-more]');
  const total = e.working.length + e.waits.length;
  if (total > ROWS) {
    await expect(more, `${e.ws}: "Show all n" past ${String(ROWS)} entries`).toHaveCount(1);
    await expect(more).toHaveAttribute('href', `/w/${e.ws}`);
    await expect(more, `${e.ws}: n = in work + waiting`).toHaveText(holds(total));
  } else {
    await expect(more, `${e.ws}: no "Show all n" for ${String(total)} entries`).toHaveCount(0);
  }
}

/** Sets the stub headers, reads the target tile's entries, opens `/` and checks every tile's list area. */
async function openStart(page: Page, request: APIRequestContext, headers: Record<string, string>, target: string): Promise<Expected> {
  await page.context().setExtraHTTPHeaders(headers);
  const slugs = await workspacesOf(request, headers);
  expect(slugs, `the start lists ${target}`).toContain(target);
  const all = await Promise.all(slugs.map((ws) => expectedOf(request, ws, headers)));
  await page.goto('/');
  for (const e of all) await expectList(page, e);
  const mine = all.find((e) => e.ws === target);
  expect(mine, `${target} is read`).toBeDefined();
  return mine ?? { ws: target, working: [], waits: [] };
}

for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
  test.describe(`list area at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`list area: waits 0 — the first tile shows both counters at 0, one empty line and no "Show all n" (${String(width)})`, async ({ page, request }) => {
      const first = STUB_WAITS.workspaces['0'][0]?.slug ?? '';
      const e = await openStart(page, request, { [WAITS_HEADER]: '0' }, first);
      expect([e.working.length, e.waits.length], `${first}: nothing in work, nothing waiting`).toEqual([0, 0]);
      await expect(listOf(page, first).locator('li[data-tile-row]')).toHaveCount(0);
    });

    test(`list area: waits 1 — the first tile shows one waiting row and no empty line (${String(width)})`, async ({ page, request }) => {
      const first = STUB_WAITS.workspaces['1'][0]?.slug ?? '';
      expect(first, 'the waits-1 variant leads with the run workspace').toBe(STUB_RUN.workspace.slug);
      const e = await openStart(page, request, { [WAITS_HEADER]: '1' }, first);
      expect(e.waits.length, `${first}: one waiting entry`).toBe(1);
      const list = listOf(page, first);
      await expect(list.locator('li[data-tile-row][data-kind="waiting"]')).toHaveCount(1);
      await expect(list.locator('[data-tile-empty]')).toHaveCount(0);
    });

    test(`list area: waits 7 — harbor shows three waiting rows, counter 7 and "Show all 7" to /w/harbor (${String(width)})`, async ({ page, request }) => {
      const first = STUB_WAITS.workspaces['7'][0]?.slug ?? '';
      const e = await openStart(page, request, { [WAITS_HEADER]: '7' }, first);
      expect(e.waits.length, `${first}: seven waiting entries`).toBe(7);
      const list = listOf(page, first);
      await expect(list.locator('li[data-tile-row][data-kind="waiting"]')).toHaveCount(ROWS);
      await expect(list.locator('a[data-tile-more]')).toHaveAttribute('href', `/w/${first}`);
    });

    test(`list area: locks working — harbor's rows start with the specs in work, counter 4, "Show all" in work + waiting (${String(width)})`, async ({ page, request }) => {
      const ws = STUB_WORKING.workspace;
      const e = await openStart(page, request, { [LOCKS_HEADER]: 'working' }, ws);
      expect(e.working, `${ws}: the specs in work are STUB_WORKING's, in served order`).toEqual([...STUB_WORKING.specs]);
      const list = listOf(page, ws);
      await expect(list.locator('li[data-tile-row][data-kind="working"]'), 'four in work fill all three rows').toHaveCount(ROWS);
      await expect(list.locator('[data-tile-count="working"]')).toHaveText(holds(STUB_WORKING.specs.length));
      await expect(list.locator('a[data-tile-more]')).toHaveText(holds(STUB_WORKING.specs.length + e.waits.length));
    });

    test(`list area: a row links to its spec page, as the waits tiles do (${String(width)})`, async ({ page, request }) => {
      const ws = STUB_WORKING.workspace;
      await openStart(page, request, { [LOCKS_HEADER]: 'working' }, ws);
      const link = listOf(page, ws).locator('li[data-tile-row]').first().locator('a[data-tile-link]');
      await expect(link).toHaveAttribute('href', `/w/${ws}/s/${STUB_WORKING.specs[0]}`);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`/w/${ws}/s/${STUB_WORKING.specs[0]}$`, 'u'));
    });
  });
}
