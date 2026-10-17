/**
 * Spec 026 · T29 · ISC-171 (`bun run e2e -- sidebar`): one detail sidebar, one component, for every object in every
 * view. Choosing a milestone, feature, spec, claim or idea in the tree, the Gantt lens, the graph, on the workspace board,
 * in the dashboard's specs list and on the ideas opens `app-detail-sidebar` with the type, id, title, progress and the
 * parents, children and blockers the relation index holds, every entry a link that re-selects. The selection lives in
 * `?sel=`, a reload shows the same sidebar, and Escape closes it and returns focus to the chosen object's `[data-ref]`.
 * Presentations per container tier (design.md § Across viewports): docked on the tree, the Gantt lens (spec 038) and
 * the dashboard at 1440, floating on the graph, board and idea page at 1440, a non-modal overlay at 820, a modal sheet
 * at 390.
 *
 * Against the stub API: every expected value comes from harbor's planning golden
 * (`core/fixtures/harbor.planning.golden.json`), its `relations` index.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { PlanningModel } from '../../core/src/planning';
import type { Relation, RelationRef } from '../../core/src/relations';
import { atWidth, expect, test, WIDTHS } from './fixtures';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const harbor = JSON.parse(readFileSync(new URL('../../core/fixtures/harbor.planning.golden.json', import.meta.url), 'utf8')) as PlanningModel;
if (!harbor.relations) throw new Error('the harbor planning golden lost its relation index');
const INDEX = harbor.relations;

/** The children a section shows before its “+N more” (`CHILD_CAP` in `layout/detail-sidebar/selection.ts`). */
const CHILD_CAP = 5;

function entry(ref: RelationRef): Relation {
  const found: Relation | undefined = INDEX[ref];
  if (!found) throw new Error(`the harbor planning golden lost ${ref}`);
  return found;
}

/**
 * The parents the sidebar lists, as ISC-171 asks for them: the index's own, and for a spec or a claim also the
 * milestones of its first feature parent, which the index keeps one level up. Each ref once.
 */
function parentsOf(ref: RelationRef): RelationRef[] {
  const own = entry(ref);
  const parents = [...own.parents];
  if (own.type === 'spec' || own.type === 'claim') {
    const feature = own.parents.find((p) => INDEX[p]?.type === 'feature');
    for (const p of feature ? entry(feature).parents : []) if (INDEX[p]?.type === 'milestone' && !parents.includes(p)) parents.push(p);
  }
  return parents.filter((p) => INDEX[p] !== undefined);
}

// The blocked claim of the fixture: an open `(after: …)` edge inside spec 002.
const BLOCKED = Object.values(INDEX).find((r) => r.type === 'claim' && r.blockers.length > 0 && r.parents.includes('spec:002'));
if (!BLOCKED) throw new Error('the harbor planning golden lost its blocked claim in spec 002');

/** The first ref of a list the golden must not leave empty. */
function firstOf(refs: readonly RelationRef[]): RelationRef {
  const ref = refs.at(0);
  if (ref === undefined) throw new Error('the harbor planning golden lost a relation the test follows');
  return ref;
}

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const refSel = (ref: RelationRef): string => `[data-ref="${ref}"]`;
const selParam = (page: Page): string | null => new URL(page.url()).searchParams.get('sel');

/** The sidebar shows `ref` in `presentation`, with everything the index holds for it; the address names it. */
async function expectSidebar(page: Page, ref: RelationRef, presentation: string): Promise<void> {
  const e = entry(ref);
  const sb = sidebar(page);
  await expect.poll(() => selParam(page)).toBe(ref);
  await expect(sb).toHaveCount(1);
  await expect(sb).toHaveAttribute('data-presentation', presentation);
  await expect(sb.locator('[data-part="type"]')).toHaveAttribute('data-type', e.type);
  await expect(sb.locator('[data-part="id"]')).toHaveText(e.id);
  await expect(sb.locator('[data-part="title"]')).toHaveText(e.title);
  const progress = sb.locator('[data-part="progress"]');
  await expect(progress).toBeVisible();
  if (e.total > 0) await expect(progress).toContainText(`${e.closed}/${e.total}`);

  const parents = parentsOf(ref);
  const parentSec = sb.locator('section[data-section="parents"]');
  if (parents.length === 0) await expect(parentSec).toHaveCount(0);
  else {
    await expect(parentSec.locator('[data-count]')).toHaveText(String(parents.length));
    await expect(parentSec.locator('a[data-sel]')).toHaveCount(parents.length);
    for (const [i, p] of parents.entries()) await expect(parentSec.locator('a[data-sel]').nth(i)).toHaveAttribute('data-sel', p);
  }

  const childSec = sb.locator('section[data-section="children"]');
  if (e.children.length === 0) await expect(childSec).toHaveCount(0);
  else {
    await expect(childSec.locator('[data-count]')).toHaveText(String(e.children.length));
    await expect(childSec.locator('a[data-sel]')).toHaveCount(Math.min(e.children.length, CHILD_CAP));
    await expect(childSec.locator('button[data-more]')).toHaveCount(e.children.length > CHILD_CAP ? 1 : 0);
  }

  const blockerLinks = sb.locator('section[data-section="blockers"] a[data-blocker]');
  await expect(blockerLinks).toHaveCount(e.blockers.length);
  for (const [i, b] of e.blockers.entries()) await expect(blockerLinks.nth(i)).toHaveAttribute('data-sel', b);

  // Every relation entry is a real link carrying the address of the object it selects.
  for (const link of await sb.locator('a[data-sel]').all()) await expect(link).toHaveAttribute('href', /[?&]sel=/u);
}

