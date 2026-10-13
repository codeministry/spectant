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

    test('design image: a design-pass screenshot loads through the evidence file route (ISC-112)', async ({ page }) => {
      const requested: URL[] = [];
      page.on('request', (request) => requested.push(new URL(request.url())));
      await page.goto('/w/harbor/s/004/design');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      const images = page.locator('app-docs-tab[data-doc="design"] figure.image-figure img');
      await expect(images).toHaveCount(1);
      await expect.poll(() => images.evaluateAll((all) => all.map((img) => (img as HTMLImageElement).naturalWidth))).toEqual([4]);
      const evidence = requested.filter((url) => url.pathname.endsWith('/specs/004/evidence/file'));
      // The prose figure and the viewport card's thumbnail show the same file: one path, never a second route.
      expect([...new Set(evidence.map((url) => url.searchParams.get('path')))]).toEqual(['.design/mobile-ist.png']);
      expect(requested.filter((url) => url.pathname.startsWith('/.design/'))).toEqual([]);
    });

    test('design: Ist/Soll viewport cards with the Soll text and a screenshot dialog (ISC-149)', async ({ page }) => {
      await page.goto('/w/harbor/s/004/design');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      const tab = page.locator('app-docs-tab[data-doc="design"]');
      const cards = tab.locator('[data-design-viewport]');
      await expect(cards).toHaveCount(1);
      const card = cards.first();
      await expect(card).toHaveAttribute('data-viewport', 'phone');
      await expect(card.locator('.design-vp-head')).toContainText('Phone');
      await expect(card.locator('.soll-text')).toContainText('The preview opens as a sheet over the list');
      await expect(card.locator('[data-thumb="ist"] img')).toBeVisible();
      await expect(card.locator('[data-thumb="soll"]')).toBeDisabled();
      await card.locator('[data-thumb="ist"]').click();
      const dialog = page.locator('[data-design-dialog] dialog');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('img.design-shot-big')).toBeVisible();
      await expect(dialog).toContainText('.design/mobile-ist.png');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      // The full document stays below the cards.
      await expect(tab.locator('.docs-prose h2#phone')).toHaveText('Phone');
    });

    test('design image: a screenshot that fails to load becomes the missing figure with its own note, never a broken image', async ({ page }) => {
      // The file went away between the docs render and the image load.
      await page.route('**/specs/004/evidence/file?*', (route) =>
        route.fulfill({ status: 404, contentType: 'application/json; charset=utf-8', body: '{"error":"not-found"}' }),
      );
      await page.goto('/w/harbor/s/004/design');
      await page.locator('app-docs-tab').first().waitFor(); // the shell sets no data-ready on spec routes yet
      const figure = page.locator('app-docs-tab[data-doc="design"] figure.image-figure').first();
      await expect(figure).toHaveAttribute('data-missing', '');
      await expect(figure).toHaveAttribute('data-unavailable', '');
      await expect(figure.locator('img')).toHaveCount(0);
      await expect(figure.locator('.figure-missing code')).toHaveText('.design/mobile-ist.png');
      await expect(figure.locator('.figure-missing-note')).toHaveText('Image could not be shown');
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
