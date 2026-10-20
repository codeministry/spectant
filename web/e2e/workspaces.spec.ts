/**
 * Spec 016 (workspace management): the page `/settings/workspaces` against the stub registry. Every group of this file
 * is one `test.describe` named after its probe word, so `bun run e2e -- workspaces.spec.ts -g <word>` runs one group:
 *
 * - `remove` (ISC-314, T26): Cancel and Esc in the remove dialog send no DELETE and the entry stays, in the list and
 *   in a fresh `GET /api/workspaces` of the same stub session; only Confirm sends the one DELETE.
 * - `flow` (ISC-315, T27): add, rename, open on `/w/<slug>` and delete in one run against the stub.
 * - `widths` (ISC-316, T28): at 390, 600 and 1440 px the page never scrolls sideways, with the list, the row menu
 *   (a bottom sheet at compact, a popover from medium) and the rename and confirm dialogs open.
 *
 * Each group writes in its own `X-Spectant-Stub-Session` (set on the context, reset before each test), so its writes
 * never reach another suite. Stub directories: `STUB_ADMIN` in `stub-api.ts`.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';

import { atWidth, expect, menusReady, test } from './fixtures';

const SESSION_HEADER = 'X-Spectant-Stub-Session';
const PAGE = '[data-page="settings-workspaces"]';

function row(page: Page, slug: string): Locator {
  return page.locator(`${PAGE} li[app-workspace-row][data-ws-row="${slug}"]`);
}

/** The slugs a fresh `GET /api/workspaces` of the session lists. */
async function registrySlugs(request: APIRequestContext, session: string): Promise<string[]> {
  const res = await request.get('/api/workspaces', { headers: { [SESSION_HEADER]: session } });
  expect(res.status()).toBe(200);
  return ((await res.json()) as Array<{ readonly slug: string }>).map((entry) => entry.slug);
}

/** Records every DELETE the page sends from now on. */
function watchDeletes(page: Page): string[] {
  const deletes: string[] = [];
  page.on('request', (req) => {
    if (req.method() === 'DELETE') deletes.push(new URL(req.url()).pathname);
  });
  return deletes;
}

/** Opens the row's ⋯ menu and chooses one entry. */
async function rowAction(page: Page, slug: string, action: string): Promise<void> {
  await row(page, slug).locator('[data-row-menu]').click();
  const entry = row(page, slug).locator(`[data-row-act="${action}"]`);
  await expect(entry).toBeVisible();
  await entry.click();
}

async function openPage(page: Page): Promise<void> {
  await page.goto('/settings/workspaces');
  await expect(page.locator(`${PAGE} [data-ws-row]`).first()).toBeVisible();
}

test.describe('remove', () => {
  const session = 'workspaces-remove';
  test.use({ ...atWidth(1440), extraHTTPHeaders: { [SESSION_HEADER]: session } });
  test.beforeEach(async ({ request }) => {
    await request.post('/api/__stub/reset', { headers: { [SESSION_HEADER]: session } });
  });

  test('Cancel and Esc send no DELETE and keep the entry; only Confirm deletes it', async ({ page, request }) => {
    const deletes = watchDeletes(page);
    await openPage(page);
    const dialog = page.locator('[data-ws-remove-dialog] dialog');

    // Cancel: focus starts there, a click closes the dialog and nothing is sent.
    await rowAction(page, 'harbor', 'remove');
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-ws-remove-cancel]')).toBeFocused();
    await dialog.locator('[data-ws-remove-cancel]').click();
    await expect(dialog).toBeHidden();
    await expect(row(page, 'harbor')).toBeVisible();
    expect(await registrySlugs(request, session)).toContain('harbor');
    expect(deletes).toEqual([]);

    // Esc: the native dialog's cancel closes it, nothing is sent.
    await rowAction(page, 'harbor', 'remove');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(row(page, 'harbor')).toBeVisible();
    expect(await registrySlugs(request, session)).toContain('harbor');
    expect(deletes).toEqual([]);

    // Confirm: exactly one DELETE, and the entry is gone from the list and the registry.
    await rowAction(page, 'harbor', 'remove');
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-ws-remove-confirm]').click();
    await expect(dialog).toBeHidden();
    await expect(row(page, 'harbor')).toHaveCount(0);
    expect(deletes).toEqual(['/api/workspaces/harbor']);
    expect(await registrySlugs(request, session)).not.toContain('harbor');
  });
});

