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
import { EDGES_HEADER, type EdgeState, RESET_PATH, SESSION_HEADER, STUB_EDGES } from './stub-api';

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
    // T30 (ISC-167.1): `g f` and `g m` stay as aliases of the old routes, which land on the tree.
    for (const key of ['f', 'm']) {
      await page.goto('/w/harbor');
      await expect(page.locator('header [data-control="page"]')).toBeVisible();
      await page.keyboard.press('g');
      await page.keyboard.press(key);
      await expect(page).toHaveURL(/\/w\/harbor\/planning\/tree$/u);
      await expect(page.locator('[data-lens="tree"]')).toBeVisible();
    }
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

/**
 * T31 · ISC-167.1 (`bun run e2e -- planning -g redirect`): the old addresses `/w/:ws/features[#F<n>]` and
 * `/w/:ws/milestones[#m-<slug>]` land on the tree lens; with an anchor the named object is in `?sel=`, its row is
 * visible and focused, and the sidebar shows it. The spec head's feature and milestone chips (ISC-105) and the
 * palette's Features and Milestones entries (ISC-106) point at the same addresses.
 */
const REDIRECT_FEATURE = harbor.features.find((feature) => feature.id === 'F2');
const REDIRECT_MILESTONE = harbor.milestones.find((milestone) => milestone.name === 'Harbor 1.0');
if (REDIRECT_FEATURE === undefined || REDIRECT_MILESTONE === undefined) throw new Error('the harbor planning golden lost F2 or Harbor 1.0');
const featureRef = `feature:${REDIRECT_FEATURE.id}`;
const milestoneRef = `milestone:${REDIRECT_MILESTONE.slug}`;
const treeAt = (ref: string): string => `/w/harbor/planning/tree?sel=${ref}`;
const sidebarOf = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');

/** The tree landed with `ref` selected: its row visible, focused and marked, the sidebar open on the object. */
async function expectSelectedOnTree(page: Page, ref: string, name: string): Promise<void> {
  await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/planning/tree' && url.searchParams.get('sel') === ref && url.hash === '');
  await expect(page.locator('[data-lens="tree"]')).toBeVisible();
  const focused = page.locator('[data-lens="tree"] [role="treeitem"]:focus');
  await expect(focused).toHaveAttribute('data-ref', ref);
  await expect(focused).toHaveAttribute('data-selected', 'row');
  await expect(focused).toBeInViewport();
  await expect(sidebarOf(page)).toBeVisible();
  await expect(sidebarOf(page)).toContainText(name);
}

