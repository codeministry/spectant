/**
 * ISC-97 (T102): the keyboard service against the stub API. `g` sequences reach areas and tabs, `[` `]` step through
 * the workspace's specs in dashboard order, `z` toggles zen, `v` and `◂ ▸` write the board's query params, `?` opens
 * the shortcut sheet, which lists every binding of the exported table, and no key hint shows on a coarse pointer.
 * `bun run e2e -- keyboard`.
 */
import type { Page } from '@playwright/test';

import { keyLabel, SHORTCUTS } from '../src/app/core/keyboard-bindings';
import { atWidth, expect, test } from './fixtures';

/** Opens a harbor spec route and returns the dashboard's spec order, once the shell has it. */
async function openSpec(page: Page, path: string): Promise<string[]> {
  const dashboard = page.waitForResponse((response) => response.url().endsWith('/harbor/dashboard') && response.ok());
  await page.goto(path);
  const body = (await (await dashboard).json()) as { specs?: Array<{ id: string }> };
  await expect(page.locator('#spec-title')).toBeVisible();
  return (body.specs ?? []).map((spec) => spec.id);
}

const sheetOf = (page: Page) => page.locator('app-shortcut-sheet dialog');

test.describe('keyboard', () => {
  test.use(atWidth(1440));

  test('g sequences reach an area and a tab and move focus to the heading', async ({ page }) => {
    await openSpec(page, '/w/harbor/s/002');
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);
    await expect(page.locator('main :is(h1, h2):focus')).toHaveCount(1);

    await page.keyboard.press('g');
    await page.keyboard.press('e');
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/evidence$/);

    await page.keyboard.press('g');
    await page.keyboard.press('h');
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002$/);
  });

  test('] and [ step to the next and previous harbor spec on the same tab', async ({ page }) => {
    const order = await openSpec(page, '/w/harbor/s/002/claims');
    const next = order[order.indexOf('002') + 1];
    expect(next).toBeDefined();
    await page.keyboard.press(']');
    await expect(page).toHaveURL(new RegExp(`/w/harbor/s/${next ?? ''}/claims$`));
    await expect(page.locator('#spec-title')).toBeVisible();
    await page.keyboard.press('[');
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);
  });

  test('z toggles zen on the shell', async ({ page }) => {
    await openSpec(page, '/w/harbor/s/002');
    const shell = page.locator('app-shell');
    await page.keyboard.press('z');
    await expect(shell).toHaveAttribute('data-zen', '');
    await page.keyboard.press('z');
    await expect(shell).not.toHaveAttribute('data-zen');
  });

  test('v and the arrows write the view and frame params on the board', async ({ page }) => {
    await openSpec(page, '/w/harbor/s/002/board');
    await page.keyboard.press('v');
    await expect(page).toHaveURL(/\/board\?view=flow$/);
    await page.keyboard.press('v');
    await expect(page).toHaveURL(/\/board\?view=lanes$/);
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/[?&]frame=1(&|$)/);
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/[?&]frame=2(&|$)/);
    await page.keyboard.press('ArrowLeft');
    await expect(page).toHaveURL(/[?&]frame=1(&|$)/);
    await expect(page).toHaveURL(/[?&]view=lanes(&|$)/);
  });

  test('f focuses the search, m says it comes later, n opens notes, Esc leaves the spec', async ({ page }) => {
    await openSpec(page, '/w/harbor/s/002/claims');
    const search = page.locator('main input[type="search"]');
    await page.keyboard.press('f');
    await expect(search).toBeFocused();
    await search.blur();

    await page.keyboard.press('m');
    await expect(page.locator('ui-toast .alert')).toHaveText(/later task/);

    await page.keyboard.press('n');
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/notes$/);

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/w\/harbor$/);
  });

  test('typing in a field is never a shortcut', async ({ page }) => {
    await openSpec(page, '/w/harbor/s/002/claims');
    const search = page.locator('main input[type="search"]');
    await search.click();
    await page.keyboard.type('gd?z');
    await expect(search).toHaveValue('gd?z');
    // The claims search writes its own `q` param; the path stays on the tab.
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims(\?|$)/);
    await expect(page.locator('app-shell')).not.toHaveAttribute('data-zen');
    await expect(sheetOf(page)).toBeHidden();
  });

  test('? opens the shortcut sheet listing every binding of the table', async ({ page }) => {
    await openSpec(page, '/w/harbor/s/002');
    await page.keyboard.press('?');
    const sheet = sheetOf(page);
    await expect(sheet).toBeVisible();
    const rows = sheet.locator('[data-binding]');
    await expect(rows).toHaveCount(SHORTCUTS.length);
    expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-binding')))).toEqual(
      SHORTCUTS.map((binding) => binding.id),
    );
    for (const binding of SHORTCUTS) {
      await expect(sheet.locator(`[data-binding="${binding.id}"] kbd`)).toHaveText(binding.keys.map(keyLabel));
    }
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002$/);
  });

  test('the settings page opens the shortcut sheet', async ({ page }) => {
    await page.goto('/settings');
    await page.locator('[data-page="settings"] [data-action="shortcuts"]').click();
    await expect(sheetOf(page)).toBeVisible();
  });

  test('key hints show on a fine pointer', async ({ page }) => {
    await openSpec(page, '/w/harbor/s/002');
    await expect(page.locator('main kbd').first()).toBeVisible();
  });
});