test.describe('flow', () => {
  const session = 'workspaces-flow';
  test.use({ ...atWidth(1440), extraHTTPHeaders: { [SESSION_HEADER]: session } });
  test.beforeEach(async ({ request }) => {
    await request.post('/api/__stub/reset', { headers: { [SESSION_HEADER]: session } });
  });

  test('add, rename, open on /w/<slug> and delete run through in the browser', async ({ page, request }) => {
    const deletes = watchDeletes(page);
    await openPage(page);
    const slug = 'new-workspace';
    const added = row(page, slug);

    // Add: the stub-only directory reads as an empty master; the row appears under its slug.
    await expect(added).toHaveCount(0);
    await page.locator('[data-ws-add-path]').fill('/stub/new-workspace');
    await page.locator('[data-ws-add]').click();
    await expect(added).toBeVisible();
    await expect(page.locator('[data-ws-add-path]')).toHaveValue('');
    expect(await registrySlugs(request, session)).toContain(slug);

    // Rename: the dialog shows the slug as an unchangeable line; the new name is shown, the slug and link stay.
    await rowAction(page, slug, 'rename');
    const rename = page.locator('[data-ws-rename-dialog] dialog');
    await expect(rename).toBeVisible();
    await expect(rename.locator('[data-ws-rename-slug]')).toContainText(slug);
    await rename.locator('[data-ws-rename-name]').fill('Renamed Workspace');
    await rename.locator('[data-ws-rename-save]').click();
    await expect(rename).toBeHidden();
    await expect(added.locator('a[data-ws-name]')).toContainText('Renamed Workspace');
    await expect(added.locator('a[data-ws-name]')).toHaveAttribute('href', `/w/${slug}`);

    // Open: the menu entry leads to the workspace under its slug, and the header's picker lists it.
    await rowAction(page, slug, 'open');
    await expect(page).toHaveURL(new RegExp(`/w/${slug}$`, 'u'));
    await menusReady(page);
    await page.locator('header [data-control="workspace"]').click();
    await expect(page.locator(`[data-picker="workspace"] [data-workspace="${slug}"]`)).toBeVisible();
    await page.keyboard.press('Escape');

    // Delete: back on the page, confirm the dialog; one DELETE, the row is gone.
    await page.goBack();
    await expect(added).toBeVisible();
    await rowAction(page, slug, 'remove');
    const remove = page.locator('[data-ws-remove-dialog] dialog');
    await expect(remove).toBeVisible();
    await remove.locator('[data-ws-remove-confirm]').click();
    await expect(remove).toBeHidden();
    await expect(added).toHaveCount(0);
    expect(deletes).toEqual([`/api/workspaces/${slug}`]);
    expect(await registrySlugs(request, session)).not.toContain(slug);
  });
});

/** How far the page reaches past its viewport sideways; 0 when it does not scroll sideways. */
async function sideways(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/** The element lies within the viewport's width. */
async function expectWithinWidth(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  if (box === null || viewport === null) throw new Error('the element or the viewport has no size');
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
}

test.describe('widths', () => {
  for (const width of [390, 600, 1440]) {
    test.describe(`${String(width)} px`, () => {
      const session = `workspaces-widths-${String(width)}`;
      test.use({ ...atWidth(width), extraHTTPHeaders: { [SESSION_HEADER]: session } });
      test.beforeEach(async ({ request }) => {
        await request.post('/api/__stub/reset', { headers: { [SESSION_HEADER]: session } });
      });

      test(`usable at ${String(width)} px without sideways scroll, with the menu and both dialogs open`, async ({ page }) => {
        await openPage(page);

        // The list and the add form.
        expect(await sideways(page)).toBe(0);
        const path = page.locator('[data-ws-add-path]');
        await expect(path).toBeVisible();
        await expect(path).toBeEnabled();
        await expectWithinWidth(page, path);
        await expectWithinWidth(page, page.locator('[data-ws-add]'));

        // The row menu: a bottom sheet at compact, a popover from medium.
        await row(page, 'harbor').locator('[data-row-menu]').click();
        const entry = row(page, 'harbor').locator('[data-row-act="remove"]');
        await expect(entry).toBeVisible();
        await expectWithinWidth(page, entry);
        expect(await sideways(page)).toBe(0);
        await page.keyboard.press('Escape');
        await expect(entry).toBeHidden();

        // The rename dialog.
        await rowAction(page, 'harbor', 'rename');
        const rename = page.locator('[data-ws-rename-dialog] dialog');
        await expect(rename).toBeVisible();
        await expectWithinWidth(page, rename);
        expect(await sideways(page)).toBe(0);
        await page.keyboard.press('Escape');
        await expect(rename).toBeHidden();

        // The confirm dialog of the delete.
        await rowAction(page, 'harbor', 'remove');
        const confirm = page.locator('[data-ws-remove-dialog] dialog');
        await expect(confirm).toBeVisible();
        await expectWithinWidth(page, confirm);
        expect(await sideways(page)).toBe(0);
        await page.keyboard.press('Escape');
        await expect(confirm).toBeHidden();
        expect(await sideways(page)).toBe(0);
      });
    });
  }
});