test.describe('planning: redirect', () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const path of ['/w/harbor/features', '/w/harbor/milestones']) {
    test(`redirect: ${path} without an anchor lands on the tree, nothing selected`, async ({ page }) => {
      await page.goto(path);
      await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/planning/tree' && url.search === '' && url.hash === '');
      await expect(page.locator('[data-lens="tree"]')).toBeVisible();
      await expect(lensTab(page, 'tree')).toHaveAttribute('aria-current', 'page');
      await expect(sidebarOf(page)).toHaveCount(0);
    });
  }

  test('redirect: /features#F<n> selects the feature on the tree: visible, focused, in the sidebar', async ({ page }) => {
    await page.goto(`/w/harbor/features#${REDIRECT_FEATURE.id}`);
    await expectSelectedOnTree(page, featureRef, REDIRECT_FEATURE.name);
  });

  test('redirect: /milestones#m-<slug> selects the milestone on the tree: visible, focused, in the sidebar', async ({ page }) => {
    await page.goto(`/w/harbor/milestones#m-${REDIRECT_MILESTONE.slug}`);
    await expectSelectedOnTree(page, milestoneRef, REDIRECT_MILESTONE.name);
  });

  test('redirect: an anchor that names no object lands on the plain tree', async ({ page }) => {
    await page.goto('/w/harbor/features#nothing-here');
    await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/planning/tree' && url.search === '' && url.hash === '');
    await expect(page.locator('[data-lens="tree"]')).toBeVisible();
  });

  test('redirect: Back after a redirect does not return to the old address', async ({ page }) => {
    await page.goto('/w/harbor');
    await expect(page.locator('header [data-control="page"]')).toBeVisible();
    await page.goto(`/w/harbor/features#${REDIRECT_FEATURE.id}`);
    await expectSelectedOnTree(page, featureRef, REDIRECT_FEATURE.name);
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === '/w/harbor');
  });

  test('redirect: the spec head chips point at the tree and land on their object', async ({ page }) => {
    const chip = (kind: string): Locator => page.locator(`[data-head-chip="${kind}"]`).first();
    await page.goto('/w/harbor/s/002');
    await expect(chip('milestone')).toHaveAttribute('href', treeAt(milestoneRef));
    await expect(chip('feature')).toHaveAttribute('href', treeAt(featureRef));
    await chip('feature').click();
    await expectSelectedOnTree(page, featureRef, REDIRECT_FEATURE.name);
    await page.goto('/w/harbor/s/002');
    await chip('milestone').click();
    await expectSelectedOnTree(page, milestoneRef, REDIRECT_MILESTONE.name);
  });

  for (const kind of ['feature', 'milestone'] as const) {
    test(`redirect: the palette's ${kind} entry lands on the tree with the ${kind} selected`, async ({ page }) => {
      const [entry, ref, name] =
        kind === 'feature'
          ? [`feature-${REDIRECT_FEATURE.id}`, featureRef, REDIRECT_FEATURE.name]
          : [`milestone-${REDIRECT_MILESTONE.slug}`, milestoneRef, REDIRECT_MILESTONE.name];
      await page.goto('/w/harbor');
      await expect(page.locator('header [data-control="palette"]')).toBeVisible();
      await page.keyboard.press('Meta+k');
      const palette = page.locator('app-command-palette dialog');
      await expect(palette).toBeVisible();
      await palette.getByRole('combobox').fill(name);
      const option = palette.locator(`[data-group="${kind}s"] [data-entry="${entry}"]`);
      await expect(option).toBeVisible();
      await option.click();
      await expectSelectedOnTree(page, ref, name);
    });
  }
});

/**
 * T34 · ISC-170.1 (`bun run e2e -- planning -g edges`): on the graph lens every spec edge `(after: NNN)` is one arrow
 * between spec nodes, marked `data-spec-edge="open|met"` and named `<from> waits on <to>, <state>`; an open arrow draws
 * dashed, a met one solid, so the two read apart. The `Spec edges` chip hides them; a blocker drawn in no lane of the
 * picked milestone stands as a ghost node. Against the stub's edge variants (`X-Spectant-Stub-Edges`, `STUB_EDGES`):
 * `waiting` holds 009 on 002 and 002 on 006 with both blockers unmerged, `met` the same edges merged; without the
 * header harbor's golden has no spec edge and the graph no such arrow.
 */
const EDGE_PAIRS = [
  [STUB_EDGES.full.spec, STUB_EDGES.full.on],
  [STUB_EDGES.partial.spec, STUB_EDGES.partial.on],
] as const;
const graphFrame = (page: Page): Locator => page.locator('[data-lens="graph"] [data-graph-frame]');
const arrows = (page: Page): Locator => graphFrame(page).locator('path[data-spec-edge]');

/** The graph lens at `m`, drawn: the status line gone and the spec nodes in the frame. */
async function openGraph(page: Page, m: string): Promise<void> {
  await page.goto(`/w/harbor/planning/graph?m=${m}`);
  await expect(page.locator('[data-lens="graph"]')).toBeVisible();
  await expect(page.locator('[data-graph-status]')).toHaveCount(0);
  await expect(graphFrame(page).locator('g.node[data-ref^="spec:"]').first()).toBeVisible();
}

