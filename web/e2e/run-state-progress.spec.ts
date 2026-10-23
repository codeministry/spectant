// Spec 070 (C5, ISC-571; C7, ISC-573): the block "In progress" on `/w/<ws>` lists every spec with an open run, with
// its phase, start and session, and still every spec a session holds a claim of (ISC-508), each spec once. Anti: a spec
// with an open run is missing from both "Waits on you" and "In progress", or it stays in "In progress" after its
// `run-end` without a claim lock.
//
// `X-Spectant-Stub-Locks: runs` serves beacon rebuilt by core over its activity log, its rows read over the log's locks
// as the server reads them; `X-Spectant-Stub-Run` picks the variant (web/CLAUDE.md, "Driving a run's state"):
// `running` opens review (006), implement (005, which also holds two claim locks) and tasks (003); `phases` adds a
// `/spec done 009` run and a probe after 005's implement run; `none` and `ended` drop and close 003's run.
// `X-Spectant-Stub-Locks: working` holds a claim on four harbor specs without a run.
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { LOCKS_HEADER, RUN_HEADER, STUB_NOW, STUB_PHASES, STUB_RUN, STUB_WORKING, type StubRunState } from './stub-api';

const WS = STUB_RUN.workspace.slug;
const TILE_LIMIT = 3;

const workingBlock = (page: Page): Locator => page.locator('ui-working-block');
const tiles = (page: Page): Locator => workingBlock(page).locator('ui-flat-tile');
/** The ids the tiles of "In progress" show, in order. */
const tileIds = (page: Page): Promise<string[]> => tiles(page).locator('[data-id]').allInnerTexts();
/** The spec ids "Waits on you" lists (its tile labels start with the spec id). */
const waitIds = (page: Page): Promise<string[]> =>
  page.locator('ui-waits-block [data-tile-id]').evaluateAll((els) => els.map((el) => el.textContent.trim().slice(0, 3)));
const tileOf = (page: Page, id: string): Locator => tiles(page).filter({ has: page.locator(`[data-id]:text-is("${id}")`) });

