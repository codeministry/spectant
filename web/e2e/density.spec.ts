/**
 * Spec 021 (density and readability): one picture per view, the rest behind a disclosure whose open state is in the
 * address. Each claim is one `test.describe` group below; its titles carry the group's word, so `-g density.*<word>`
 * runs that group alone.
 *
 * - dashboard (T49 · ISC-246, `bun run e2e -- density -g dashboard`): against the dense stub (`DENSE_HEADER: on`, harbor
 *   with 22 specs and a fresh, sectioned TL;DR) the TL;DR card shows its first section and folds the rest; the spec list
 *   shows its head with the counters and its first `SPEC_ROW_CAP` rows; "show all N" opens the rest, writes
 *   `open=specs` into the address, a reload keeps it open, and closing it removes the key.
 *
 * Expected texts come from the stub's own fixture (`STUB_DENSE`), never from a literal copy of it.
 */
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';
import { DENSE_HEADER, STUB_DENSE } from './stub-api';

/** The rows the spec list shows before "show all N" (`SPEC_ROW_CAP`, `spec-table.ts`). */
const ROW_CAP = 5;
/** The dashboard widths of ISC-246: desktop, the side panel and the phone. */
const WIDTHS = [1440, 600, 390] as const;

/** The text of one `<!-- section: id -->` of the stub's TL;DR, its lines joined as the rendered paragraph joins them. */
function tldrSection(id: string): string {
  const match = new RegExp(`<!-- section: ${id} -->\\n([\\s\\S]*?)(?:\\n\\n|$)`, 'u').exec(STUB_DENSE.tldr);
  if (!match?.[1]) throw new Error(`STUB_DENSE.tldr has no section ${id}`);
  return match[1].replace(/\s+/gu, ' ').trim();
}

/** The first sentence of a section's text. */
function firstSentence(text: string): string {
  const sentence = text.split(/(?<=\.)\s/u)[0];
  if (!sentence) throw new Error('empty TL;DR section');
  return sentence;
}

const FIRST = firstSentence(tldrSection('overview'));
/** A sentence of a later section: folded until "show whole TL;DR" opens. */
const LATER = firstSentence(tldrSection('risks'));

/** The `open` keys in the page's address, in order. */
function openKeys(page: Page): string[] {
  const value = new URL(page.url()).searchParams.get('open');
  return value === null || value === '' ? [] : value.split(',');
}

/** Open the dense harbor dashboard and wait until its spec list rendered. */
async function openDense(page: Page, query = ''): Promise<void> {
  await page.context().setExtraHTTPHeaders({ [DENSE_HEADER]: 'on' });
  await page.goto(`/w/${STUB_DENSE.workspace.slug}${query}`);
  await expect(specRows(page).first()).toBeVisible();
}

const specTable = (page: Page): Locator => page.locator('app-spec-table');
const specRows = (page: Page): Locator => specTable(page).locator('[data-spec-row]');
const showAll = (page: Page): Locator => specTable(page).locator('[data-fold="specs"] button.summary');

for (const width of WIDTHS) {
  test.describe(`density dashboard at ${width}`, () => {
    test.use(atWidth(width));

    test(`density dashboard folds the TL;DR to its first section at ${width}`, async ({ page }) => {
      await openDense(page);
      const card = page.locator('[data-ui="brief"]');
      await expect(card).toBeVisible();

      const first = card.locator('[data-brief-first]');
      await expect(first).toBeVisible();
      await expect(first).toContainText(FIRST);
      await expect(first).not.toContainText(LATER);

      const fold = card.locator('[data-brief-fold]');
      await expect(fold).toHaveCount(1);
      await expect(fold.locator('button.summary')).toHaveAttribute('aria-expanded', 'false');
      await expect(card.locator('[data-brief-rest]')).toBeHidden();
      await expect(card.getByText(LATER)).toBeHidden();
      expect(openKeys(page)).not.toContain('tldr');
    });

    test(`density dashboard spec list shows its head and ${ROW_CAP} rows at ${width}`, async ({ page }) => {
      await openDense(page);
      const table = specTable(page);
      await expect(table.locator('#specs')).toBeVisible();
      const counts = table.locator('[data-counts]');
      await expect(counts).toBeVisible();
      await expect(counts.locator('[data-count="active"]')).toHaveText(`${STUB_DENSE.specs} specs`);
      await expect(counts.locator('[data-count="archived"]')).toBeVisible();

      await expect(specRows(page)).toHaveCount(ROW_CAP);
      for (const row of await specRows(page).all()) await expect(row).toBeVisible();

      const toggle = showAll(page);
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(toggle).toHaveText(`Show all ${STUB_DENSE.specs} specs`);
      expect(openKeys(page)).not.toContain('specs');
    });

    test(`density dashboard show all opens, a reload keeps it, closing removes the key at ${width}`, async ({ page }) => {
      await openDense(page);
      const toggle = showAll(page);
      await expect(specRows(page)).toHaveCount(ROW_CAP);

      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(specRows(page)).toHaveCount(STUB_DENSE.specs);
      await expect(specRows(page).last()).toBeVisible();
      await expect.poll(() => openKeys(page)).toContain('specs');

      await page.reload();
      await expect(specRows(page).first()).toBeVisible();
      await expect(showAll(page)).toHaveAttribute('aria-expanded', 'true');
      await expect(specRows(page)).toHaveCount(STUB_DENSE.specs);
      expect(openKeys(page)).toContain('specs');

      await showAll(page).click();
      await expect(showAll(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(specRows(page)).toHaveCount(ROW_CAP);
      await expect.poll(() => openKeys(page)).not.toContain('specs');
      expect(new URL(page.url()).searchParams.has('open')).toBe(false);
    });
  });
}
