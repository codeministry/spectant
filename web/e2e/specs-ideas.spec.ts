/**
 * Spec 064 · T44 · ISC-486: the ideas list of the Specs page in a real browser, at 1440 and 390 px, against the harbor
 * goldens served by the stub API (`core/fixtures/harbor.golden.json`). `bun run e2e -- specs-ideas -g "ideas list"`.
 *
 * - A first click on an idea row of `/w/harbor/specs` selects it as a spec row's first click does: the address carries
 *   `?sel=idea:<slug>` and the detail sidebar shows the idea; a reload lands on the same sidebar.
 * - At 1440 px a second click on the selected row opens the idea's own page, `/w/harbor/ideas/<slug>`; at 390 px the
 *   sidebar is a modal sheet over the list, so the sheet's "Open idea" link (`a[data-open-idea]`) opens it.
 * - `/w/harbor/specs?phase=idea` lists the ideas group alone, no spec row; a reload keeps the same list.
 *
 * Every expected value derives from the golden. Each test runs in its own stub session.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const dashboard = JSON.parse(readFileSync(new URL('../../core/fixtures/harbor.golden.json', import.meta.url), 'utf8')) as {
  ideas: { count: number; list: ReadonlyArray<{ slug: string; title: string }> };
};
const IDEA = dashboard.ideas.list.at(0);
if (IDEA === undefined || dashboard.ideas.count < 1) throw new Error('the harbor golden no longer holds a story');

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `specs-ideas-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

const group = (page: Page): Locator => page.locator('app-spec-table li[data-ideas-group]');
const ideaLink = (page: Page, slug: string): Locator => group(page).locator(`app-idea-row[data-idea="${slug}"] a.link`);
const selParam = (page: Page): string | null => new URL(page.url()).searchParams.get('sel');

/** The detail sidebar is open on the idea and the address names it. */
async function expectIdeaSidebar(page: Page, slug: string): Promise<void> {
  await expect.poll(() => selParam(page)).toBe(`idea:${slug}`);
  await expect(page).toHaveURL(/\/w\/harbor\/specs\?/u);
  const sidebar = page.locator('app-detail-sidebar[data-presentation]');
  await expect(sidebar).toHaveCount(1);
  await expect(sidebar.locator('[data-part="type"]')).toHaveAttribute('data-type', 'idea');
  await expect(sidebar.locator('[data-part="id"]')).toHaveText(slug);
}

/** Only the ideas group is listed: every story of the golden, no spec row. */
async function expectIdeasOnly(page: Page): Promise<void> {
  await expect(group(page)).toHaveCount(1);
  await expect(group(page).locator('app-idea-row[data-idea]')).toHaveCount(dashboard.ideas.count);
  await expect(page.locator('app-spec-table app-spec-row')).toHaveCount(0);
  await expect(page.locator('app-spec-table a.row-link')).toHaveCount(0);
}

/** How the idea page is reached from the selection: the row itself at 1440 px, the sheet's link at 390 px. */
const OPENERS = {
  row: (page: Page, slug: string): Locator => ideaLink(page, slug),
  sheet: (page: Page): Locator => page.locator('app-detail-sidebar a[data-open-idea]'),
} as const;

for (const [label, width, opener] of [['1440', WIDTHS.desktop, 'row'], ['390', WIDTHS.phone, 'sheet']] as const) {
  test.describe(`ideas list at ${label} px`, () => {
    test.use(atWidth(width));

    test(`ideas list (${label}): a first click selects the idea into the sidebar, a reload keeps it, ${opener === 'row' ? 'a second click' : 'the sheet link'} opens the idea page`, async ({ page }) => {
      await page.goto('/w/harbor/specs');
      const link = ideaLink(page, IDEA.slug);
      await expect(link).toBeVisible();
      await link.click();
      await expectIdeaSidebar(page, IDEA.slug);

      await page.reload();
      await expectIdeaSidebar(page, IDEA.slug);

      const open = OPENERS[opener](page, IDEA.slug);
      if (opener === 'sheet') await expect(open).toHaveAttribute('href', `/w/harbor/ideas/${IDEA.slug}`);
      await open.click();
      await expect(page).toHaveURL(new RegExp(`/w/harbor/ideas/${IDEA.slug}$`, 'u'));
      await expect(page.locator('app-idea-page')).toBeVisible();
    });

    test(`ideas list (${label}): ?phase=idea lists only the ideas group, a reload the same`, async ({ page }) => {
      await page.goto('/w/harbor/specs?phase=idea');
      await expectIdeasOnly(page);
      await page.reload();
      await expect(page).toHaveURL(/[?&]phase=idea(?:&|$)/u);
      await expectIdeasOnly(page);
    });
  });
}
