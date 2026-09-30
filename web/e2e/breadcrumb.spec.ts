/**
 * T41 · ISC-105: the breadcrumb of the spec head on every spec route, archived specs included, at 390 and 1440, against
 * the stub API (`core/fixtures/harbor.planning.golden.json`). `bun run e2e -- breadcrumb`.
 *
 * The levels are `milestone · feature › spec › area › claim or task`; the compact tier returns the short form
 * `⚑ Harbor 1.0 · F2 › 002 › ISC-51` (no workspace, no area, the spec as its mono id). "Links resolve" splits in two:
 * workspace, spec, area, claim and task links are clicked and must land; the feature and milestone links point at the
 * Features and Milestones pages, so their `href` is asserted and they are clicked at the end to land on the focused
 * card and row.
 *
 * No harbor spec holds claims in more than one feature block, so the "+n" popover reads a planning answer with spec
 * 002 also holding F3, served through `page.route` in place of the stub's own body.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';

import type { PlanningModel } from '../../core/src/planning';
import { SPEC_AREAS } from '../src/app/layout/shell/areas';
import { atWidth, expect, test, WIDTHS } from './fixtures';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const planning = read('../../core/fixtures/harbor.planning.golden.json') as PlanningModel;
const en = read('../src/i18n/en.json') as { shell: { areas: Record<string, string> }; planning: { breadcrumb: { archived: string } } };

const HEAD = 'app-spec-head';
const NAV = `${HEAD} [data-breadcrumb]`;

const holds = (feature: string, spec: string) => planning.features.find((f) => f.id === feature)?.holders.some((h) => h.id === spec) ?? false;
const featureOf = (id: string) => planning.features.find((f) => f.id === id);
const milestoneOf = (spec: string) => planning.milestones.find((m) => m.specs.some((h) => h.id === spec));

const F2 = featureOf('F2');
const F1 = featureOf('F1');
const F3 = featureOf('F3');
const M10 = milestoneOf('002');
if (!F2 || !F1 || !F3 || !M10 || !holds('F2', '002') || !holds('F1', '001') || milestoneOf('001')?.slug !== M10.slug) {
  throw new Error('harbor.planning.golden.json no longer places 002 in F2 and 001 in F1, both in one milestone');
}
const specs = planning.features.flatMap((f) => f.holders).filter((h) => h.id === '002' || h.id === '001');
const slugOf = (id: string): string => (specs.find((h) => h.id === id)?.slug ?? '').slice(id.length + 1);

/** Every tab route of the built spec areas, with the area that owns it. */
const TAB_ROUTES = SPEC_AREAS.filter((area) => area.built && area.tabs.length > 0).flatMap((area) =>
  area.tabs.map((tab) => ({ area: area.id, tab, first: tab === area.tabs[0] })),
);

const crumb = (page: Page, name: string): Locator => page.locator(`${NAV} [data-crumb="${name}"]`);
/** A planning answer with spec 002 also holding a claim of F3, in place of the stub's own body. */
const servePlanningWithSpecInF3 = async (page: Page): Promise<void> => {
  await page.route('**/api/workspaces/harbor/planning', async (route) => {
    const response = await route.fetch();
    const model = (await response.json()) as PlanningModel;
    const holder = F2.holders.find((h) => h.id === '002');
    if (!holder) throw new Error('planning body: F2 has no holder 002');
    const features = model.features.map((f) => (f.id === F3.id ? { ...f, holders: [...f.holders, { ...holder, main: false, held: 1 }] } : f));
    await route.fulfill({ response, json: { ...model, features } });
  });
};
const item = (page: Page, name: string): Locator => page.locator(`${NAV} li:has([data-crumb="${name}"])`);

