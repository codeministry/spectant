/**
 * Spec 067 · T29 · ISC-533 (`bun run e2e -- sidebar -g "stage change"`): the detail sidebar of a spec offers the stage
 * change with the board's allowed transitions, through write path 3 (the transition route under the sha256 check).
 *
 * - 200: at 1440 the board's "Move to…" menu for harbor 003 (no lock holds it) is read first; in the Specs list the
 *   sidebar's "Change stage" opens the same entries inline (same hints, same disabled ones, each disabled entry with its
 *   reason). Choosing an allowed one sends exactly one POST to the transition route, the sidebar stands on the new
 *   stage without a reload (no document request, no `load`, a `window` marker survives; see `expectShownStage`): the
 *   facts' stage chip names it and the reopened list marks it current; the toast names the move and focus is back on
 *   the toggle.
 * - 409: under `X-Spectant-Stub-Write: stale` the one attempt is refused, the refusal notice shows inline under the
 *   entry, the chip keeps the stage, no further write follows and the session's planning tree and dashboard row still
 *   have the old stage.
 * - 390: in the bottom sheet the list opens inline with tall rows (≥ 44 px); choosing shows the new stage in the chip.
 *
 * Which answer the stub gives is web/CLAUDE.md "Driving the board writes from an e2e spec". One stub session per test,
 * reset before and after (the moves live per session).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Locator, Page, Request } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER, WRITE_HEADER } from './stub-api';

const WS = 'harbor';
const SPEC = '003';
const MARKER = '__sidebarStageNoReload';
const TOAST = 'ui-toast .alert';
const TRANSITION_PATH = new RegExp(`^/api/workspaces/${WS}/specs/[^/]+/transition$`, 'u');
const STAGE_WORDS = (JSON.parse(readFileSync(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8')) as { stages: Readonly<Record<string, string>> })
  .stages;

/** One entry of a stage-target list as the page renders it. */
interface Entry {
  readonly stage: string;
  readonly hint: string;
  readonly disabled: boolean;
  readonly text: string;
}

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const stageChip = (page: Page): Locator => sidebar(page).locator('[data-facts="spec"] [data-part="stage"]');
const toggle = (page: Page): Locator => sidebar(page).locator('[data-section="actions"] [data-stage-change]');
const stageList = (page: Page): Locator => sidebar(page).locator('[data-stage-list]');

async function entriesOf(list: Locator): Promise<Entry[]> {
  return list.locator('[data-move-to]').evaluateAll((els) =>
    els.map((el) => ({
      stage: el.getAttribute('data-move-to') ?? '',
      hint: el.getAttribute('data-hint') ?? '',
      disabled: el.getAttribute('aria-disabled') === 'true',
      text: el.textContent.replace(/\s+/gu, ' ').trim(),
    })),
  );
}

/** Every POST the page sends to the transition route, in order. */
function transitionsOf(page: Page): Request[] {
  const posts: Request[] = [];
  page.on('request', (req) => {
    if (req.method() === 'POST' && TRANSITION_PATH.test(new URL(req.url()).pathname)) posts.push(req);
  });
  return posts;
}

/** The board's "Move to…" menu for harbor 003: its entries, read before the sidebar is opened. */
async function boardEntries(page: Page): Promise<Entry[]> {
  await page.goto(`/w/${WS}/board`);
  const grip = page.locator(`app-board-page app-board-card[data-key^="spec:${SPEC}-"] [data-grip]`);
  await grip.click();
  const menu = page.locator('[data-move-menu]');
  await expect(menu).toBeVisible();
  const entries = await entriesOf(menu);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  return entries;
}

/** Opens the Specs list, starts counting document requests and `load` events, and selects harbor 003. */
async function openSidebar(page: Page, presentation: string): Promise<() => Promise<void>> {
  const documents: string[] = [];
  let loads = 0;
  await page.goto(`/w/${WS}/specs`);
  await page.evaluate((key) => Object.assign(window, { [key]: true }), MARKER);
  page.on('request', (req: Request) => {
    if (req.resourceType() === 'document') documents.push(req.url());
  });
  page.on('load', () => {
    loads += 1;
  });
  await page.locator(`a.row-link[data-ref="spec:${SPEC}"]`).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(`spec:${SPEC}`);
  await expect(sidebar(page)).toHaveAttribute('data-presentation', presentation);
  await expect(stageChip(page)).toBeVisible();
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
  return async () => {
    expect(documents).toEqual([]);
    expect(loads).toBe(0);
    expect(await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], MARKER)).toBe(true);
  };
}

