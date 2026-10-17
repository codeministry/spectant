/**
 * Spec 038 · the Gantt lens `/w/:ws/planning/gantt`, which took the Matrix lens's place.
 *
 * T21 · ISC-203 (`bun run e2e -- gantt.spec`): the lens tab Gantt first, with `aria-current` and the query kept on a
 * switch; the palette and `g p` / `g f` / `g m` land on it; every group and lane on harbor equals harbor's Gantt golden
 * (`core/fixtures/harbor.gantt.golden.json`), and no spec node is drawn. harbor carries no `Milestone:` line, so its two
 * milestones stand without lanes (the late one in the past segment) and every feature in the no-milestone group,
 * without a bar; the bars are the unit spec's (`planning-gantt.spec.ts`, backlog-ranks and milestone-lines).
 * T23 · ISC-203.1 (`-g redirect`): the old matrix address redirects with its query.
 * T25 · ISC-204 (`-g sidebar`): a lane or its bar opens the detail sidebar with the feature, `?sel=` survives a reload,
 * Escape closes it and focuses the lane, at 1440 (docked in the rail), 820 (overlay) and 390 (sheet).
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { GanttModel } from '../../core/src/gantt';
import type { RelationRef } from '../../core/src/relations';
import { atWidth, expect, test, WIDTHS } from './fixtures';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const gantt = read('../../core/fixtures/harbor.gantt.golden.json') as GanttModel;
const en = read('../src/i18n/en.json') as { planning: { page: { lenses: Record<'gantt' | 'tree' | 'graph', string> } }; palette: { actions: { planning: string } } };

const LANES = gantt.groups.flatMap((g) => g.lanes);
const FIRST = LANES.at(0);
const SECOND = LANES.at(1);
if (FIRST === undefined || SECOND === undefined) throw new Error('the harbor Gantt golden lost its lanes');

const lensBar = (page: Page): Locator => page.locator('app-tab-bar-slot nav[data-ui="tab-bar"]');
const lensTab = (page: Page, lens: string): Locator => lensBar(page).locator(`a[data-tab="${lens}"]`);
const laneOf = (page: Page, ref: RelationRef): Locator => page.locator(`app-planning-gantt button[data-lane][data-ref="${ref}"]`);
const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const param = (page: Page, name: string): string | null => new URL(page.url()).searchParams.get(name);

async function openGantt(page: Page, path = '/w/harbor/planning/gantt'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('app-planning-gantt [data-gantt]')).toBeVisible();
}

test.describe('gantt: the lens (1440)', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('gantt: Gantt is the first lens tab with aria-current, and a switch keeps ?sel= and ?m=', async ({ page }) => {
    await openGantt(page, '/w/harbor/planning');
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/gantt$/u);
    await expect(lensBar(page).locator('a[data-tab]').first()).toHaveAttribute('data-tab', 'gantt');
    await expect(lensTab(page, 'gantt')).toHaveAttribute('aria-current', 'page');
    await expect(lensTab(page, 'gantt')).toContainText(en.planning.page.lenses.gantt);
    await expect(lensTab(page, 'gantt').locator('ui-icon')).toHaveAttribute('data-icon', 'chart-gantt');
    await page.goto('/w/harbor/planning/tree?sel=feature:F1&m=x');
    await lensTab(page, 'gantt').click();
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/gantt\?/u);
    expect([param(page, 'sel'), param(page, 'm')]).toEqual(['feature:F1', 'x']);
    await expect(lensTab(page, 'gantt')).toHaveAttribute('aria-current', 'page');
    await expect(lensTab(page, 'tree')).not.toHaveAttribute('aria-current', 'page');
  });

  test('gantt: the palette and g p, g f, g m land on the Gantt lens', async ({ page }) => {
    for (const key of ['p', 'f', 'm']) {
      await page.goto('/w/harbor');
      await expect(page.locator('header [data-control="page"]')).toBeVisible();
      await page.keyboard.press('g');
      await page.keyboard.press(key);
      await expect(page).toHaveURL(/\/w\/harbor\/planning\/gantt$/u);
      await expect(page.locator('[data-lens="gantt"]')).toBeVisible();
    }
    await page.goto('/w/harbor');
    await expect(page.locator('header [data-control="palette"]')).toBeVisible();
    await page.keyboard.press('Meta+k');
    const palette = page.locator('app-command-palette dialog');
    await expect(palette).toBeVisible();
    await expect(palette.locator('[role="listbox"]')).not.toHaveAttribute('aria-busy', 'true');
    await palette.getByRole('combobox').fill('gantt');
    const option = palette.getByRole('option', { name: en.palette.actions.planning });
    await expect(option).toHaveCount(1);
    await option.click();
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/gantt$/u);
  });

  test('gantt: every group and lane on harbor equals the Gantt golden; no spec node, the axis with today and the past segment', async ({ page }) => {
    await openGantt(page);
    const lens = page.locator('app-planning-gantt');
    await expect(lens.locator('[data-group]')).toHaveCount(gantt.groups.length);
    for (const [i, group] of gantt.groups.entries()) {
      const node = lens.locator('[data-group]').nth(i);
      await expect(node).toHaveAttribute('data-group', group.ref ?? 'none');
      await expect(node).toHaveAttribute('data-window', group.window);
      const lanes = node.locator('button[data-lane]');
      await expect(lanes).toHaveCount(group.lanes.length);
      for (const [j, lane] of group.lanes.entries()) {
        const at = lanes.nth(j);
        await expect(at).toHaveAttribute('data-ref', lane.ref);
        await expect(at.locator('[data-lane-id]')).toHaveText(lane.id);
        await expect(at.locator('[data-lane-name]')).toHaveText(lane.name);
        await expect(at.locator('[data-num]')).toHaveText(`${String(lane.closed)}/${String(lane.total)}`);
        await expect(at.locator('[data-label] ui-priority')).toHaveAttribute('data-level', lane.priority);
      }
    }
    await expect(lens.locator('[data-bar]')).toHaveCount(gantt.groups.filter((g) => g.window !== 'none').reduce((n, g) => n + g.lanes.length, 0));
    await expect(lens.locator('[data-ref^="spec:"], [data-card]')).toHaveCount(0);
    await expect(lens.locator('[data-axis] [data-today]')).toBeVisible();
    await expect(lens.locator('[data-gantt]')).toHaveAttribute('data-past', '');
    await expect(lens.locator('[data-group="milestone:harbor-0-9"] [data-group-mark]')).toBeVisible();
    await expect(lens.locator('[data-axis] [data-boundary]')).toHaveCount(gantt.groups.filter((g) => g.window === 'span').length);
  });
});

test.describe('gantt: redirect', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('redirect: the old matrix address lands on the Gantt lens with ?sel= and ?m= kept', async ({ page }) => {
    await page.goto(`/w/harbor/planning/board?sel=${FIRST.ref}&m=harbor-1-0`);
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/gantt\?/u);
    expect([param(page, 'sel'), param(page, 'm')]).toEqual([FIRST.ref, 'harbor-1-0']);
    await expect(page.locator('[data-lens="gantt"]')).toBeVisible();
    await expect(laneOf(page, FIRST.ref)).toHaveAttribute('aria-current', 'true');
    await page.goto('/w/harbor/planning/board');
    await expect(page).toHaveURL(/\/w\/harbor\/planning\/gantt$/u);
  });
});

/** The sidebar shows the feature, the address names it, its lane is marked current. */
async function expectFeature(page: Page, ref: RelationRef, presentation: string): Promise<void> {
  await expect.poll(() => param(page, 'sel')).toBe(ref);
  await expect(sidebar(page)).toHaveCount(1);
  await expect(sidebar(page)).toHaveAttribute('data-presentation', presentation);
  await expect(sidebar(page).locator('[data-part="type"]')).toHaveAttribute('data-type', 'feature');
  await expect(sidebar(page).locator('[data-part="id"]')).toHaveText(ref.slice('feature:'.length));
  await expect(laneOf(page, ref)).toHaveAttribute('aria-current', 'true');
}

