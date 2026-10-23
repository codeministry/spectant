/**
 * Spec 067 · T37 · ISC-537 (`bun run e2e -- sidebar -g "keyboard"`): every action of the detail sidebar is reachable
 * with Tab and operable with Enter or Space, every target is a real box of at least 32 px (docked at 1440) or 44 px
 * (the compact sheet at 390, and under a coarse pointer at 820), measured with `getBoundingClientRect`, not a
 * `::before` hit area; and Escape closes in one order: an open dialog first, then the open stage list, then the
 * sidebar, which returns the focus to the selected row.
 *
 * harbor 002 is selected from the Specs list with the keyboard. Tab runs forward from the title (head before it:
 * Shift+Tab) and records each stop with its box; then each action is operated: the star (Enter, Space), the next-step
 * copy chip (Enter), the stage toggle (Enter opens the inline list, Escape closes it and leaves the sidebar open), the
 * first open task (Space ticks it through the tick route; the live refresh leaves the focus on its box) and a link row
 * (Enter selects its object). The release case runs on beacon 003 under the `runs` fixture at 1440. The coarse-pointer
 * case measures without Tab, in a context of its own: Chromium's touch emulation changes the Tab order.
 *
 * One stub session per test, reset before and after (favourites, the tick and the release live per session).
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { LOCKS_HEADER, RESET_PATH, SESSION_HEADER, STUB_NOW, STUB_RUN } from './stub-api';

const WS = 'harbor';
const SPEC = '002';
const TASK = 'T28';

/** One focus stop: what it is, the height of its target box (a checkbox's row label), and whether it is in the panel. */
interface Stop {
  readonly key: string;
  readonly height: number;
  readonly inside: boolean;
}

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const listRow = (page: Page, id: string): Locator => page.locator(`a.row-link[data-ref="spec:${id}"]`);

/** Waits for the panel's slide-in (reduced motion is not set) and every other running animation. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
}

/** The focused element as a stop; the key names the sidebar's action it is. */
async function stopAt(page: Page): Promise<Stop> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    const panel = document.querySelector('app-detail-sidebar[data-presentation]');
    if (el === null || !panel?.contains(el)) return { key: el?.tagName.toLowerCase() ?? '', height: 0, inside: false };
    const section = el.closest('[data-section]')?.getAttribute('data-section') ?? '';
    const named: ReadonlyArray<readonly [string, string]> = [
      ['[data-close]', 'close'],
      ['.star', 'star'],
      ['ui-command-chip button', `copy:${section}`],
      ['[data-stage-change]', 'stage'],
      ['[data-stage-list] *', 'stage-entry'],
      ['[data-release]', 'release'],
      ['[data-task-check]', `task:${el.closest('[data-task]')?.getAttribute('data-task') ?? ''}`],
      ['[data-tasks-more]', 'tasks-more'],
      ['a.text-link', 'link'],
      ['[data-more]', 'more'],
      ['[data-open-spec], [data-open-idea]', 'foot'],
      ['[data-metric="warnings"]', 'warnings'],
    ];
    const key = named.find(([selector]) => el.matches(selector))?.[1] ?? `other:${el.tagName.toLowerCase()}`;
    return { key, height: (el.closest('label') ?? el).getBoundingClientRect().height, inside: true };
  });
}

/** Presses `key` until the focus leaves the panel or comes round again (the sheet's modal dialog wraps). */
async function tabThrough(page: Page, key: 'Tab' | 'Shift+Tab'): Promise<Stop[]> {
  const stops: Stop[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 40; i += 1) {
    await page.keyboard.press(key);
    const stop = await stopAt(page);
    const id = await page.evaluate(() => {
      const el = document.activeElement as (HTMLElement & { __kbId?: number }) | null;
      if (el === null) return -1;
      el.__kbId ??= Math.random();
      return el.__kbId;
    });
    if (!stop.inside || seen.has(String(id))) break;
    seen.add(String(id));
    stops.push(stop);
  }
  return stops;
}

