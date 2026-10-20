/**
 * Spec 057 (T24, review 024): the type chip in the zen footer shows the translated type name from the catalog
 * (`types.<type>`), the same text as the spec head's type chip, never the raw type key.
 * `bun run e2e -- shell.spec.ts -g "zen type chip"`. Harbor 002 is a feature spec; each language runs on its own stub
 * session, so the stored language never leaks into another case, worker or retry.
 */
import { readFileSync } from 'node:fs';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

type Catalog = { readonly types: Readonly<Record<string, string>> };

const catalog = (language: 'en' | 'de'): Catalog =>
  JSON.parse(readFileSync(new URL(`../src/i18n/${language}.json`, import.meta.url), 'utf8')) as Catalog;

test.use(atWidth(WIDTHS.desktop));

for (const language of ['en', 'de'] as const) {
  test.describe(`zen type chip in ${language}`, () => {
    let session = '';
    test.beforeEach(async ({ page, request }, info) => {
      session = `zen-type-chip-${language}-${info.testId}`;
      await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
      await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
      const saved = await request.put('/api/settings', { data: { language }, headers: { [SESSION_HEADER]: session } });
      expect(saved.ok()).toBe(true);
    });
    test.afterEach(async ({ request }) => {
      await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
    });

    test(`zen type chip: the footer of a feature spec shows types.feature of the ${language} catalog`, async ({ page }) => {
      const expected = catalog(language).types['feature'];
      expect(expected, `the ${language} catalog holds types.feature`).toBeTruthy();
      await page.goto('/w/harbor/s/002/status');
      // Harbor 002 is a feature spec: its head chip already reads the translated name.
      await expect(page.locator('app-spec-page [data-head-chip="type"]')).toHaveText(expected ?? '');

      const zen = page.locator('header [data-control="zen"]');
      await zen.click();
      await expect(zen).toHaveAttribute('aria-pressed', 'true');
      const chip = page.locator('[data-zen-footer] [data-zen-part="type"]');
      await expect(chip).toBeVisible();
      // textContent, not innerText: a CSS text-transform must not hide a raw key that differs only in case.
      await expect.poll(async () => (await chip.textContent())?.trim()).toBe(expected);
    });
  });
}
