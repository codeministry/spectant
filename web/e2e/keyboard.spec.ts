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

/**
 * ISC-61.1 (spec 001, T69): Enter on the selected row of the Specs panel opens the spec preview — the query state
 * `?spec=<id>` on `/w/:ws`, shown by the inspector in the rail at wide and in a side sheet at medium — Enter again (or
 * the Open button) opens the spec page, `[` `]` step through the list, and Esc from the preview clears the query and
 * puts focus back on the row. `bun run e2e -- keyboard -g enter`.
 */
test.describe('keyboard: Enter opens the selected spec', () => {
  test.use(atWidth(1440));

  const rowsOf = (page: Page) => page.locator('[data-panel="specs"] [data-spec-row]');
  const rowOf = (page: Page, id: string) => page.locator(`[data-panel="specs"] [data-spec-row="${id}"]`);
  const inspectorOf = (page: Page) => page.locator('app-spec-inspector');

  test('enter previews the selected spec, enter again opens it, Esc returns to the row', async ({ page }) => {
    const dashboard = page.waitForResponse((response) => response.url().endsWith('/harbor/dashboard') && response.ok());
    await page.goto('/w/harbor');
    const body = (await (await dashboard).json()) as { specs?: Array<{ id: string }> };
    const ids = (body.specs ?? []).map((spec) => spec.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const id = ids[1] ?? '';
    const next = ids[2] ?? '';

    await rowsOf(page).first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(rowOf(page, id)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/harbor\\?spec=${id}$`));
    await expect(inspectorOf(page)).toBeVisible();
    await expect(inspectorOf(page)).toHaveAttribute('data-spec', id);

    await page.keyboard.press(']');
    await expect(page).toHaveURL(new RegExp(`/w/harbor\\?spec=${next}$`));
    await expect(inspectorOf(page)).toHaveAttribute('data-spec', next);
    await page.keyboard.press('[');
    await expect(page).toHaveURL(new RegExp(`/w/harbor\\?spec=${id}$`));

    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/w\/harbor$/);
    await expect(inspectorOf(page)).toHaveCount(0);
    await expect(rowOf(page, id)).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/harbor\\?spec=${id}$`));
    // The previewed row now links to the spec page (rendered after the URL commits).
    await expect(rowOf(page, id)).toHaveAttribute('aria-expanded', 'true');
    await expect(rowOf(page, id)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/harbor/s/${id}$`));
  });

  test('enter at medium previews in a side sheet whose Open button leads to the spec page', async ({ page }) => {
    await page.setViewportSize({ width: 820, height: 900 });
    await page.goto('/w/harbor');
    const row = rowsOf(page).first();
    const id = (await row.getAttribute('data-spec-row')) ?? '';
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/w/harbor\\?spec=${id}$`));
    const sheet = page.locator('ui-sheet[data-inspector-sheet] dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('app-spec-inspector')).toHaveAttribute('data-spec', id);
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/w\/harbor$/);
    await expect(rowOf(page, id)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(sheet).toBeVisible();
    await sheet.locator('[data-action="open-spec"]').click();
    await expect(page).toHaveURL(new RegExp(`/w/harbor/s/${id}$`));
  });
});

/**
 * ISC-61.2 (spec 001, T67): `?` opens the shortcut sheet on the workspace dashboard too, and it lists the dashboard
 * context beside the spec context, both from the one `SHORTCUTS` table. The dashboard keys work where the sheet says:
 * `g s` / `g n` / `g w` land on their section headings, `1`–`3` filter the phase while the list has focus, `g a`
 * leaves for all workspaces and `l` / `h` move between their columns. `bun run e2e -- keyboard -g help`.
 */
test.describe('keyboard help on the workspace dashboard', () => {
  test.use(atWidth(1440));

  const DASHBOARD_KEYS = [
    'copy-next',
    'refresh',
    'move',
    'column-prev',
    'column-next',
    'phase-all',
    'phase-building',
    'phase-scoping',
    'go-all',
    'go-specs',
    'go-next-up',
    'go-warnings',
  ];

  async function openDashboard(page: Page): Promise<void> {
    const dashboard = page.waitForResponse((response) => response.url().endsWith('/harbor/dashboard') && response.ok());
    await page.goto('/w/harbor');
    await dashboard;
    await expect(page.locator('[data-panel="specs"] [data-spec-row]').first()).toBeVisible();
  }

  test('? opens the help sheet on /w/harbor, listing the dashboard keys per context', async ({ page }) => {
    await openDashboard(page);
    await page.keyboard.press('?');
    const sheet = sheetOf(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator('[data-context]')).toHaveCount(3);
    const workspace = sheet.locator('[data-context="workspace"]');
    await expect(workspace).toBeVisible();
    await expect(sheet.locator('[data-context="spec"]')).toBeVisible();
    for (const id of DASHBOARD_KEYS) {
      const binding = SHORTCUTS.find((entry) => entry.id === id);
      expect(binding, id).toBeDefined();
      await expect(workspace.locator(`[data-binding="${id}"] kbd`)).toHaveText((binding?.keys ?? []).map(keyLabel));
    }
    await expect(sheet.locator('[data-binding]')).toHaveCount(SHORTCUTS.length);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/w\/harbor$/);
  });

  test('the dashboard keys the help sheet lists reach their sections, filter and columns', async ({ page }) => {
    await openDashboard(page);
    for (const [key, heading] of [
      ['s', 'specs'],
      ['n', 'next-up'],
      ['w', 'warnings'],
    ] as const) {
      await page.keyboard.press('g');
      await page.keyboard.press(key);
      await expect(page.locator(`#${heading}`)).toBeFocused();
    }
    await expect(page).toHaveURL(/\/w\/harbor$/);

    await page.locator('[data-panel="specs"] [data-spec-row]').first().focus();
    await page.keyboard.press('2');
    await expect(page).toHaveURL(/[?&]phase=building(&|$)/);
    await page.keyboard.press('1');
    await expect(page).not.toHaveURL(/[?&]phase=/);

    await page.keyboard.press('g');
    await page.keyboard.press('a');
    await expect(page).toHaveURL(/\/$/);
    const columns = page.locator('app-workspace-column');
    await expect(columns.nth(1).locator('a.d-row').nth(1)).toBeVisible();
    await columns.nth(0).locator('a.d-row').nth(1).focus();
    await page.keyboard.press('l');
    await expect(columns.nth(1).locator('a.d-row').nth(1)).toBeFocused();
    await page.keyboard.press('h');
    await expect(columns.nth(0).locator('a.d-row').nth(1)).toBeFocused();
  });
});