/** Clicks the sidebar's entry for `ref` and checks the sidebar now shows that object. */
async function follow(page: Page, ref: RelationRef, presentation: string): Promise<void> {
  await sidebar(page).locator(`a[data-sel="${ref}"]`).first().click();
  await expectSidebar(page, ref, presentation);
}

/** A reload of the address lands on the same sidebar. */
async function reloadSame(page: Page, ref: RelationRef, presentation: string): Promise<void> {
  await page.reload();
  await expectSidebar(page, ref, presentation);
}

/** Escape closes the sidebar, drops `?sel=`, and focus sits on the object's own element in the view. */
async function escapeReturns(page: Page, ref: RelationRef): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(sidebar(page)).toHaveCount(0);
  await expect.poll(() => selParam(page)).toBeNull();
  await expect(page.locator(refSel(ref)).first()).toBeFocused();
}

test.describe('sidebar: wide (1440)', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('tree: a milestone docks the sidebar; a child link re-selects the feature; reload; Escape focuses its row', async ({ page }) => {
    await page.goto('/w/harbor/planning/tree');
    await page.locator(`[role="treeitem"]${refSel('milestone:harbor-1-0')}`).click();
    await expectSidebar(page, 'milestone:harbor-1-0', 'docked');
    await follow(page, 'feature:F2', 'docked');
    await reloadSame(page, 'feature:F2', 'docked');
    await escapeReturns(page, 'feature:F2');
  });

  test('tree: a claim opened through its spec shows its open blocker; the blocker link re-selects', async ({ page }) => {
    const claim = BLOCKED.ref;
    await page.goto('/w/harbor/planning/tree?sel=spec:002');
    await expectSidebar(page, 'spec:002', 'docked');
    const spec = page.locator(`[role="treeitem"]${refSel('spec:002')}`);
    await spec.locator('[data-toggle]').click();
    await expect(spec).toHaveAttribute('aria-expanded', 'true');
    const row = page.locator(`[role="treeitem"]${refSel(claim)}`);
    await row.click();
    await expectSidebar(page, claim, 'docked');
    await expect(sidebar(page).locator('section[data-section="blockers"] [data-count]')).toHaveText(String(BLOCKED.blockers.length));
    await reloadSame(page, claim, 'docked');
    await escapeReturns(page, claim);
    await row.click();
    await follow(page, firstOf(BLOCKED.blockers), 'docked');
  });

  test('gantt: a feature lane docks the sidebar; reload; Escape focuses the lane; a child link re-selects', async ({ page }) => {
    await page.goto('/w/harbor/planning/gantt');
    const lane = page.locator(`app-planning-gantt button[data-lane]${refSel('feature:F2')}`);
    await lane.click();
    await expectSidebar(page, 'feature:F2', 'docked');
    await reloadSame(page, 'feature:F2', 'docked');
    await escapeReturns(page, 'feature:F2');
    await lane.click();
    await follow(page, firstOf(entry('feature:F2').children), 'docked');
  });

  test('graph: a milestone node floats the sidebar; reload; Escape focuses the node; a child link re-selects', async ({ page }) => {
    await page.goto('/w/harbor/planning/graph');
    const ref: RelationRef = 'milestone:harbor-0-9';
    await page.locator(`g.node${refSel(ref)}`).click();
    await expectSidebar(page, ref, 'floating');
    await reloadSame(page, ref, 'floating');
    await escapeReturns(page, ref);
    await page.locator(`g.node${refSel(ref)}`).click();
    await follow(page, firstOf(entry(ref).children), 'floating');
  });

  test('workspace board: a spec card floats the sidebar; +N more lists every child; reload; Escape focuses the card', async ({ page }) => {
    await page.goto('/w/harbor/board');
    const card = page.locator(`a.title${refSel('spec:002')}`);
    await card.click();
    await expect(page).toHaveURL(/\/w\/harbor\/board\?/u);
    await expectSidebar(page, 'spec:002', 'floating');
    await sidebar(page).locator('button[data-more]').click();
    await expect(sidebar(page).locator('section[data-section="children"] a[data-sel]')).toHaveCount(entry('spec:002').children.length);
    await reloadSame(page, 'spec:002', 'floating');
    await escapeReturns(page, 'spec:002');
    await card.click();
    await sidebar(page).locator('button[data-more]').click();
    await follow(page, BLOCKED.ref, 'floating');
  });

  test('workspace board: an idea card floats the sidebar with its feature and milestone parents', async ({ page }) => {
    await page.goto('/w/harbor/board');
    await page.locator(`a.title${refSel('idea:console-audit-log')}`).click();
    await expectSidebar(page, 'idea:console-audit-log', 'floating');
    await escapeReturns(page, 'idea:console-audit-log');
  });

  test('dashboard specs list: a row docks the sidebar; reload; Escape focuses the row', async ({ page }) => {
    await page.goto('/w/harbor');
    await page.locator(`a.row-link${refSel('spec:004')}`).click();
    await expect(page).toHaveURL(/\/w\/harbor\?/u);
    await expectSidebar(page, 'spec:004', 'docked');
    await reloadSame(page, 'spec:004', 'docked');
    await escapeReturns(page, 'spec:004');
  });

  test('dashboard ideas: a chip docks the sidebar on the idea; its feature parent re-selects; reload; Escape', async ({ page }) => {
    const ref: RelationRef = 'idea:console-audit-log';
    const chip = page.locator(`a.idea${refSel(ref)}`);
    const openIdeas = async (): Promise<void> => {
      if (!(await chip.isVisible())) await page.locator('[data-ideas-title]').click();
      await expect(chip).toBeVisible();
    };
    await page.goto('/w/harbor');
    await openIdeas();
    await chip.click();
    await expect(page).toHaveURL(/\/w\/harbor\?/u);
    await expectSidebar(page, ref, 'docked');
    await reloadSame(page, ref, 'docked');
    await openIdeas();
    await escapeReturns(page, ref);
    await chip.click();
    await follow(page, firstOf(parentsOf(ref)), 'docked');
  });

  test('idea page: Show relations floats the sidebar on the idea; reload; Escape focuses the button', async ({ page }) => {
    const ref: RelationRef = 'idea:console-audit-log';
    await page.goto('/w/harbor/ideas/console-audit-log');
    await page.locator(`a[data-show-relations]${refSel(ref)}`).click();
    await expectSidebar(page, ref, 'floating');
    await reloadSame(page, ref, 'floating');
    await escapeReturns(page, ref);
  });
});