/**
 * ISC-61 (spec 001, T63): in the workspace dashboard's Specs panel, ↓ / ↑ and j / k move the selection one row, Home
 * and End jump to the ends, nothing wraps, and moving never navigates. The row order is the dashboard's, or the
 * `?sort=` the URL names. `bun run e2e -- keyboard -g move`.
 */
test.describe('keyboard in the Specs panel', () => {
  test.use(atWidth(1440));

  /** Opens a harbor dashboard URL and returns the active spec ids the server sent, in model order. */
  async function openDashboard(page: Page, path: string): Promise<string[]> {
    const dashboard = page.waitForResponse((response) => response.url().endsWith('/harbor/dashboard') && response.ok());
    await page.goto(path);
    const body = (await (await dashboard).json()) as { specs?: Array<{ id: string }> };
    return (body.specs ?? []).map((spec) => spec.id);
  }

  const rowsOf = (page: Page) => page.locator('[data-panel="specs"] [data-spec-row]');
  const selectedOf = (page: Page) => page.locator('[data-panel="specs"] [data-spec-row][data-selected]');

  /** The selection sits on `id`: that row is marked, focused and the list's one tab stop. */
  async function expectSelected(page: Page, id: string): Promise<void> {
    await expect(selectedOf(page)).toHaveCount(1);
    await expect(selectedOf(page)).toHaveAttribute('data-spec-row', id);
    await expect(selectedOf(page)).toBeFocused();
    await expect(rowsOf(page).and(page.locator('[tabindex="0"]'))).toHaveAttribute('data-spec-row', id);
  }

  test('arrows and j/k move the selection in the Specs panel, without wrapping or navigating', async ({ page }) => {
    const ids = await openDashboard(page, '/w/harbor');
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const rows = rowsOf(page);
    await expect(rows).toHaveCount(ids.length);
    expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-spec-row')))).toEqual(ids);

    await rows.first().focus();
    await expectSelected(page, ids[0] ?? '');
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, ids[1] ?? '');
    await page.keyboard.press('j');
    await expectSelected(page, ids[2] ?? '');
    await page.keyboard.press('k');
    await expectSelected(page, ids[1] ?? '');
    await page.keyboard.press('ArrowUp');
    await expectSelected(page, ids[0] ?? '');
    await page.keyboard.press('k');
    await expectSelected(page, ids[0] ?? '');
    await page.keyboard.press('End');
    await expectSelected(page, ids.at(-1) ?? '');
    await page.keyboard.press('ArrowDown');
    await expectSelected(page, ids.at(-1) ?? '');
    await page.keyboard.press('Home');
    await expectSelected(page, ids[0] ?? '');
    await expect(page).toHaveURL(/\/w\/harbor$/);
  });

  test('the selection moves in the order the sort query names', async ({ page }) => {
    const ids = await openDashboard(page, '/w/harbor?sort=id');
    const byId = [...ids].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
    const rows = rowsOf(page);
    await expect(rows).toHaveCount(ids.length);
    expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-spec-row')))).toEqual(byId);
    await rows.first().focus();
    await page.keyboard.press('j');
    await expectSelected(page, byId[1] ?? '');
  });
});

test.describe('keyboard on a coarse pointer', () => {
  test.use({ ...atWidth(820), hasTouch: true, isMobile: true });

  test('no key hint is visible, and the bindings still work and are listed', async ({ page }) => {
    await openSpec(page, '/w/harbor/s/002');
    expect(await page.evaluate(() => matchMedia('(any-pointer: fine)').matches)).toBe(false);
    const hints = page.locator('kbd');
    expect(await hints.count()).toBeGreaterThan(0);
    for (const hint of await hints.all()) await expect(hint).toBeHidden();

    await page.keyboard.press('?');
    await expect(sheetOf(page).locator('[data-binding]')).toHaveCount(SHORTCUTS.length);
  });
});
