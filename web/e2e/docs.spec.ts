/**
 * ISC-84: the Docs tabs render their Markdown (headings, tables, code, mermaid fences as figures) and a file the spec
 * type does not have shows a type-aware empty state. `bun run e2e -- docs`. Data: `core/fixtures/harbor.docs.golden.json`
 * through the stub API; harbor 002 is a feature with a plan diagram, harbor 003 a refactor (no design.md by type).
 */
import { atWidth, expect, test, WIDTHS } from './fixtures';

test.describe('docs', () => {
  test.describe('wide', () => {
    test.use(atWidth(WIDTHS.desktop));

    test('plan: headings, a mermaid svg drawn client-side, TOC links jump', async ({ page }) => {
      await page.goto('/w/harbor/s/002/plan');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      const tab = page.locator('app-docs-tab[data-doc="plan"]');
      await expect(tab.locator('.docs-prose h2#approach')).toHaveText('Approach');
      await expect(tab.locator('[data-docs-meta]')).toContainText('approved');
      await expect(tab.locator('figure.mermaid-figure[data-rendered] .mermaid-svg svg')).toBeVisible();
      await expect(tab.locator('figure.mermaid-figure figcaption')).toHaveText('Approach');
      await expect(tab.locator('[data-diagram-missing]')).toHaveCount(0);

      const toc = tab.locator('nav.docs-toc');
      if ((await toc.count()) === 0) await tab.locator('ui-disclosure.docs-toc-fold button.summary').click();
      await tab.locator('a[href="#risks"]').first().click();
      await expect(page).toHaveURL(/#risks$/);
      await expect(tab.locator('#risks')).toBeInViewport();
      await expect(tab.locator('#risks')).toBeFocused();
    });

    test('design, decisions and constitution render; tables are labelled scroll regions', async ({ page }) => {
      await page.goto('/w/harbor/s/002/decisions');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      await expect(page.locator('app-docs-tab[data-doc="decisions"] .docs-prose h1')).toContainText('Context 002');

      await page.goto('/w/harbor/s/002/constitution');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      const constitution = page.locator('app-docs-tab[data-doc="constitution"]');
      await expect(constitution.locator('[data-docs-meta]')).toContainText('repo: harbor');
      const region = constitution.locator('div.mdtable').first();
      await expect(region).toHaveAttribute('role', 'region');
      await expect(region).toHaveAttribute('tabindex', '0');
      await expect(region).toHaveAttribute('aria-label', /Table 1/);

      // A feature without design.md: the file belongs to the type, so the command is offered.
      await page.goto('/w/harbor/s/002/design');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      const empty = page.locator('app-docs-tab[data-doc="design"] [data-docs-empty]');
      await expect(empty).toContainText('No design.md yet');
      await expect(empty.locator('ui-command-chip')).toContainText('/spec-design 002');
    });

    test('a refactor shows the type-aware empty state', async ({ page }) => {
      await page.goto('/w/harbor/s/003/design');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      const empty = page.locator('app-docs-tab[data-doc="design"] [data-docs-empty]');
      await expect(empty).toContainText('A refactor has no design.md');
      await expect(empty.locator('ui-command-chip')).toHaveCount(0);
    });
  });

  test.describe('phone', () => {
    test.use(atWidth(WIDTHS.phone));

    test('tables scroll inside their own region at 390, the page never does', async ({ page }) => {
      await page.goto('/w/harbor/s/002/constitution');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      const tab = page.locator('app-docs-tab[data-doc="constitution"]');
      await expect(tab.locator('div.mdtable[role="region"]').first()).toBeVisible();
      const widths = await tab.evaluate((host) =>
        [...host.querySelectorAll<HTMLElement>('div.mdtable')].map((region) => region.scrollWidth - region.clientWidth),
      );
      expect(widths.some((overflow) => overflow > 0)).toBe(true);
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(pageOverflow).toBeLessThanOrEqual(0);
      await expect(tab.locator('ui-disclosure.docs-toc-fold')).toBeVisible();
    });
  });
});
