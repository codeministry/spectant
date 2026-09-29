/**
 * The Notes area against the stub API (T100, ISC-95). `bun run e2e -- notes` is ISC-95's probe: every note the stub
 * seeds for harbor 002 is listed with its anchor chip, the chips and the search narrow the list, a new note is posted
 * and says "saved", an edit autosaves the whole draft with `PUT`, the preview renders Markdown, the anchor picker sets
 * a claim anchor, delete goes through the confirm dialog, and the import notice stays dismissed through
 * `/api/settings`. At 390 the editor replaces the list with a back link; at 1440 both panes show.
 *
 * Every test gets its own stub session (reset first), so a write never leaks into another test, worker or retry.
 */
import type { Page, Request } from '@playwright/test';
import type { Note } from '../../server/src/notes.contract.ts';
import { atWidth, expect, test } from './fixtures';
import { STUB_NOTES } from './stub-api';

const SESSION = 'X-Spectant-Stub-Session';
const BASE = '/w/harbor/s/002/notes';
const SEEDED = STUB_NOTES.filter((note) => note.workspace === 'harbor' && note.anchor?.spec === '002');
const note = (kind: 'spec' | 'claim' | 'task'): Note => {
  const found = SEEDED.find((n) => n.anchor?.kind === kind);
  if (!found) throw new Error(`STUB_NOTES holds no harbor 002 note anchored to a ${kind}`);
  return found;
};

const area = (page: Page) => page.locator('app-notes-area');
const rows = (page: Page) => area(page).locator('[data-note-row]');
const isWrite = (method: string) => (req: Request): boolean => req.method() === method && new URL(req.url()).pathname.startsWith('/api/workspaces/harbor/notes');

test.beforeEach(async ({ page, request }, info) => {
  const session = `notes-${info.testId}-${String(info.retry)}`;
  await page.setExtraHTTPHeaders({ [SESSION]: session });
  await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
});

