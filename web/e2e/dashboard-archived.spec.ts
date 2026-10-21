/**
 * Spec 050 (T12, ISC-290): against the stub API at 1440 × 900, the spec list's "Show archived" toggle lists harbor's
 * archived spec (001, from `core/fixtures/harbor.golden.json`) as a marked row under the active ones, and a reload
 * keeps it: the toggle's state is `?archived=1` in the address. Since spec 058 the list stands on the Specs page
 * (`/w/harbor/specs`), no longer on the dashboard. `bun run e2e -- dashboard -g archived` is the probe.
 *
 * Selectors are the list's own hooks: the toggle `[data-control="archived"]` (`aria-pressed`), the archived row links
 * `.row-link[data-archived-row]`, the row host's `[data-archived]` with its `[data-archived-chip]`, and the fold
 * `[data-fold="specs"]`, whose own open state is `?open=specs`: with more than `SPEC_ROW_CAP` rows the archived block
 * may sit behind it, and folded rows are not rendered until it opens.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';

const specTable = (page: Page): Locator => page.locator('app-spec-table');
const toggle = (page: Page): Locator => specTable(page).locator('[data-control="archived"]');
const archivedRows = (page: Page): Locator => specTable(page).locator('.row-link[data-archived-row]');
const archivedRow = (page: Page, id: string): Locator => specTable(page).locator(`.row-link[data-archived-row="${id}"]`);
/** The row host (`app-spec-row[data-archived]`) of the archived row `id`; a `has` locator is relative to the host. */
const archivedHost = (page: Page, id: string): Locator =>
  specTable(page).locator('app-spec-row[data-archived]').filter({ has: page.locator(`.row-link[data-archived-row="${id}"]`) });
const fold = (page: Page): Locator => specTable(page).locator('[data-fold="specs"] button.summary');

/** Open harbor's Specs page (spec 058: the list's own page) and wait until the spec list rendered its rows. */
async function openHarbor(page: Page, query = ''): Promise<void> {
  await page.goto(`/w/harbor/specs${query}`);
  await expect(specTable(page).locator('[data-spec-row]').first()).toBeVisible();
}

/** Open the "show all N" fold when the archived row of `id` stands behind it, so the row is rendered. */
async function revealArchived(page: Page, id: string): Promise<void> {
  if ((await archivedRow(page, id).count()) > 0) return;
  await expect(fold(page)).toBeVisible();
  await expect(fold(page)).toHaveAttribute('aria-expanded', 'false');
  await fold(page).click();
  await expect(page).toHaveURL(/[?&]open=specs\b/u);
}

test.describe('dashboard archived toggle (spec 050, ISC-290)', () => {
  test.use(atWidth(1440));

  test('the archived toggle lists harbor 001 as a marked row and a reload keeps it', async ({ page }) => {
    await openHarbor(page);
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(archivedRows(page)).toHaveCount(0);

    await toggle(page).click();
    await expect(page).toHaveURL(/[?&]archived=1\b/u);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');

    await revealArchived(page, '001');
    await expect(archivedRow(page, '001')).toBeVisible();
    const host = archivedHost(page, '001');
    await expect(host).toHaveCount(1);
    await expect(host.locator('[data-archived-chip]')).toBeVisible();

    await page.reload();
    await expect(specTable(page).locator('[data-spec-row]').first()).toBeVisible();
    await expect(page).toHaveURL(/[?&]archived=1\b/u);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await revealArchived(page, '001');
    await expect(archivedRow(page, '001')).toBeVisible();
    await expect(archivedHost(page, '001').locator('[data-archived-chip]')).toBeVisible();
  });

  test('a fresh load without the archived param lists no archived rows', async ({ page }) => {
    await openHarbor(page, '?open=specs');
    await expect(page).not.toHaveURL(/[?&]archived=/u);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(archivedRows(page)).toHaveCount(0);
  });
});