async function openList(page: Page): Promise<Locator> {
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'true');
  const list = stageList(page);
  await expect(list).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-controls', (await list.getAttribute('id')) ?? '');
  return list;
}

/**
 * The sidebar stands on `stage` without a reload: the facts' stage chip, which reads the session's dashboard row (the
 * stub rebuilds it by core after a 200 move, as the server re-reads spec.md), names it, and the reopened list marks it
 * as the current one (`aria-current`), which the sidebar takes from the planning holder or its own accepted move.
 */
async function expectShownStage(page: Page, stage: string): Promise<void> {
  await expect(stageChip(page)).toHaveText(String(STAGE_WORDS[stage]));
  const list = await openList(page);
  await expect(list.locator('[data-move-to][aria-current="true"]')).toHaveAttribute('data-move-to', stage);
  await toggle(page).click();
  await expect(stageList(page)).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
}

/** The stage of harbor 003 in the session's planning tree, as the next poll serves it. */
async function servedStage(request: APIRequestContext): Promise<string | null> {
  const answer = await request.get(`/api/workspaces/${WS}/planning`, { headers: { [SESSION_HEADER]: session } });
  expect(answer.status()).toBe(200);
  const model = (await answer.json()) as { features: Array<{ holders: Array<{ id: string; stage: string | null }> }> };
  return model.features.flatMap((f) => f.holders).find((h) => h.id === SPEC)?.stage ?? null;
}

/** The stage of harbor 003's row in the session's dashboard, the row the facts chip reads. */
async function rowStage(request: APIRequestContext): Promise<string | null> {
  const answer = await request.get(`/api/workspaces/${WS}/dashboard`, { headers: { [SESSION_HEADER]: session } });
  expect(answer.status()).toBe(200);
  const model = (await answer.json()) as { specs: Array<{ id: string; stage: string }> };
  return model.specs.find((s) => s.id === SPEC)?.stage ?? null;
}