test.describe('at 1440', () => {
  test.use(atWidth(1440));

  test('the list shows every seeded note with its anchor chip, and both panes are visible', async ({ page }) => {
    await page.goto(BASE);
    await expect(rows(page)).toHaveCount(SEEDED.length);
    expect(await rows(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-note')))).toEqual(SEEDED.map((n) => n.id));
    await expect(rows(page).locator('[data-anchor]')).toHaveText(['T1', 'ISC-51', 'Spec 002']);
    await expect(rows(page).first()).toContainText(note('task').title);
    await expect(area(page).locator('[data-notes-list]')).toBeVisible();
    await expect(area(page).locator('[data-notes-editor]')).toBeVisible();

    await rows(page).nth(1).click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/${note('claim').id}$`));
    await expect(area(page).locator('[data-notes-list]')).toBeVisible();
    await expect(area(page).locator('[data-note-title]')).toHaveValue(note('claim').title);
    await expect(area(page).locator('[data-notes-back]')).toHaveCount(0);
    const list = await area(page).locator('[data-notes-list]').boundingBox();
    expect(Math.round(list?.width ?? 0)).toBe(320);
  });

  test('the chips and the search narrow the list', async ({ page }) => {
    await page.goto(BASE);
    const chips = area(page).locator('[data-filter="notes"] button');
    await expect(chips).toHaveCount(3);
    await chips.filter({ hasText: 'Unanchored' }).click();
    await expect(page).toHaveURL(/[?&]filter=unanchored(&|$)/);
    await expect(rows(page)).toHaveCount(0);
    // The editor pane's "No note open" is an empty state too at wide; narrow to the list's.
    await expect(area(page).locator('[data-notes-list] ui-empty-state')).toBeVisible();
    await chips.filter({ hasText: 'Workspace' }).click();
    await expect(rows(page)).toHaveCount(SEEDED.length);
    await area(page).locator('input[type="search"]').first().fill('empty');
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page)).toHaveAttribute('data-note', note('claim').id);
  });

  test('a new note is posted once it has text and then says saved', async ({ page }) => {
    await page.goto(BASE);
    await area(page).locator('[data-notes-new]').click();
    await expect(page).toHaveURL(new RegExp(`${BASE}/new$`));
    const posted = page.waitForRequest(isWrite('POST'));
    await area(page).locator('[data-note-body]').fill('A fresh thought');
    const body = (await posted).postDataJSON() as unknown;
    expect(body).toEqual({ anchor: { kind: 'spec', spec: '002' }, title: '', body: 'A fresh thought' });
    await expect(page).toHaveURL(/\/notes\/00000000-0000-4000-8000-\d{12}$/);
    await expect(area(page).locator('[data-save-state]')).toHaveText(/^saved · \d{2}:\d{2}$/);
    await expect(rows(page)).toHaveCount(SEEDED.length + 1);
  });

  test('editing autosaves the whole draft with PUT', async ({ page }) => {
    const target = note('claim');
    await page.goto(`${BASE}/${target.id}`);
    const put = page.waitForRequest(isWrite('PUT'));
    await area(page).locator('[data-note-title]').fill('Probe the empty state too');
    const sent = await put;
    expect(new URL(sent.url()).pathname).toBe(`/api/workspaces/harbor/notes/${target.id}`);
    expect(sent.postDataJSON()).toEqual({ anchor: target.anchor, title: 'Probe the empty state too', body: target.body });
    await expect(area(page).locator('[data-save-state]')).toHaveText(/^saved · \d{2}:\d{2}$/);
    await expect(rows(page).first()).toContainText('Probe the empty state too');
  });

  test('the preview renders Markdown through core', async ({ page }) => {
    await page.goto(`${BASE}/${note('spec').id}`);
    await area(page).locator('ui-segmented button', { hasText: 'Preview' }).click();
    const preview = area(page).locator('[data-note-preview]');
    await expect(preview.locator('h1')).toHaveText('Rollout order');
    await expect(preview.locator('strong')).toHaveText('read-only');
    await expect(preview.locator('li')).toHaveText(['dashboard', 'spec page']);
    await expect(area(page).locator('[data-note-body]')).toHaveCount(0);
    await area(page).locator('ui-segmented button', { hasText: 'Side by side' }).click();
    await expect(area(page).locator('[data-note-body]')).toBeVisible();
    await expect(preview).toBeVisible();
  });

  test('the anchor picker sets a claim anchor', async ({ page }) => {
    const target = note('spec');
    await page.goto(`${BASE}/${target.id}`);
    const select = area(page).locator('[data-anchor-select]');
    await expect(select.locator('option[value="claim:002:ISC-52"]')).toHaveCount(1);
    const put = page.waitForRequest(isWrite('PUT'));
    await select.selectOption('claim:002:ISC-52');
    expect((await put).postDataJSON()).toEqual({ anchor: { kind: 'claim', spec: '002', id: 'ISC-52' }, title: target.title, body: target.body });
    await expect(rows(page).first().locator('[data-anchor]')).toHaveText('ISC-52');
  });

  test('delete asks first, then removes the note', async ({ page }) => {
    const target = note('task');
    await page.goto(`${BASE}/${target.id}`);
    await area(page).locator('[data-note-delete]').click();
    const dialog = page.locator('[data-note-confirm] dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(rows(page)).toHaveCount(SEEDED.length);

    await area(page).locator('[data-note-delete]').click();
    const removed = page.waitForResponse((res) => res.request().method() === 'DELETE');
    await dialog.locator('[data-note-delete-confirm]').click();
    expect((await removed).status()).toBe(204);
    await expect(page).toHaveURL(new RegExp(`${BASE}$`));
    await expect(rows(page)).toHaveCount(SEEDED.length - 1);
    await expect(area(page).locator(`[data-note="${target.id}"]`)).toHaveCount(0);
  });

  test('the import notice dismisses and stays dismissed after a reload', async ({ page }) => {
    await page.goto(BASE);
    const notice = area(page).locator('[data-notes-import]');
    await expect(notice).toBeVisible();
    const stored = page.waitForResponse((res) => res.url().endsWith('/api/settings') && res.request().method() === 'PUT');
    await notice.getByRole('button', { name: 'Dismiss' }).click();
    expect(((await (await stored).json()) as { notesImportDismissed?: boolean }).notesImportDismissed).toBe(true);
    await expect(notice).toHaveCount(0);
    await page.reload();
    await expect(rows(page)).toHaveCount(SEEDED.length);
    await expect(area(page).locator('[data-notes-import]')).toHaveCount(0);
  });
});

test.describe('claim card badge', () => {
  test.use(atWidth(1440));

  const CLAIMS = '/w/harbor/s/002/claims';
  const badges = (page: Page) => page.locator('app-claims-tab [data-claim] .head a[data-link="notes"]');
  const badgeOf = (page: Page, claim: string) => page.locator(`app-claims-tab [data-claim="${claim}"] .head a[data-link="notes"]`);

  test('the claim card badge shows the seeded note count on ISC-51 and on no other card', async ({ page }) => {
    const seeded = note('claim');
    expect(seeded.anchor).toEqual({ kind: 'claim', spec: '002', id: 'ISC-51' });
    await page.goto(CLAIMS);
    await expect(page.locator('app-claims-tab [data-claim]').first()).toBeVisible();
    await expect(badgeOf(page, 'ISC-51')).toHaveText('1');
    await expect(badgeOf(page, 'ISC-51')).toHaveAttribute('aria-label', '1 note');
    await expect(badgeOf(page, 'ISC-51')).toHaveClass(/\bbadge\b/);
    await expect(badges(page)).toHaveCount(1);

    await badgeOf(page, 'ISC-51').click();
    await expect(page).toHaveURL(new RegExp(`${BASE}$`));
    await expect(rows(page)).toHaveCount(SEEDED.length);
  });

  test('the claim card badge counts a note anchored to ISC-52 in the Notes area', async ({ page }) => {
    await page.goto(CLAIMS);
    await expect(badges(page)).toHaveCount(1);
    await expect(badgeOf(page, 'ISC-52')).toHaveCount(0);

    await page.goto(BASE);
    await area(page).locator('[data-notes-new]').click();
    const posted = page.waitForRequest(isWrite('POST'));
    await area(page).locator('[data-note-body]').fill('Check the badge on ISC-52');
    await posted;
    await expect(page).toHaveURL(/\/notes\/00000000-0000-4000-8000-\d{12}$/);
    const put = page.waitForRequest(isWrite('PUT'));
    await area(page).locator('[data-anchor-select]').selectOption('claim:002:ISC-52');
    expect(((await put).postDataJSON() as { anchor: unknown }).anchor).toEqual({ kind: 'claim', spec: '002', id: 'ISC-52' });
    await expect(area(page).locator('[data-save-state]')).toHaveText(/^saved · \d{2}:\d{2}$/);

    const counted = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/workspaces/harbor/note-counts');
    await page.goto(CLAIMS);
    await counted;
    await expect(badgeOf(page, 'ISC-52')).toHaveText('1');
    await expect(badgeOf(page, 'ISC-52')).toHaveAttribute('aria-label', '1 note');
    await expect(badgeOf(page, 'ISC-51')).toHaveText('1');
    await expect(badges(page)).toHaveCount(2);
  });
});

test.describe('at 390', () => {
  test.use(atWidth(390));

  test('the editor replaces the list, with a back link to all notes', async ({ page }) => {
    await page.goto(BASE);
    await expect(rows(page)).toHaveCount(SEEDED.length);
    await expect(area(page).locator('[data-notes-editor]')).toHaveCount(0);
    const create = area(page).locator('[data-notes-new]');
    expect(Math.round((await create.boundingBox())?.height ?? 0)).toBeGreaterThanOrEqual(44);

    await rows(page).first().click();
    await expect(area(page).locator('[data-notes-editor]')).toBeVisible();
    await expect(area(page).locator('[data-notes-list]')).toHaveCount(0);
    const back = area(page).locator('[data-notes-back]');
    await expect(back).toHaveText(`← All notes (${String(SEEDED.length)})`);

    // The anchor picker is a searchable bottom sheet at compact.
    await area(page).locator('[data-anchor-trigger]').click();
    const sheet = page.locator('[data-anchor-sheet] dialog');
    await expect(sheet).toBeVisible();
    await sheet.locator('input[type="search"]').fill('ISC-52');
    const put = page.waitForRequest(isWrite('PUT'));
    await sheet.locator('[data-value="claim:002:ISC-52"]').click();
    expect(((await put).postDataJSON() as { anchor: unknown }).anchor).toEqual({ kind: 'claim', spec: '002', id: 'ISC-52' });
    await expect(sheet).toBeHidden();

    await back.click();
    await expect(page).toHaveURL(new RegExp(`${BASE}$`));
    await expect(area(page).locator('[data-notes-editor]')).toHaveCount(0);
    await expect(rows(page)).toHaveCount(SEEDED.length);
  });
});
