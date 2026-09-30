/**
 * T37 · ISC-104: the Milestones page (`/w/:ws/milestones`) is absent while no spec of the workspace carries a
 * milestone and present, one row per milestone (an archived spec's included), as soon as one does, at 390 and 1440.
 * `bun run e2e -- milestones`. Against the stub API: lantern (`core/fixtures/lantern.planning.golden.json`) has none,
 * harbor (`core/fixtures/harbor.planning.golden.json`) has Harbor 0.9 and Harbor 1.0.
 *
 * The golden is the source of every expected name, count and state. Its `state` was derived at core's own "now" and is
 * served as is, so the state word is asserted from the golden while the day count comes from the pinned clock
 * (`FIXED_NOW` minus the target, clamped at 0), as the page computes it. The palette has no milestone group yet
 * (T43/T44 wait on spec 001's palette API), so it is not asserted here.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';

import type { PlanningModel } from '../../core/src/planning';
import { atWidth, expect, FIXED_NOW, test, WIDTHS } from './fixtures';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const harbor = read('../../core/fixtures/harbor.planning.golden.json') as PlanningModel;
const lantern = read('../../core/fixtures/lantern.planning.golden.json') as PlanningModel;
const lanternSpecs = Object.keys(read('../../core/fixtures/lantern.spec.golden.json') as Record<string, unknown>);
const en = read('../src/i18n/en.json') as {
  shell: { pages: { specs: string; features: string; milestones: string } };
  planning: {
    features: { valueText: string };
    milestones: { meta: string; caption: string; state: Record<string, string> };
  };
};

const milestones = harbor.milestones.filter((m) => m.specs.length > 0);
const archivedMilestone = milestones.find((m) => m.specs.some((h) => h.archived));
const lateMilestone = milestones.find((m) => m.state === 'late');
const upcomingMilestone = milestones.find((m) => m.state === 'upcoming');
const lanternSpec = /^specs\/(\d+)-/u.exec(lanternSpecs[0] ?? '')?.[1];
if (!archivedMilestone || !lateMilestone || !upcomingMilestone || !lanternSpec || lantern.milestones.some((m) => m.specs.length > 0)) {
  throw new Error('the planning goldens no longer give harbor an archived, a late and an upcoming milestone and lantern none');
}
const archivedSpec = archivedMilestone.specs.find((h) => h.archived);
if (!archivedSpec) throw new Error('the archived milestone has no archived spec');

const template = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/gu, (_, key: string) => String(values[key]));
const DAY_MS = 86_400_000;
const utcDay = (iso: string): number => new Date(`${iso}T00:00:00Z`).getTime();
const today = utcDay(FIXED_NOW.slice(0, 10));
const format = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' });
const dateOf = (iso: string): string => format.format(new Date(`${iso}T00:00:00Z`));
const dayCount = (target: string, state: string): number => {
  const ahead = Math.round((utcDay(target) - today) / DAY_MS);
  return Math.max(0, state === 'late' ? -ahead : ahead);
};

const open = async (page: Page, hash = ''): Promise<void> => {
  await page.goto(`/w/harbor/milestones${hash}`);
  await expect(page.locator('ol.rows > li').first()).toBeVisible();
};
const card = (page: Page, slug: string): Locator => page.locator(`ol.rows > li:has(article[id="m-${slug}"])`);
const areaMenu = async (page: Page): Promise<Locator> => {
  await page.locator('header [data-control="area"]').click();
  const menu = page.getByRole('navigation', { name: 'Areas' });
  await expect(menu).toBeVisible();
  return menu;
};
const pageNames = (menu: Locator): Promise<Array<string | null>> =>
  menu.locator('[data-page]').evaluateAll((els) => els.map((el) => el.getAttribute('data-page')));

for (const width of [WIDTHS.phone, WIDTHS.desktop]) {
  const compact = width === WIDTHS.phone;

  test.describe(`milestones page at ${String(width)}: absent`, () => {
    test.use(atWidth(width));

    test('lantern has no Milestones page: not-found with a way on to Features, no rows', async ({ page }) => {
      await page.goto('/w/lantern/milestones');
      await expect(page.locator('app-not-found')).toBeVisible();
      const link = page.locator('.absent a');
      await expect(link).toHaveAttribute('href', '/w/lantern/features');
      await expect(link).toContainText(en.shell.pages.features);
      await expect(page.locator('ol.rows')).toHaveCount(0);
    });

    test('lantern’s area menu lists Specs and Features only', async ({ page }) => {
      await page.goto('/w/lantern');
      await expect(page.locator('header [data-control="area"]')).toBeVisible();
      const menu = await areaMenu(page);
      await expect(menu.locator('[data-page]')).toHaveCount(2);
      expect(await pageNames(menu)).toEqual(['specs', 'features']);
      await expect(menu.locator('[data-page="milestones"]')).toHaveCount(0);
    });

    test('lantern’s Features page and spec breadcrumb show no milestone', async ({ page }) => {
      await page.goto('/w/lantern/features');
      await expect(page.locator('ol.rows > li').first()).toBeVisible();
      await expect(page.locator('app-features-page')).not.toContainText(/milestone/iu);
      await expect(page.locator('a[href*="milestones"]')).toHaveCount(0);

      await page.goto(`/w/lantern/s/${lanternSpec}`);
      await expect(page.locator('app-spec-head [data-breadcrumb]')).toBeVisible();
      await expect(page.locator('app-spec-head [data-crumb="milestone"]')).toHaveCount(0);
    });
  });

  test.describe(`milestones page at ${String(width)}: present`, () => {
    test.use(atWidth(width));

    test('one row per milestone a spec names, in golden order, each an anchor target', async ({ page }) => {
      await open(page);
      await expect(page.locator('ol.rows > li')).toHaveCount(milestones.length);
      const articles = page.locator('ol.rows > li article');
      for (const [index, milestone] of milestones.entries()) {
        const article = articles.nth(index);
        await expect(article).toHaveAttribute('id', `m-${milestone.slug}`);
        await expect(article).toHaveAttribute('tabindex', '-1');
        await expect(article.locator('h2 ui-icon[name="flag"]')).toHaveCount(1);
        await expect(article.locator('h2 .name')).toHaveText(milestone.name);
      }
      await expect(page.locator('h1')).toContainText('Milestones in harbor');
    });

    test('the date and state per row: golden state word, day count from the pinned clock', async ({ page }) => {
      await open(page);
      for (const milestone of milestones) {
        const target = milestone.target ?? '';
        const row = card(page, milestone.slug);
        const time = row.locator('time');
        await expect(time).toHaveAttribute('datetime', target);
        await expect(time).toHaveText(dateOf(target));
        const days = dayCount(target, milestone.state);
        const line = row.locator('.date-line');
        if (milestone.state === 'late') {
          const chip = line.locator('ui-chip[data-tone="warning"]');
          await expect(chip).toContainText(template(en.planning.milestones.state['late'] ?? '', { days }));
          await expect(chip).toContainText('late');
          await expect(chip.locator('ui-icon[name="clock-alert"]')).toHaveCount(1);
        } else if (milestone.state === 'complete') {
          const chip = line.locator('ui-chip[data-tone="success"]');
          await expect(chip).toContainText(en.planning.milestones.state['complete'] ?? '');
          await expect(chip.locator('ui-icon[name="circle-check"]')).toHaveCount(1);
        } else {
          await expect(line.locator('ui-chip')).toHaveCount(0);
          const relative = line.locator('.relative');
          await expect(relative).toHaveText(template(en.planning.milestones.state['upcoming'] ?? '', { days }));
          await expect(relative).toContainText('in');
        }
        if (milestone.description) await expect(row.locator('p.desc')).toHaveText(milestone.description);
      }
    });

    test('every fraction and meter equals the golden', async ({ page }) => {
      await open(page);
      for (const milestone of milestones) {
        const row = card(page, milestone.slug);
        const fraction = row.locator('.fraction');
        await expect(fraction).toHaveText(`${String(milestone.closed)}/${String(milestone.total)}`);
        await expect(row.locator('ui-meter [aria-valuetext], ui-meter[aria-valuetext]').first()).toHaveAttribute(
          'aria-valuetext',
          template(en.planning.features.valueText, { closed: milestone.closed, total: milestone.total }),
        );
        if (milestone.state === 'complete') await expect(fraction).toHaveClass(/\bdone\b/u);
        else await expect(fraction).not.toHaveClass(/\bdone\b/u);
      }
    });

    test('the feature chips: golden ids, names and counts, each linking to its card', async ({ page }) => {
      await open(page);
      for (const milestone of milestones) {
        const chips = card(page, milestone.slug).locator('a.feature-chip');
        await expect(chips).toHaveCount(milestone.features.length);
        for (const [index, feature] of milestone.features.entries()) {
          const chip = chips.nth(index);
          await expect(chip).toHaveAttribute('href', `/w/harbor/features#${feature.id}`);
          await expect(chip.locator('.id')).toHaveText(feature.id);
          await expect(chip.locator('.name')).toHaveText(feature.name);
          await expect(chip.locator('.count')).toHaveText(`${String(feature.closed)}/${String(feature.total)}`);
        }
      }
    });

    test('the spec chips: golden ids, the archived spec marked and linked, never a main chip', async ({ page }) => {
      await open(page);
      for (const milestone of milestones) {
        const chips = card(page, milestone.slug).locator('.chip-row.specs app-spec-chip');
        await expect(chips).toHaveCount(milestone.specs.length);
        const ids = await chips.evaluateAll((els) => els.map((el) => el.getAttribute('data-spec')));
        expect(ids).toEqual(milestone.specs.map((h) => h.id));
        for (const holder of milestone.specs) {
          const link = chips.and(page.locator(`[data-spec="${holder.id}"]`)).locator('a');
          await expect(link).toHaveAttribute('href', `/w/harbor/s/${holder.id}`);
          await expect(link).toHaveAttribute('data-variant', holder.archived ? 'archived' : 'other');
          if (holder.archived) {
            await expect(link).toHaveAttribute('aria-label', /archived$/u);
            await expect(link.locator('ui-icon[name="archive"]')).toHaveCount(1);
          }
        }
      }
      await expect(page.locator('[data-variant="main"]')).toHaveCount(0);
    });

    test('the meta line names the count and the next milestone; the caption is present', async ({ page }) => {
      await open(page);
      const next = milestones.find((m) => m.state !== 'complete');
      if (!next?.target) throw new Error('no dated next milestone in the golden');
      const expected = template(en.planning.milestones.meta, {
        count: milestones.length,
        name: next.name,
        date: dateOf(next.target),
      });
      expect(expected).toBe('2 milestones · next: Harbor 0.9, Mar 15, 2026');
      await expect.poll(async () => (await page.locator('p.meta').innerText()).replace(/\s+/gu, ' ').trim()).toBe(expected);
      await expect(page.locator('p.caption')).toHaveText(en.planning.milestones.caption);
    });

    test('the chip rows carry their labels', async ({ page }) => {
      await open(page);
      const row = card(page, archivedMilestone.slug);
      await expect(row.locator('.chip-row.features dt ui-term dfn')).toHaveText('Features');
      await expect(row.locator('.chip-row.specs dt')).toHaveText('Specs');
    });

    test('an anchor opens the row: focused, marked as arrived', async ({ page }) => {
      const id = `m-${archivedMilestone.slug}`;
      await open(page, `#${id}`);
      await expect(page.locator(`article#${id}`)).toBeFocused();
      expect(await page.evaluate(() => document.activeElement?.id)).toBe(id);
      await expect(card(page, archivedMilestone.slug).locator('ui-card')).toHaveAttribute('data-arrived', '');
      await expect(page.locator('ui-card[data-arrived]')).toHaveCount(1);
    });

    test('a feature chip lands on its card of the Features page', async ({ page }) => {
      await open(page);
      const feature = archivedMilestone.features.find((f) => f.id === 'F2') ?? archivedMilestone.features[0];
      if (!feature) throw new Error('no feature on the archived milestone');
      await card(page, archivedMilestone.slug).locator(`a.feature-chip[href$="#${feature.id}"]`).click();
      await expect(page).toHaveURL(new RegExp(`/w/harbor/features#${feature.id}$`, 'u'));
      await expect(page.locator(`article#${feature.id}`)).toBeFocused();
    });

    test('the archived spec chip lands on the archived spec', async ({ page }) => {
      await open(page);
      await card(page, archivedMilestone.slug).locator(`app-spec-chip[data-spec="${archivedSpec.id}"] a`).click();
      await expect(page).toHaveURL(new RegExp(`/w/harbor/s/${archivedSpec.id}$`, 'u'));
    });

    if (compact) {
      test('at 390 the page does not overflow', async ({ page }) => {
        await open(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  });
}

test.describe('milestones page: the area menu', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('harbor’s menu lists Specs, Features, Milestones; on the page the trigger reads Milestones and its entry is current', async ({
    page,
  }) => {
    await page.goto('/w/harbor');
    await expect(page.locator('header [data-control="area"]')).toBeVisible();
    let menu = await areaMenu(page);
    expect(await pageNames(menu)).toEqual(['specs', 'features', 'milestones']);
    await menu.locator('[data-page="milestones"]').click();
    await expect(page).toHaveURL(/\/w\/harbor\/milestones$/u);
    await expect(page.locator('ol.rows > li').first()).toBeVisible();
    await expect(page.locator('header [data-control="area"]')).toContainText(en.shell.pages.milestones);
    menu = await areaMenu(page);
    await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-page', 'milestones');
  });
});