const firstAllowed = (entries: readonly Entry[]): Entry => {
  const entry = entries.find((e) => e.hint === 'allowed' && !e.disabled);
  if (entry === undefined) throw new Error(`harbor ${SPEC} has no allowed target`);
  return entry;
};

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `sidebar-stage-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

test.describe(`sidebar stage change at ${String(WIDTHS.desktop)}`, () => {
  test.use(atWidth(WIDTHS.desktop));

  test('sidebar stage change: the board\'s targets inline, one transition, the new stage without a reload, focus on the toggle (T29, ISC-533)', async ({ page }) => {
    const board = await boardEntries(page);
    expect(board.some((e) => e.hint === 'allowed')).toBe(true);
    expect(board.some((e) => e.disabled && e.hint !== 'current')).toBe(true);

    const noReload = await openSidebar(page, 'docked');
    const before = (await stageChip(page).textContent())?.trim() ?? '';
    const current = board.find((e) => e.hint === 'current');
    expect(before).toBe(STAGE_WORDS[current?.stage ?? '']);
    const posts = transitionsOf(page);
    const list = await openList(page);

    // The same entries as the board's menu, each with the same hint; every entry the board refuses is disabled here too.
    const entries = await entriesOf(list);
    expect(entries.map(({ stage, hint, disabled }) => ({ stage, hint, disabled }))).toEqual(board.map(({ stage, hint, disabled }) => ({ stage, hint, disabled })));
    for (const entry of entries.filter((e) => e.hint === 'not-next' || e.hint === 'gate')) {
      expect(entry.disabled, entry.stage).toBe(true);
      expect(entry.text.length, `${entry.stage} carries its reason`).toBeGreaterThan(String(STAGE_WORDS[entry.stage]).length);
    }

    // A disabled entry sends nothing; the allowed one sends exactly one transition.
    // `aria-disabled`, not `disabled`: the entry stays focusable so its reason is read, and Enter on it does nothing.
    const refused = entries.find((e) => e.hint === 'not-next');
    if (refused) {
      await list.locator(`[data-move-to="${refused.stage}"]`).focus();
      await page.keyboard.press('Enter');
      await expect(stageList(page)).toBeVisible();
    }
    expect(posts).toHaveLength(0);
    const to = firstAllowed(entries);
    const answered = page.waitForResponse((r) => TRANSITION_PATH.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
    await list.locator(`[data-move-to="${to.stage}"]`).click();
    expect((await answered).status()).toBe(200);

    await expect(stageList(page)).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle(page)).toBeFocused();
    await expect(page.locator(TOAST)).toHaveText(`${SPEC} → ${String(STAGE_WORDS[to.stage])}`);
    await expectShownStage(page, to.stage);
    expect(posts.map((r) => new URL(r.url()).pathname)).toEqual([`/api/workspaces/${WS}/specs/${SPEC}/transition`]);
    expect(posts[0]?.postDataJSON()).toMatchObject({ to: to.stage });
    await noReload();
  });

  test('sidebar stage change: a conflict (409) shows the refusal inline, keeps the stage and writes nothing more (T29, ISC-533)', async ({ page, request }) => {
    const stage = await servedStage(request);
    const noReload = await openSidebar(page, 'docked');
    const before = (await stageChip(page).textContent())?.trim() ?? '';
    expect(before).toBe(STAGE_WORDS[stage ?? '']);
    await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session, [WRITE_HEADER]: 'stale' });
    const posts = transitionsOf(page);
    const list = await openList(page);
    const to = firstAllowed(await entriesOf(list));

    const answered = page.waitForResponse((r) => TRANSITION_PATH.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
    await list.locator(`[data-move-to="${to.stage}"]`).click();
    expect((await answered).status()).toBe(409);

    const notice = list.locator('li', { has: page.locator(`[data-move-to="${to.stage}"]`) }).locator('app-refusal-notice');
    await expect(notice).toBeVisible();
    await expect(stageList(page)).toBeVisible();
    await expect(stageChip(page)).toHaveText(before);
    await expect(list.locator('[data-move-to][aria-current="true"]')).toHaveAttribute('data-move-to', stage ?? '');
    // The refused attempt is the only write; the stub moved nothing.
    await page.waitForLoadState('networkidle');
    expect(posts).toHaveLength(1);
    expect(await servedStage(request)).toBe(stage);
    expect(await rowStage(request)).toBe(stage);
    await expect(stageChip(page)).toHaveText(before);
    await noReload();
  });
});

test.describe(`sidebar stage change at ${String(WIDTHS.phone)}`, () => {
  test.use(atWidth(WIDTHS.phone));

  test('sidebar stage change: the sheet opens the list inline with tall rows and shows the new stage (T29, ISC-533)', async ({ page }) => {
    const noReload = await openSidebar(page, 'sheet');
    const posts = transitionsOf(page);
    const list = await openList(page);
    await expect(list).toBeInViewport();
    const rows = list.locator('[data-move-to]');
    expect(await rows.count()).toBeGreaterThan(0);
    for (const height of await rows.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
      expect(height).toBeGreaterThanOrEqual(44);
    }
    // Inline in the sheet, never a popover or a second sheet.
    await expect(sidebar(page).locator('[data-stage-list] ul[ui-stage-targets]')).toHaveCount(1);
    await expect(page.locator('[data-move-menu]')).toHaveCount(0);

    const to = firstAllowed(await entriesOf(list));
    const answered = page.waitForResponse((r) => TRANSITION_PATH.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
    await list.locator(`[data-move-to="${to.stage}"]`).click();
    expect((await answered).status()).toBe(200);
    await expect(stageList(page)).toHaveCount(0);
    await expectShownStage(page, to.stage);
    expect(posts).toHaveLength(1);
    await noReload();
  });
});
