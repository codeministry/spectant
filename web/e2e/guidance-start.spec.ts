/**
 * Spec 020 (next-step guidance), the start `/` against the stub API (T18, ISC-238):
 * `bun run --cwd web e2e -- -g "guidance start"`.
 *
 * With `X-Spectant-Stub-Waits: 0 | 1 | 7` the first workspace column holds 0, 1 or 7 entries in `guidance.waits`. At
 * 1440 × 900 every column's block "Waits on you" shows the top entry highlighted (spec, sentence, copy chip), at most
 * four more rows linking to their spec with their sentence, and "+n more" with the right n linking to `/w/<ws>#waiting`;
 * with nothing waiting one sentence stands instead. Next up is not on the start, and the first column's block lies
 * above the fold without scrolling. Following "+n more" lands on the workspace dashboard's `#waiting` section, open and
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
  guidance: { waits: { empty: string; more: string; label: string } };
  nextUp: { title: string };
};

/** How many entries follow the highlighted one on `/` (ISC-238). */
const ROWS = 4;

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

/** One rendered row: its spec id, its sentence and its link. */
type RowView = { id: string; reason: string; href: string | null };
async function rowsOf(scope: Locator): Promise<RowView[]> {
  return scope.locator('[data-row]').evaluateAll((els) =>
    els.map((el) => ({
      id: el.querySelector('.id')?.textContent.trim() ?? '',
      reason: el.querySelector('[data-reason]')?.textContent ?? '',
      href: el.querySelector('a')?.getAttribute('href') ?? null,
    })),
  );
}

/** The block of one column, checked against that workspace's `waits`. */
async function expectBlock(page: Page, ws: string, waits: readonly Entry[]): Promise<void> {
  const block = page.locator(`[data-ui="workspace-column"][data-ws="${ws}"] [data-ui="waits-block"]`);
  await expect(block, `${ws}: the column holds the block`).toBeVisible();
  await expect(block).toHaveAttribute('data-count', String(waits.length));
  await expect(block.getByRole('heading', { name: EN.guidance.waits.label })).toBeVisible();
  const top = block.locator('[data-top]');
  const more = block.locator('[data-more]');
  const [first, ...rest] = waits;
  if (first === undefined) {
    await expect(block.locator('[data-empty]'), `${ws}: one sentence instead of an empty block`).toHaveText(EN.guidance.waits.empty);
    await expect(top).toHaveCount(0);
    await expect(block.locator('[data-row]')).toHaveCount(0);
    await expect(more).toHaveCount(0);
    return;
  }
  await expect(block.locator('[data-empty]')).toHaveCount(0);
  await expect(top, `${ws}: the top entry stands highlighted`).toBeVisible();
  const id = top.locator('.id');
  await expect(id).toHaveText(first.spec);
  await expect(id).toHaveAttribute('href', `/w/${ws}/s/${first.spec}`);
  expect(text(await top.locator('[data-reason]').textContent()), `${ws}: the top entry's sentence`).toBe(text(sentenceOf(first.reason)));
  if (first.command !== null) {
    const chip = top.locator('ui-command-chip');
    await expect(chip.locator('code')).toHaveText(first.command);
    await expect(chip.getByRole('button')).toBeVisible();
  }
  const shown = rest.slice(0, ROWS);
  const rows = await rowsOf(block);
  expect(rows.length, `${ws}: at most ${ROWS} more rows`).toBeLessThanOrEqual(ROWS);
  expect(
    rows.map((r) => ({ id: r.id, reason: text(r.reason), href: r.href })),
    `${ws}: the rows are the next entries in core's order, each a link to its spec with its sentence`,
  ).toEqual(shown.map((e) => ({ id: e.spec, reason: text(sentenceOf(e.reason)), href: `/w/${ws}/s/${e.spec}` })));
  const n = rest.length - shown.length;
  if (n > 0) {
    await expect(more, `${ws}: "+n more" names the rest`).toHaveText(EN.guidance.waits.more.replace('{{n}}', String(n)));
    await expect(more).toHaveAttribute('href', `/w/${ws}#waiting`);
  } else {
    await expect(more).toHaveCount(0);
  }
}

test.describe('guidance start', () => {
  test.use(atWidth(WIDTHS.desktop));

  const COUNTS: Readonly<Record<StubWaitsState, number>> = { '0': 0, '1': 1, '7': 7 };

  for (const variant of WAITS_STATES) {
    test(`start: ${variant} waiting — the block per column, its rows and "+n more", no Next up, above the fold`, async ({ page, request }) => {
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

  test('start: "+n more" leads to the dashboard\'s #waiting section, open and focused, listing every entry', async ({ page, request }) => {
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
    await expect(section.locator('[data-top]')).toBeVisible();
    for (const row of await section.locator('[data-row]').all()) await expect(row).toBeVisible();
    await expect(section).toBeInViewport();

    const top = section.locator('[data-top]');
    const listed = [
      { id: text(await top.locator('.id').textContent()), reason: text(await top.locator('[data-reason]').textContent()) },
      ...(await rowsOf(section)).map((r) => ({ id: r.id, reason: text(r.reason) })),
    ];
    expect(listed, 'the section lists every entry in core\'s order with its sentence').toEqual(
      waits.map((e) => ({ id: e.spec, reason: text(sentenceOf(e.reason)) })),
    );
    // Every row of the section carries its own copy chip.
    for (const [i, entry] of waits.entries()) {
      if (entry.command === null) continue;
      const scope = i === 0 ? top : section.locator('[data-row]').nth(i - 1);
      await expect(scope.locator('ui-command-chip code')).toHaveText(entry.command);
    }
  });
});