/** Selects `id` in the Specs list with the keyboard and waits for the panel's title to take the focus. */
async function chooseWithKeyboard(page: Page, id: string, presentation: string): Promise<Locator> {
  await listRow(page, id).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(`spec:${id}`);
  await expect(sidebar(page)).toHaveAttribute('data-presentation', presentation);
  await settle(page);
  const title = sidebar(page).locator('h2[data-part="title"]');
  await expect(title).toBeFocused();
  return title;
}

/** Every stop of the panel, the head's (before the title) and the body's and foot's (after it). */
async function allStops(page: Page, title: Locator): Promise<Stop[]> {
  const forward = await tabThrough(page, 'Tab');
  await title.focus();
  const backward = await tabThrough(page, 'Shift+Tab');
  return [...backward.reverse(), ...forward];
}

function expectBoxes(stops: readonly Stop[], min: number): void {
  for (const stop of stops) expect.soft(stop.height, `${stop.key}: target box height`).toBeGreaterThanOrEqual(min - 0.5);
}

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `sidebar-keyboard-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

const CASES = [
  { width: WIDTHS.desktop, presentation: 'docked', min: 32 },
  { width: WIDTHS.phone, presentation: 'sheet', min: 44 },
] as const;

for (const { width, presentation, min } of CASES) {
  test.describe(`sidebar keyboard at ${String(width)}`, () => {
    test.use({ ...atWidth(width), permissions: ['clipboard-read', 'clipboard-write'] });

    test(`sidebar keyboard: every action of spec ${SPEC} is reachable and operable, ${String(min)} px boxes, Escape closes list then ${presentation} (T37, ISC-537)`, async ({ page }) => {
      await page.goto(`/w/${WS}/specs`);
      const panel = sidebar(page);
      const title = await chooseWithKeyboard(page, SPEC, presentation);

      // Reachable: every action is a Tab stop in the panel, each a real box of the tier's size.
      const stops = await allStops(page, title);
      const keys = stops.map((stop) => stop.key);
      for (const want of ['close', 'star', 'copy:facts', 'stage', `task:${TASK}`, 'link', 'foot']) expect(keys, `Tab reaches ${want}`).toContain(want);
      expect(keys.filter((key) => key.startsWith('other:')), 'no unnamed stop').toEqual([]);
      expectBoxes(stops, min);

      // The star: Enter sets the favourite, Space releases it.
      const star = panel.locator('button.star');
      await star.focus();
      await page.keyboard.press('Enter');
      await expect(star).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press(' ');
      await expect(star).toHaveAttribute('aria-pressed', 'false');
      await expect(star).toBeFocused();

      // The copy chip: Enter copies the next step.
      const copy = panel.locator('[data-section="facts"] [data-part="next"] ui-command-chip button');
      await copy.focus();
      await page.keyboard.press('Enter');
      await expect(copy).toHaveAttribute('data-copied', '');

      // The stage toggle: Enter opens the inline list with the focus in it; Escape closes the list, not the sidebar.
      const toggle = panel.locator('[data-stage-change]');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      const list = panel.locator('[data-stage-list]');
      await expect(list).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-stage-list]') !== null)).toBe(true);
      const entries = await list.locator('[data-move-to]').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      expect(entries.length).toBeGreaterThan(0);
      for (const height of entries) expect(height, 'stage entry box height').toBeGreaterThanOrEqual(min - 0.5);
      await page.keyboard.press('Escape');
      await expect(list).toHaveCount(0);
      await expect(toggle).toBeFocused();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(panel).toHaveAttribute('data-presentation', presentation);
      expect(new URL(page.url()).searchParams.get('sel')).toBe(`spec:${SPEC}`);

      // A task: Space ticks it through the tick route; the live refresh after the write leaves the focus on its box.
      const box = panel.locator(`[data-task="${TASK}"] input[data-task-check]`);
      await box.focus();
      const ticked = page.waitForResponse((r) => r.url().endsWith(`/tasks/${TASK}/check`) && r.request().method() === 'POST');
      await page.keyboard.press(' ');
      expect((await ticked).status()).toBe(200);
      await expect(box).toBeChecked();
      await expect(panel.locator(`[data-task="${TASK}"]`)).toHaveAttribute('data-check', 'written');
      await settle(page);
      await expect(box).toBeFocused();
      await expect(title).not.toBeFocused();

      // Escape closes the sidebar and returns the focus to the selected row.
      await page.keyboard.press('Escape');
      await expect(panel).toHaveCount(0);
      await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBeNull();
      await expect(listRow(page, SPEC)).toBeFocused();

      // A link row: Enter selects its object.
      await chooseWithKeyboard(page, SPEC, presentation);
      const link = panel.locator('a.text-link').first();
      const ref = await link.getAttribute('data-sel');
      await link.focus();
      await page.keyboard.press('Enter');
      await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(ref);
    });
  });
}

test.describe(`sidebar keyboard release at ${String(WIDTHS.desktop)}`, () => {
  test.use({ ...atWidth(WIDTHS.desktop), clockAt: STUB_NOW });

  test(`sidebar keyboard: Release run on the running ${STUB_RUN.spec} opens its question with Enter, Escape closes the question before the sidebar, Enter releases (T37, ISC-537)`, async ({ page }) => {
    await page.setExtraHTTPHeaders({ [LOCKS_HEADER]: 'runs', [SESSION_HEADER]: session });
    await page.goto(`/w/${STUB_RUN.workspace.slug}/specs`);
    const panel = sidebar(page);
    const title = await chooseWithKeyboard(page, STUB_RUN.spec, 'docked');
    const stops = await allStops(page, title);
    expect(stops.map((stop) => stop.key)).toContain('release');
    expectBoxes(stops, 32);

    const release = panel.locator('[data-section="actions"] [data-release]');
    await release.focus();
    await page.keyboard.press('Enter');
    const dialog = page.locator('[data-release-dialog]');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-release-keep]')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(panel).toHaveAttribute('data-presentation', 'docked');
    await expect(release).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(dialog.locator('[data-release-keep]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.locator('[data-release-confirm]')).toBeFocused();
    const released = page.waitForResponse((r) => r.url().endsWith('/release') && r.request().method() === 'POST');
    await page.keyboard.press('Enter');
    expect((await released).status()).toBe(200);
    await expect(panel.locator('[data-release]')).toHaveCount(0);
    await expect(title).not.toBeFocused();

    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(listRow(page, STUB_RUN.spec)).toBeFocused();
  });
});

test.describe(`sidebar keyboard targets under a coarse pointer at ${String(WIDTHS.tablet)}`, () => {
  test.use({ ...atWidth(WIDTHS.tablet), hasTouch: true });

  test(`sidebar keyboard targets: under pointer: coarse every target of spec ${SPEC}, the open stage list included, is a 44 px box (T37, ISC-537)`, async ({ page }) => {
    await page.goto(`/w/${WS}/specs?sel=spec:${SPEC}`);
    expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
    const panel = sidebar(page);
    await expect(panel).toHaveAttribute('data-presentation', 'overlay');
    await expect(panel.locator(`[data-task="${TASK}"]`)).toBeVisible();
    await panel.locator('[data-stage-change]').click();
    await expect(panel.locator('[data-stage-list]')).toBeVisible();
    await settle(page);
    const boxes = await panel.evaluate((host) =>
      [...host.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled])')]
        .filter((el) => el.getClientRects().length > 0)
        .map((el) => ({
          key: `${el.tagName.toLowerCase()}.${el.classList.item(0) ?? ''}`,
          height: (el.closest('label') ?? el).getBoundingClientRect().height,
        })),
    );
    expect(boxes.length).toBeGreaterThan(8);
    for (const { key, height } of boxes) expect.soft(height, `${key}: target box height`).toBeGreaterThanOrEqual(43.5);
  });
});