test.describe('sidebar: medium (820)', () => {
  test.use(atWidth(WIDTHS.tablet));

  test('tree: the sidebar is a non-modal overlay; reload; Escape focuses the row', async ({ page }) => {
    await page.goto('/w/harbor/planning/tree');
    await page.locator(`[role="treeitem"]${refSel('feature:F2')}`).click();
    await expectSidebar(page, 'feature:F2', 'overlay');
    await expect(sidebar(page).locator('dialog')).toHaveCount(0);
    await reloadSame(page, 'feature:F2', 'overlay');
    await escapeReturns(page, 'feature:F2');
  });

  test('dashboard specs list: the overlay replaces the docked rail below wide', async ({ page }) => {
    await page.goto('/w/harbor');
    await page.locator(`a.row-link${refSel('spec:004')}`).click();
    await expectSidebar(page, 'spec:004', 'overlay');
    await escapeReturns(page, 'spec:004');
  });
});

test.describe('sidebar: compact (390)', () => {
  test.use(atWidth(WIDTHS.phone));

  test('dashboard specs list: the sidebar is a modal sheet; a link re-selects inside it; reload; Escape focuses the row', async ({ page }) => {
    await page.goto('/w/harbor');
    await page.locator(`a.row-link${refSel('spec:004')}`).click();
    await expectSidebar(page, 'spec:004', 'sheet');
    await expect(sidebar(page).locator('dialog[open]')).toHaveCount(1);
    expect(await sidebar(page).locator('dialog').evaluate((d) => d.matches(':modal'))).toBe(true);
    await reloadSame(page, 'spec:004', 'sheet');
    await escapeReturns(page, 'spec:004');
  });

  test('workspace board: a spec card opens the sheet; a parent link re-selects; Escape returns focus', async ({ page }) => {
    await page.goto('/w/harbor/board');
    await page.locator(`a.title${refSel('spec:002')}`).click();
    await expectSidebar(page, 'spec:002', 'sheet');
    await reloadSame(page, 'spec:002', 'sheet');
    await escapeReturns(page, 'spec:002');
    await page.locator(`a.title${refSel('spec:002')}`).click();
    await follow(page, firstOf(parentsOf('spec:002')), 'sheet');
  });
});