for (const [width, presentation] of [
  [WIDTHS.desktop, 'docked'],
  [WIDTHS.tablet, 'overlay'],
  [WIDTHS.phone, 'sheet'],
] as const) {
  test.describe(`gantt: sidebar at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`sidebar: a lane and its bar open the feature (${presentation}); the address survives a reload; Escape focuses the lane`, async ({ page }) => {
      await openGantt(page);
      await laneOf(page, FIRST.ref).click();
      await expectFeature(page, FIRST.ref, presentation);
      await page.reload();
      await expectFeature(page, FIRST.ref, presentation);
      await page.keyboard.press('Escape');
      await expect(sidebar(page)).toHaveCount(0);
      await expect.poll(() => param(page, 'sel')).toBeNull();
      await expect(laneOf(page, FIRST.ref)).toBeFocused();

      // The bar, or on harbor's window-less lanes the time cell, selects the same object as the label.
      await laneOf(page, SECOND.ref).locator('[data-time]').click();
      await expectFeature(page, SECOND.ref, presentation);
      await page.keyboard.press('Escape');
      await expect(sidebar(page)).toHaveCount(0);
      await expect(laneOf(page, SECOND.ref)).toBeFocused();
    });
  });
}

test.describe('gantt: sidebar keys (1440)', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('sidebar: one tab stop for the lanes; ↓ moves to the next lane, Enter opens it', async ({ page }) => {
    await openGantt(page);
    await laneOf(page, FIRST.ref).focus();
    await expect(page.locator('app-planning-gantt button[data-lane][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await expect(laneOf(page, SECOND.ref)).toBeFocused();
    await page.keyboard.press('Enter');
    await expectFeature(page, SECOND.ref, 'docked');
    // At wide the docked sidebar takes the rail and the lens rescales beside it; the page never scrolls sideways.
    await expect(page.locator('aside.shell-rail app-detail-sidebar')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  });
});
