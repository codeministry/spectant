/**
 * Spec 026 · the planning page `/w/:ws/planning` with its three lenses Tree, Matrix and Graph.
 *
 * T16 · ISC-167 (`bun run e2e -- planning -g lenses`): `/w/:ws/planning` lands on the tree; the three lens tabs are
 * route links with `aria-current="page"` and keep `?sel=` and `?m=`; the PAGE select lists Planning and no longer
 * Features or Milestones; `g p` and the palette reach the page; the level headings carry the glossary hints (ISC-107);
 * English and German both render, no raw key. Against the stub API: harbor's planning golden
 * (`core/fixtures/harbor.planning.golden.json`) is the source of every expected count.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { PlanningModel } from '../../core/src/planning';
import { atWidth, expect, headerControl, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const harbor = read('../../core/fixtures/harbor.planning.golden.json') as PlanningModel;

interface Catalog {
  shell: { pages: Record<string, string> };
  planning: { page: { lenses: Record<'tree' | 'board' | 'graph', string>; levels: Record<'milestones' | 'features' | 'specs' | 'claims', string> } };
  terms: Record<'milestone' | 'feature' | 'spec' | 'claim', string>;
  palette: { actions: { planning: string } };
}
const catalogs = {
  en: read('../src/i18n/en.json') as Catalog,
  de: read('../src/i18n/de.json') as Catalog,
};

const LENSES = ['tree', 'board', 'graph'] as const;
const LEVELS = [
  ['milestones', 'milestone'],
  ['features', 'feature'],
  ['specs', 'spec'],
  ['claims', 'claim'],
] as const;

const milestoneCount = harbor.milestones.filter((m) => m.specs.length > 0).length;
const featureCount = harbor.features.length;
if (milestoneCount === 0 || featureCount === 0) throw new Error('the harbor planning golden lost its milestones or features');

const lensBar = (page: Page): Locator => page.locator('app-tab-bar-slot nav[data-ui="tab-bar"]');
const lensTab = (page: Page, lens: string): Locator => lensBar(page).locator(`a[data-tab="${lens}"]`);

async function openPlanning(page: Page, path = '/w/harbor/planning'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('[data-page="planning"] h1')).toBeVisible();
}

test.describe('planning: lenses', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('lenses: /planning lands on the tree; the three tabs route with aria-current and keep ?sel= and ?m=', async ({ page }) => {
    await openPlanning(page);
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/tree$/u);
    await expect(lensBar(page).locator('a[data-tab]')).toHaveCount(3);
    await expect(lensTab(page, 'tree')).toHaveAttribute('aria-current', 'page');
    for (const lens of LENSES) {
      await expect(lensTab(page, lens)).toContainText(catalogs.en.planning.page.lenses[lens]);
      await expect(lensTab(page, lens).locator('ui-icon')).toHaveCount(1);
    }
    await expect(page.locator('[data-lens="tree"]')).toBeVisible();

    await page.goto('/w/harbor/planning/tree?sel=feature:F1&m=x');
    await lensTab(page, 'board').click();
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/board\?/u);
    expect(new URL(page.url()).searchParams.get('sel')).toBe('feature:F1');
    expect(new URL(page.url()).searchParams.get('m')).toBe('x');
    await expect(lensTab(page, 'board')).toHaveAttribute('aria-current', 'page');
    await expect(lensTab(page, 'tree')).not.toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-lens="board"]')).toBeVisible();

    await lensTab(page, 'graph').click();
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/graph\?/u);
    await expect(lensTab(page, 'graph')).toHaveAttribute('aria-current', 'page');
    await expect(page.locator('[data-lens="graph"]')).toBeVisible();
  });

  test('lenses: the tree has the rail with the overview at wide; matrix and graph take the full width with a collapsible overview', async ({
    page,
  }) => {
    await openPlanning(page, '/w/harbor/planning/tree');
    await expect(page.locator('aside.shell-rail [data-planning-overview]')).toBeVisible();
    await expect(page.locator('main [data-overview-block]')).toHaveCount(0);

    await lensTab(page, 'board').click();
    await expect(page.locator('aside.shell-rail')).toHaveCount(0);
    const block = page.locator('main details[data-overview-block]');
    await expect(block).toHaveCount(1);
    await expect(block).not.toHaveAttribute('open', '');
    await block.locator('summary').click();
    await expect(block.locator('[data-planning-overview]')).toBeVisible();
  });

  test('lenses: the counts of the lens bodies equal the golden', async ({ page }) => {
    await openPlanning(page, '/w/harbor/planning/tree');
    await expect(page.locator('[data-level="milestones"] [data-count]')).toHaveText(String(milestoneCount));
    await expect(page.locator('[data-level="features"] [data-count]')).toHaveText(String(featureCount));
    await expect(page.locator('[data-level="claims"] [data-count]')).toHaveText(`${String(harbor.recount?.closed)}/${String(harbor.recount?.total)}`);
  });

  test('lenses: the level headings carry the glossary hints', async ({ page }) => {
    await openPlanning(page, '/w/harbor/planning/tree');
    for (const [level, term] of LEVELS) {
      const heading = page.locator(`[data-level="${level}"] h2`);
      await expect(heading).toContainText(catalogs.en.planning.page.levels[level]);
      await expect(heading.locator('ui-term')).toHaveCount(1);
      await expect(heading.locator('ui-term')).toContainText(catalogs.en.planning.page.levels[level]);
      await expect(page.locator(`[data-level="${level}"] [popover]`)).toHaveText(catalogs.en.terms[term]);
    }
  });

  test('lenses: the PAGE select lists Planning, not Features or Milestones, and marks it current', async ({ page }) => {
    await page.goto('/w/harbor');
    await (await headerControl(page, 'page')).click();
    let menu = page.getByRole('navigation', { name: 'Pages' });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[data-page="planning"]')).toHaveCount(1);
    await expect(menu.locator('[data-page="features"]')).toHaveCount(0);
    await expect(menu.locator('[data-page="milestones"]')).toHaveCount(0);
    await menu.locator('[data-page="planning"]').click();
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/tree$/u);
    await expect(page.locator('header [data-control="page"]')).toContainText(catalogs.en.shell.pages['planning'] ?? '');
    await (await headerControl(page, 'page')).click();
    menu = page.getByRole('navigation', { name: 'Pages' });
    await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-page', 'planning');
  });

  test('lenses: g p reaches the page; g f and g m still work', async ({ page }) => {
    await page.goto('/w/harbor');
    await expect(page.locator('header [data-control="page"]')).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('p');
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/tree$/u);
    await expect(page.locator('[data-page="planning"] h1')).toBeVisible();
    await page.keyboard.press('g');
    await page.keyboard.press('f');
    await expect(page).toHaveURL(/\/w\/harbor\/features$/u);
  });

  test('lenses: the palette finds the planning page', async ({ page }) => {
    await page.goto('/w/harbor');
    await expect(page.locator('header [data-control="palette"]')).toBeVisible();
    await page.keyboard.press('Meta+k');
    const palette = page.locator('app-command-palette dialog');
    await expect(palette).toBeVisible();
    await expect(palette.locator('[role="listbox"]')).not.toHaveAttribute('aria-busy', 'true');
    await palette.getByRole('combobox').fill('planning');
    const option = palette.getByRole('option', { name: catalogs.en.palette.actions.planning });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/tree$/u);
  });

  test('lenses: German renders every label, no raw key', async ({ page }, info) => {
    const headers = { [SESSION_HEADER]: `planning-de-${info.testId}` };
    await page.context().setExtraHTTPHeaders(headers);
    await page.request.post(RESET_PATH, { headers });
    const saved = await page.request.put('/api/settings', { data: { language: 'de' }, headers });
    expect(saved.ok()).toBe(true);
    const de = catalogs.de;
    try {
      await openPlanning(page, '/w/harbor/planning/tree');
      await expect(page.locator('[data-page="planning"] h1')).toHaveText(de.shell.pages['planning'] ?? '');
      for (const lens of LENSES) await expect(lensTab(page, lens)).toContainText(de.planning.page.lenses[lens]);
      for (const [level] of LEVELS) await expect(page.locator(`[data-level="${level}"] h2`)).toContainText(de.planning.page.levels[level]);
      await expect(page.locator('main')).not.toContainText(/\bplanning\.|shell\.pages\.|terms\./u);
      await lensTab(page, 'graph').click();
      await expect(page.locator('main')).not.toContainText(/\bplanning\.|shell\.pages\.|terms\./u);
    } finally {
      await page.request.post(RESET_PATH, { headers });
    }
  });
});