for (const width of [WIDTHS.phone, WIDTHS.desktop]) {
  const compact = width === WIDTHS.phone;

  test.describe(`breadcrumb at ${String(width)}`, () => {
    test.use(atWidth(width));

    test('the spec dashboard: levels in order, with their separators', async ({ page }) => {
      await page.goto('/w/harbor/s/002');
      await expect(page.locator(NAV)).toBeVisible();
      await expect(page.locator(`${NAV} ol > li`)).toHaveCount(compact ? 3 : 5);

      await expect(crumb(page, 'milestone')).toHaveText(M10.name);
      await expect(crumb(page, 'feature')).toHaveText(compact ? F2.id : `${F2.id} ${F2.name}`);
      await expect(crumb(page, 'spec')).toHaveText(compact ? '002' : `002 ${slugOf('002')}`);
      await expect(page.locator(`${NAV} [data-crumb-more]`)).toHaveCount(0); // 002 holds F2 only

      if (compact) {
        await expect(crumb(page, 'workspace')).toHaveCount(0);
        await expect(crumb(page, 'area')).toHaveCount(0);
        await expect(item(page, 'milestone')).not.toHaveAttribute('data-sep');
        await expect(crumb(page, 'spec')).toHaveAttribute('aria-current', 'page'); // the spec is the last crumb
      } else {
        await expect(crumb(page, 'workspace')).toHaveText('harbor');
        await expect(crumb(page, 'area')).toHaveText(en.shell.areas['dashboard'] ?? '');
        await expect(crumb(page, 'area')).toHaveAttribute('aria-current', 'page');
        await expect(item(page, 'milestone')).toHaveAttribute('data-sep', 'scope');
        await expect(item(page, 'area')).toHaveAttribute('data-sep', 'down');
        await expect(crumb(page, 'spec')).not.toHaveAttribute('aria-current');
      }
      await expect(item(page, 'feature')).toHaveAttribute('data-sep', 'dot');
      await expect(item(page, 'spec')).toHaveAttribute('data-sep', 'down');
      await expect(crumb(page, 'claim')).toHaveCount(0);
      await expect(crumb(page, 'task')).toHaveCount(0);
    });

    test('the order in the DOM is milestone, feature, spec, area', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      await expect(page.locator(`${NAV} ol > li`)).toHaveCount(compact ? 3 : 5);
      const names = await page.locator(`${NAV} [data-crumb]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-crumb')));
      expect(names).toEqual(compact ? ['milestone', 'feature', 'spec'] : ['workspace', 'milestone', 'feature', 'spec', 'area']);
    });

    for (const { area, tab, first } of TAB_ROUTES) {
      test(`every spec route: ${tab} shows the breadcrumb${compact ? '' : ` with the ${area} area`}`, async ({ page }) => {
        await page.goto(`/w/harbor/s/002/${tab}`);
        await expect(page.locator(NAV)).toBeVisible();
        await expect(crumb(page, 'milestone')).toHaveText(M10.name);
        await expect(crumb(page, 'feature')).toContainText(F2.id);
        await expect(crumb(page, 'spec')).toContainText('002');
        if (compact) {
          await expect(crumb(page, 'area')).toHaveCount(0);
        } else {
          const label = en.shell.areas[area] ?? '';
          await expect(page.locator(`${NAV} [data-crumb="area"][aria-current="page"]`)).toHaveText(label);
          if (first) await expect(page).toHaveURL(new RegExp(`/w/harbor/s/002/${tab}$`, 'u'));
        }
      });
    }

    test('a claim in the Claims tab is the last crumb', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims#claim-ISC-51');
      const leaf = crumb(page, 'claim');
      await expect(leaf).toHaveText('ISC-51');
      await expect(leaf).toHaveAttribute('aria-current', 'page');
      await expect(item(page, 'claim')).toHaveAttribute('data-sep', 'down');
      await expect(leaf).toHaveAttribute('href', '/w/harbor/s/002/claims#claim-ISC-51');
      await expect(crumb(page, 'feature')).toContainText(F2.id); // ISC-51 sits in F2
      await expect(crumb(page, 'spec')).not.toHaveAttribute('aria-current');
      await expect(page.locator(`${NAV} [aria-current="page"]`)).toHaveCount(1);
      await expect(page.locator(`${NAV} li:last-child [data-crumb]`)).toHaveAttribute('data-crumb', 'claim');
      if (!compact) {
        // The area is no longer the current level: a link to the tab, not a plain span.
        await expect(crumb(page, 'area')).toHaveAttribute('href', '/w/harbor/s/002/claims');
        await expect(crumb(page, 'area')).not.toHaveAttribute('aria-current');
      }
    });

    test('a task in the Tasks tab is the last crumb', async ({ page }) => {
      await page.goto('/w/harbor/s/002/tasks#task-T27');
      const leaf = crumb(page, 'task');
      await expect(leaf).toHaveText('T27');
      await expect(leaf).toHaveAttribute('aria-current', 'page');
      await expect(item(page, 'task')).toHaveAttribute('data-sep', 'down');
      await expect(leaf).toHaveAttribute('href', '/w/harbor/s/002/tasks#task-T27');
      await expect(crumb(page, 'claim')).toHaveCount(0);
      await expect(page.locator(`${NAV} li:last-child [data-crumb]`)).toHaveAttribute('data-crumb', 'task');
    });

    test('a tab without a fragment, or with a foreign one, has no claim or task level', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims');
      await expect(crumb(page, 'spec')).toBeVisible();
      await expect(crumb(page, 'claim')).toHaveCount(0);
      await page.goto('/w/harbor/s/002/tasks#claim-ISC-51');
      await expect(crumb(page, 'spec')).toBeVisible();
      await expect(crumb(page, 'task')).toHaveCount(0);
      await expect(crumb(page, 'claim')).toHaveCount(0);
    });

    test.describe('an archived spec', () => {
      test('001 renders the page with its own breadcrumb', async ({ page }) => {
        await page.goto('/w/harbor/s/001');
        await expect(page.locator('[data-page="not-found"]')).toHaveCount(0);
        await expect(page.locator('[data-page="spec-dashboard"]')).toBeVisible();
        const archived = en.planning.breadcrumb.archived;
        const spec = crumb(page, 'spec');
        await expect(spec).toHaveAttribute('aria-label', compact ? `001, ${archived}` : `001 ${slugOf('001')}, ${archived}`);
        await expect(spec.locator('ui-icon')).toHaveCount(1); // the archive glyph
        await expect(crumb(page, 'milestone')).toHaveText(M10.name);
        await expect(crumb(page, 'feature')).toHaveText(compact ? F1.id : `${F1.id} ${F1.name}`);
        await expect(item(page, 'spec')).toHaveAttribute('data-sep', 'down');
      });

      test('001 keeps the breadcrumb on its tab routes', async ({ page }) => {
        for (const tab of ['status', 'claims', 'tasks'] as const) {
          await page.goto(`/w/harbor/s/001/${tab}`);
          await expect(crumb(page, 'spec')).toHaveAttribute('aria-label', /archived$/u);
          await expect(crumb(page, 'feature')).toContainText(F1.id);
        }
      });
    });

    test('the links resolve: spec, and claim back to its area', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims#claim-ISC-51');
      await crumb(page, 'spec').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002$/u);
      await expect(page.locator('[data-page="spec-dashboard"]')).toBeVisible();

      if (!compact) {
        await page.goto('/w/harbor/s/002/tasks#task-T27');
        await crumb(page, 'area').click();
        await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/u); // the Data area opens on its first tab, no fragment
        await expect(page.locator('app-claims-tab')).toBeVisible();
        await expect(crumb(page, 'task')).toHaveCount(0);
      }
    });

    test('the feature and milestone links point at their pages', async ({ page }) => {
      await page.goto('/w/harbor/s/002');
      await expect(crumb(page, 'milestone')).toHaveAttribute('href', `/w/harbor/milestones#m-${M10.slug}`);
      await expect(crumb(page, 'feature')).toHaveAttribute('href', `/w/harbor/features#${F2.id}`);
      await expect(crumb(page, 'spec')).toHaveAttribute('href', '/w/harbor/s/002');
      await page.goto('/w/harbor/s/001');
      await expect(crumb(page, 'milestone')).toHaveAttribute('href', `/w/harbor/milestones#m-${M10.slug}`);
      await expect(crumb(page, 'feature')).toHaveAttribute('href', `/w/harbor/features#${F1.id}`);
    });

    test('the "+n" chip lists the other blocks a spec holds, each linking to its card', async ({ page }) => {
      await servePlanningWithSpecInF3(page);
      await page.goto('/w/harbor/s/002');
      const more = page.locator(`${NAV} [data-crumb-more]`);
      await expect(more).toHaveText('+1');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      const links = page.locator('.crumb-more-list a');
      await expect(links).toHaveCount(1);
      await expect(links.first()).toHaveAttribute('href', `/w/harbor/features#${F3.id}`);
      await expect(links.first()).toContainText(`${F3.id} ${F3.name}`);
      await expect(crumb(page, 'feature')).toHaveAttribute('href', `/w/harbor/features#${F2.id}`); // the main block stays the crumb
    });

    test('the workspace link resolves', async ({ page }) => {
      test.skip(compact, 'the short form has no workspace crumb; the header pill names it');
      await page.goto('/w/harbor/s/002/claims');
      await expect(crumb(page, 'workspace')).toHaveAttribute('href', '/w/harbor');
      await crumb(page, 'workspace').click();
      await expect(page).toHaveURL(/\/w\/harbor$/u);
      await expect(page.locator('[data-page="workspace"]')).toBeVisible();
    });

    test('the row stays on one line and does not overflow', async ({ page }) => {
      test.skip(!compact, 'the fit is the compact tier’s claim (design.md, Fitting 358 px)');
      // The longest form there is: the archived spec (glyph) with a claim leaf.
      await page.goto('/w/harbor/s/001/claims#claim-ISC-5');
      const ol = page.locator(`${NAV} ol`);
      await expect(crumb(page, 'claim')).toBeVisible();
      const box = await ol.boundingBox();
      expect(box?.height ?? Infinity).toBeLessThanOrEqual(44);
      // The list clips itself (its box bleeds a few px past the nav for the focus ring), so its own content must fit,
      // and its box must stay inside the viewport.
      const overflow = await ol.evaluate((list) => list.scrollWidth - list.clientWidth);
      expect(overflow).toBeLessThanOrEqual(0);
      expect((box?.x ?? 0) + (box?.width ?? Infinity)).toBeLessThanOrEqual(WIDTHS.phone);
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(pageOverflow).toBeLessThanOrEqual(0);
      const items = await page.locator(`${NAV} ol > li`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
      for (const height of items) expect(height).toBeLessThanOrEqual(box?.height ?? 0);
      const milestone = await crumb(page, 'milestone').locator('.name').boundingBox();
      expect(milestone?.width ?? Infinity).toBeLessThanOrEqual(96);
    });
  });
}

// The click-and-land cases: a crumb opens its card or row on the Features and Milestones pages.
test.describe('feature and milestone links land', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('the milestone crumb opens its row on the Milestones page', async ({ page }) => {
    await page.goto('/w/harbor/s/002');
    await crumb(page, 'milestone').click();
    await expect(page).toHaveURL(new RegExp(`/w/harbor/milestones#m-${M10.slug}$`, 'u'));
    await expect(page.locator(`article#m-${M10.slug}`)).toBeFocused();
    await expect(page.locator(`article#m-${M10.slug}`)).toBeInViewport();
  });

  test('the feature crumb opens its card on the Features page', async ({ page }) => {
    await page.goto('/w/harbor/s/002');
    await crumb(page, 'feature').click();
    await expect(page).toHaveURL(new RegExp(`/w/harbor/features#${F2.id}$`, 'u'));
    await expect(page.locator(`article#${F2.id}`)).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(F2.id);
    await expect(page.locator(`article#${F2.id}`)).toBeInViewport();
  });

  test('a "+n" list link opens the other block’s card', async ({ page }) => {
    await servePlanningWithSpecInF3(page);
    await page.goto('/w/harbor/s/002');
    await page.locator(`${NAV} [data-crumb-more]`).click();
    await page.locator('.crumb-more-list a').first().click();
    await expect(page).toHaveURL(new RegExp(`/w/harbor/features#${F3.id}$`, 'u'));
    await expect(page.locator(`article#${F3.id}`)).toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.id)).toBe(F3.id);
  });
});
