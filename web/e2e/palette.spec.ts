/**
 * ISC-60 (T66): the command palette against the stub API. ⌘K, Ctrl+K, `/` and the header trigger open it; it lists
 * every registered workspace and every active spec of every workspace (the current workspace's first), a group with no
 * entries renders no heading, and Esc closes it with focus back on the trigger. `bun run e2e -- palette -g open`.
 */
import { readFileSync } from 'node:fs';

import type { APIRequestContext, Page } from '@playwright/test';

import { atWidth, expect, test } from './fixtures';

interface Listed {
  readonly workspaces: ReadonlyArray<{ slug: string; name: string }>;
  /** `slug/id` of every active spec, per workspace in list order. */
  readonly specs: readonly string[];
}

/** What the stub serves: the workspace list and each readable workspace's active specs. */
async function listed(request: APIRequestContext): Promise<Listed> {
  const workspaces = (await (await request.get('/api/workspaces')).json()) as Array<{ slug: string; name: string; readable: boolean }>;
  const specs: string[] = [];
  for (const ws of workspaces.filter((entry) => entry.readable)) {
    const body = (await (await request.get(`/api/workspaces/${ws.slug}/dashboard`)).json()) as { specs: Array<{ id: string }> };
    specs.push(...body.specs.map((spec) => `${ws.slug}/${spec.id}`));
  }
  return { workspaces, specs };
}

const paletteOf = (page: Page) => page.locator('app-command-palette dialog');

async function openDashboard(page: Page): Promise<void> {
  await page.goto('/w/harbor');
  await expect(page.locator('header [data-control="palette"]')).toBeVisible();
}

interface PlanningGolden {
  readonly features: ReadonlyArray<{ id: string; name: string }>;
  readonly milestones: ReadonlyArray<{ slug: string; name: string; specs: readonly unknown[] }>;
}

/** The planning golden the stub serves for a fixture tree: every expected id and label below derives from it. */
const planningGolden = (tree: 'harbor' | 'lantern'): PlanningGolden =>
  JSON.parse(readFileSync(new URL(`../../core/fixtures/${tree}.planning.golden.json`, import.meta.url), 'utf8')) as PlanningGolden;

const entriesOf = (page: Page, group: string): Promise<Array<string | null>> =>
  paletteOf(page)
    .locator(`[data-group="${group}"] [role="option"]`)
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-entry')));

const groupIds = (page: Page): Promise<Array<string | null>> =>
  paletteOf(page)
    .locator('[role="listbox"] [role="group"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-group')));

async function openPalette(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page.locator('header [data-control="palette"]')).toBeVisible();
  await page.keyboard.press('Meta+k');
  await expect(paletteOf(page)).toBeVisible();
}