/** The ids of beacon's rows that carry an open run, as the dashboard route serves them under one variant. */
async function openRunIds(page: Page, run: StubRunState): Promise<string[]> {
  const res = await page.request.get(`/api/workspaces/${WS}/dashboard`, { headers: { [LOCKS_HEADER]: 'runs', [RUN_HEADER]: run } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { specs: Array<{ id: string; run?: unknown }> };
  return body.specs.filter((r) => r.run !== undefined).map((r) => r.id);
}

async function openDashboard(page: Page, run: StubRunState): Promise<void> {
  await page.setExtraHTTPHeaders({ [LOCKS_HEADER]: 'runs', [RUN_HEADER]: run });
  await page.goto(`/w/${WS}`);
  await page.locator('ui-waits-block').first().waitFor({ state: 'attached', timeout: 15_000 });
}

test.describe('in-progress-runs (ISC-571)', () => {
  test.use({ ...atWidth(WIDTHS.desktop), clockAt: STUB_NOW });

  test('in-progress-runs: every spec with an open run is one tile with phase, start and session; lock and run once', async ({ page }) => {
    await openDashboard(page, 'running');
    const block = workingBlock(page);
    await expect(block.getByRole('heading', { name: 'In progress' })).toBeVisible();
    await expect.poll(() => tileIds(page)).toEqual(['006', '005', '003']);
    await expect(block.locator('ui-chip').first()).toHaveText('3');

    await expect(tileOf(page, '006').locator('[data-phase]')).toHaveText('review');
    await expect(tileOf(page, '006').locator('[data-agent]')).toHaveText('a:claude:sess-61');
    await expect(tileOf(page, '006').locator('[data-since] time')).toHaveAttribute('datetime', '2026-03-08T11:40:00.000Z');
    await expect(tileOf(page, '006').locator('[data-since]')).toHaveText('3 h');
    // 005 holds two claim locks and runs `implement`: one tile, its run's phase and session.
    await expect(tileOf(page, '005')).toHaveCount(1);
    await expect(tileOf(page, '005').locator('[data-phase]')).toHaveText('implement');
    await expect(tileOf(page, '005').locator('[data-agent]')).toHaveText('a:claude:sess-52');
    await expect(tileOf(page, '003').locator('[data-phase]')).toHaveText('tasks');
    await expect(tileOf(page, '003').locator('[data-agent]')).toHaveText(STUB_RUN.session);
    await expect(tileOf(page, '003').locator('[data-since]')).toHaveText('8 min');
    // ISC-508: a click leads to the spec's live view.
    await tileOf(page, '003').locator('a.cover').click();
    await expect(page).toHaveURL(`/w/${WS}/s/003/board`);
  });

  test('in-progress-runs: review, implement while testing and done each stand once; "Show all" lists all four', async ({ page }) => {
    await openDashboard(page, 'phases');
    await expect.poll(() => tileIds(page)).toEqual(['009', '006', '005']);
    await expect(workingBlock(page).locator('ui-chip').first()).toHaveText('4');
    await expect(tileOf(page, '009').locator('[data-phase]')).toHaveText('closing');
    await expect(tileOf(page, '009').locator('[data-agent]')).toHaveText(STUB_PHASES.done.session);
    await expect(tileOf(page, '009').locator('[data-since]')).toHaveText('5 min');
    // An implement run's latest step, a probe, reads as testing.
    await expect(tileOf(page, '005').locator('[data-phase]')).toHaveText('implement · testing');
    await expect(tileOf(page, '005')).toHaveAttribute('data-step', 'probe');

    const more = workingBlock(page).locator('a.more[data-show-all]');
    await expect(more).toHaveText('Show all 4');
    await more.click();
    await expect(page).toHaveURL(`/w/${WS}/specs?working=1`);
    const listIds = (): Promise<string[]> =>
      page.locator('app-spec-table a.row-link[data-spec-row]').evaluateAll((els) => els.map((el) => el.getAttribute('data-spec-row') ?? '').sort());
    await expect.poll(listIds).toEqual(['003', '005', '006', '009']);
  });

  test('in-progress-runs: in German the phase and the testing step read in the catalogue', async ({ page }) => {
    await page.route('**/api/settings', async (route) => {
      const res = await route.fetch();
      const body = (await res.json()) as Record<string, unknown>;
      await route.fulfill({ response: res, json: { ...body, language: 'de' } });
    });
    await openDashboard(page, 'phases');
    await expect(workingBlock(page).getByRole('heading', { name: 'In Arbeit' })).toBeVisible();
    await expect(tileOf(page, '005').locator('[data-phase]')).toHaveText('Umsetzung · Testen');
    await expect(tileOf(page, '009').locator('[data-phase]')).toHaveText('Abschluss');
  });

  test.describe('lock without a run (ISC-508 held)', () => {
    test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'working' } });

    test('in-progress-runs: a spec a session holds a claim of stays a tile, with its holder and no phase', async ({ page }) => {
      await page.goto('/w/harbor');
      await expect.poll(() => tileIds(page)).toEqual(STUB_WORKING.specs.slice(0, TILE_LIMIT));
      const first = tileOf(page, STUB_WORKING.specs[0]);
      await expect(first.locator('[data-agent]')).toHaveText(`a:claude:stub-${STUB_WORKING.specs[0]}-${STUB_WORKING.claims[0].toLowerCase()}`);
      await expect(first.locator('[data-phase]')).toHaveCount(0);
    });
  });
});

test.describe('run-open-close (ISC-573, anti)', () => {
  test.use({ ...atWidth(WIDTHS.desktop), clockAt: STUB_NOW });

  test('run-open-close: no spec with an open run is missing from both blocks, and 003 leaves "In progress" at its run-end', async ({ page }) => {
    const missing: string[] = [];
    const seen: Record<string, string[]> = {};
    for (const run of ['none', 'running', 'ended', 'phases'] as const) {
      await openDashboard(page, run);
      await expect(tiles(page).first()).toBeVisible();
      const shown = new Set([...(await tileIds(page)), ...(await waitIds(page))]);
      const count = Number(await workingBlock(page).locator('ui-chip').first().innerText());
      const open = await openRunIds(page, run);
      // A run behind "Show all" still counts in the block's total; every open run beyond the limit is in that count.
      const hidden = open.filter((id) => !shown.has(id));
      if (hidden.length > Math.max(0, count - TILE_LIMIT)) missing.push(...hidden.map((id) => `${run}:${id}`));
      seen[run] = await tileIds(page);
    }
    expect(missing).toEqual([]);
    // Open, then closed: 003 runs `/spec tasks 003` only under `running`, and holds no claim lock.
    expect(seen['none']).not.toContain(STUB_RUN.spec);
    expect(seen['running']).toContain(STUB_RUN.spec);
    expect(seen['ended']).not.toContain(STUB_RUN.spec);
    // 009's done run takes it out of "Waits on you" into "In progress", once.
    await openDashboard(page, 'phases');
    expect(await waitIds(page)).not.toContain('009');
    expect((await tileIds(page)).filter((id) => id === '009')).toEqual(['009']);
  });
});