/** The computed `stroke-dasharray` of every spec-edge arrow, in document order. */
const dashes = (page: Page): Promise<string[]> => arrows(page).evaluateAll((paths) => paths.map((p) => getComputedStyle(p).strokeDasharray));

test.describe('planning: spec edges', () => {
  test.use(atWidth(WIDTHS.desktop));

  let session = '';
  const useEdges = (edges: EdgeState): void => {
    test.beforeEach(async ({ page }, info) => {
      session = `planning-edges-${edges}-${info.testId}`;
      await page.context().setExtraHTTPHeaders({ ...(edges === 'off' ? {} : { [EDGES_HEADER]: edges }), [SESSION_HEADER]: session });
    });
    test.afterEach(async ({ request }) => {
      await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
    });
  };

  test.describe('waiting', () => {
    useEdges('waiting');

    test('edges: each open spec edge is one dashed arrow named after its pair; the chip hides them all', async ({ page }) => {
      await openGraph(page, 'all');
      await expect(arrows(page)).toHaveCount(EDGE_PAIRS.length);
      await expect(graphFrame(page).locator('path[data-spec-edge="open"]')).toHaveCount(EDGE_PAIRS.length);
      for (const [from, to] of EDGE_PAIRS) {
        await expect(graphFrame(page).locator(`path[data-spec-edge="open"][aria-label="${from} waits on ${to}, Spec edge open"]`)).toHaveCount(1);
      }
      for (const dash of await dashes(page)) expect(dash, 'an open arrow is dashed').not.toBe('none');

      const chip = page.locator('[data-filter="edges"]');
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await chip.click();
      await expect(chip).toHaveAttribute('aria-pressed', 'false');
      await expect(graphFrame(page).locator('g.node[data-ref^="spec:"]').first()).toBeVisible();
      await expect(arrows(page)).toHaveCount(0);
      await chip.click();
      await expect(arrows(page)).toHaveCount(EDGE_PAIRS.length);
    });
  });

  test.describe('met', () => {
    useEdges('met');

    test('edges: each met spec edge is one solid arrow, drawn apart from an open one', async ({ page }) => {
      await openGraph(page, 'all');
      await expect(arrows(page)).toHaveCount(EDGE_PAIRS.length);
      await expect(graphFrame(page).locator('path[data-spec-edge="met"]')).toHaveCount(EDGE_PAIRS.length);
      for (const [from, to] of EDGE_PAIRS) {
        await expect(graphFrame(page).locator(`path[data-spec-edge="met"][aria-label="${from} waits on ${to}, Spec edge met"]`)).toHaveCount(1);
      }
      const met = await dashes(page);
      for (const dash of met) expect(dash, 'a met arrow is solid').toBe('none');

      // The same arrows served with the blockers unmerged draw open: their dash pattern is none of the met ones.
      await page.context().setExtraHTTPHeaders({ [EDGES_HEADER]: 'waiting', [SESSION_HEADER]: session });
      await openGraph(page, 'all');
      await expect(graphFrame(page).locator('path[data-spec-edge="open"]')).toHaveCount(EDGE_PAIRS.length);
      for (const dash of await dashes(page)) expect(met, 'open and met draw apart').not.toContain(dash);
    });

    test('edges: a blocker outside the picked milestone stands as a ghost node at the end of its arrow', async ({ page }) => {
      await openGraph(page, 'harbor-1-0');
      const ghost = graphFrame(page).locator('g.node.n-ghost');
      await expect(ghost).toHaveCount(1);
      await expect(ghost).toContainText(`${STUB_EDGES.partial.on} ↗ No milestone`);
      await expect(graphFrame(page).locator('path[data-spec-edge="met"]').first()).toBeAttached();
    });
  });

  test.describe('golden', () => {
    useEdges('off');

    test('edges: a workspace without spec edges draws no spec-edge arrow', async ({ page }) => {
      await openGraph(page, 'all');
      await expect(graphFrame(page).locator('path.flowchart-link').first()).toBeAttached();
      await expect(arrows(page)).toHaveCount(0);
    });
  });
});