test.describe('palette', () => {
  test.use(atWidth(1440));

  test('open: ⌘K lists every workspace and every spec, current workspace first', async ({ page, request }) => {
    const expected = await listed(request);
    expect(expected.workspaces.length).toBeGreaterThanOrEqual(2);
    await openDashboard(page);

    await page.keyboard.press('Meta+k');
    const palette = paletteOf(page);
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox')).toBeFocused();

    const workspaces = palette.locator('[data-group="workspaces"] [role="option"]');
    await expect(workspaces).toHaveCount(expected.workspaces.length);
    expect(await workspaces.evaluateAll((els) => els.map((el) => el.getAttribute('data-entry')))).toEqual(
      expected.workspaces.map((ws) => ws.slug),
    );

    const specs = palette.locator('[data-group="specs"] [role="option"]');
    await expect(specs).toHaveCount(expected.specs.length);
    const ids = await specs.evaluateAll((els) => els.map((el) => el.getAttribute('data-entry') ?? ''));
    expect([...ids].sort()).toEqual([...expected.specs].sort());
    // The open workspace's specs lead the group.
    const harbor = expected.specs.filter((id) => id.startsWith('harbor/'));
    expect(ids.slice(0, harbor.length)).toEqual(harbor);

    // Groups follow `order`, and a group without entries renders no heading at all.
    const groups = palette.locator('[role="listbox"] [role="group"]');
    const counts = await groups.evaluateAll((els) => els.map((el) => el.querySelectorAll('[role="option"]').length));
    expect(counts.every((count) => count > 0)).toBe(true);
    expect(await groups.evaluateAll((els) => els.map((el) => el.getAttribute('data-group')))).toEqual(
      expect.arrayContaining(['workspaces', 'specs', 'actions']),
    );
  });

  test('open: Ctrl+K and / open it too, Esc closes it', async ({ page }) => {
    await openDashboard(page);
    const palette = paletteOf(page);

    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(page).toHaveURL(/\/w\/harbor$/);

    await page.keyboard.press('/');
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('combobox')).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
  });

  test('open: the header trigger opens it, and focus returns to the trigger on close', async ({ page }) => {
    await openDashboard(page);
    const trigger = page.locator('header [data-control="palette"]');
    await expect(trigger).not.toHaveAttribute('aria-disabled');
    await trigger.click();
    const palette = paletteOf(page);
    await expect(palette).toBeVisible();
    await expect(palette.locator('[data-group="workspaces"] [role="option"]').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(palette).toBeHidden();
    await expect(trigger).toBeFocused();
  });
  test.describe('levels', () => {
    test('levels: features and milestones list after workspaces and specs, ISC-60 stays complete', async ({ page, request }) => {
      const golden = planningGolden('harbor');
      const expected = await listed(request);
      await openPalette(page, '/w/harbor');
      const palette = paletteOf(page);

      const features = palette.locator('[data-group="features"]');
      await expect(features.locator('.p-group')).toHaveText('Features');
      const featureOptions = features.locator('[role="option"]');
      await expect(featureOptions).toHaveCount(golden.features.length);
      expect(await entriesOf(page, 'features')).toEqual(golden.features.map((f) => `feature-${f.id}`));
      for (const [i, feature] of golden.features.entries()) {
        await expect(featureOptions.nth(i)).toContainText(feature.name);
        await expect(featureOptions.nth(i)).toContainText(feature.id);
      }

      const named = golden.milestones.filter((m) => m.specs.length > 0);
      expect(named.length).toBeGreaterThan(0);
      const milestones = palette.locator('[data-group="milestones"]');
      await expect(milestones.locator('.p-group')).toHaveText('Milestones');
      const milestoneOptions = milestones.locator('[role="option"]');
      await expect(milestoneOptions).toHaveCount(named.length);
      expect(await entriesOf(page, 'milestones')).toEqual(named.map((m) => `milestone-${m.slug}`));
      for (const [i, milestone] of named.entries()) await expect(milestoneOptions.nth(i)).toContainText(milestone.name);

      // Document order: workspaces, specs, features, milestones, then the rest.
      const order = await groupIds(page);
      const at = (id: string): number => order.indexOf(id);
      expect([at('workspaces'), at('specs'), at('features'), at('milestones')].every((n) => n >= 0)).toBe(true);
      expect(at('workspaces')).toBeLessThan(at('specs'));
      expect(at('specs')).toBeLessThan(at('features'));
      expect(at('features')).toBeLessThan(at('milestones'));
      for (const later of ['services', 'actions']) if (at(later) >= 0) expect(at('milestones')).toBeLessThan(at(later));

      // ISC-60 stays complete next to the new groups.
      expect(await entriesOf(page, 'workspaces')).toEqual(expected.workspaces.map((ws) => ws.slug));
      const specIds = (await entriesOf(page, 'specs')).map((id) => id ?? '');
      expect([...specIds].sort()).toEqual([...expected.specs].sort());
    });

    test('levels: a workspace without milestones has no Milestones group, its features still list', async ({ page }) => {
      const golden = planningGolden('lantern');
      expect(golden.milestones.filter((m) => m.specs.length > 0)).toHaveLength(0);
      await openPalette(page, '/w/lantern');
      const palette = paletteOf(page);
      await expect(palette.locator('[data-group="features"] [role="option"]')).toHaveCount(golden.features.length);
      expect(await entriesOf(page, 'features')).toEqual(golden.features.map((f) => `feature-${f.id}`));
      await expect(palette.locator('[data-group="milestones"]')).toHaveCount(0);
      await expect(palette.locator('.p-group', { hasText: 'Milestones' })).toHaveCount(0);
    });

    test('levels: outside a workspace neither group renders', async ({ page }) => {
      await openPalette(page, '/');
      const palette = paletteOf(page);
      await expect(palette.locator('[data-group="workspaces"] [role="option"]').first()).toBeVisible();
      await expect(palette.locator('[data-group="features"]')).toHaveCount(0);
      await expect(palette.locator('[data-group="milestones"]')).toHaveCount(0);
    });

    test('levels: a feature name filters to its entry and Enter lands on its card', async ({ page }) => {
      const feature = planningGolden('harbor').features.find((f) => f.name === 'Web console');
      if (feature === undefined) throw new Error('harbor golden has no "Web console" feature');
      await openPalette(page, '/w/harbor');
      await paletteOf(page).getByRole('combobox').fill('Web console');
      const option = paletteOf(page).locator(`[data-group="features"] [data-entry="feature-${feature.id}"]`);
      await expect(option).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/w/harbor/features#${feature.id}$`));
      await expect(page.locator(`article#${feature.id}`)).toBeFocused();
    });

    test('levels: a milestone name filters to its entry and Enter lands on its row', async ({ page }) => {
      const milestone = planningGolden('harbor').milestones.find((m) => m.name === 'Harbor 1.0');
      if (milestone === undefined) throw new Error('harbor golden has no "Harbor 1.0" milestone');
      await openPalette(page, '/w/harbor');
      await paletteOf(page).getByRole('combobox').fill('Harbor 1.0');
      await expect(paletteOf(page).locator(`[data-group="milestones"] [data-entry="milestone-${milestone.slug}"]`)).toBeVisible();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`/w/harbor/milestones#m-${milestone.slug}$`));
      await expect(page.locator(`article#m-${milestone.slug}`)).toBeFocused();
    });
  });

  test.describe('levels compact', () => {
    test.use(atWidth(390));

    test('levels: at 390 the sheet lists features and milestones too', async ({ page }) => {
      const golden = planningGolden('harbor');
      await page.goto('/w/harbor');
      await expect(page.locator('header [data-control="palette"]')).toBeVisible();
      await page.locator('header [data-control="palette"]').click();
      await expect(page.locator('ui-sheet').getByRole('combobox')).toBeVisible();
      const sheet = page.locator('ui-sheet');
      const ids = (group: string): Promise<Array<string | null>> =>
        sheet.locator(`[data-group="${group}"] [role="option"]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-entry')));
      await expect(sheet.locator('[data-group="features"] [role="option"]')).toHaveCount(golden.features.length);
      expect(await ids('features')).toEqual(golden.features.map((f) => `feature-${f.id}`));
      expect(await ids('milestones')).toEqual(golden.milestones.filter((m) => m.specs.length > 0).map((m) => `milestone-${m.slug}`));
    });
  });
});
