/**
 * T41 · ISC-105: the breadcrumb of the spec head on every spec route, archived specs included, at 390 and 1440, against
 * the stub API (`core/fixtures/harbor.planning.golden.json`). `bun run e2e -- breadcrumb`.
 *
 * Since spec 024 (T36 · ISC-149) the levels are `workspace / Spec NNN · area › claim or task` on every tier; milestone,
 * feature and priority sit in the head's chip row beside it (spec 024: breadcrumb Workspace / Spec · Area,
 * milestone/feature/priority in the chip row (principal 2026-10-12, design.md)). "Links resolve" splits in two:
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
import { RESET_PATH, SESSION_HEADER } from './stub-api';

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

// spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
const SPEC_CRUMB = (id: string): string => `Spec ${id}`;
const headChip = (page: Page, name: string): Locator => page.locator(`${HEAD} [data-head-chips] [data-head-chip="${name}"]`);
const HEAD_MORE = `${HEAD} [data-head-chips] [data-head-more]`;

for (const width of [WIDTHS.phone, WIDTHS.desktop]) {
  const compact = width === WIDTHS.phone;

  test.describe(`breadcrumb at ${String(width)}`, () => {
    test.use(atWidth(width));

    test('the spec dashboard: levels in order, with their separators', async ({ page }) => {
      await page.goto('/w/harbor/s/002');
      await expect(page.locator(NAV)).toBeVisible();
      // spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
      await expect(page.locator(`${NAV} ol > li`)).toHaveCount(3);
      await expect(crumb(page, 'milestone')).toHaveCount(0);
      await expect(crumb(page, 'feature')).toHaveCount(0);
      await expect(page.locator(`${NAV} ui-priority`)).toHaveCount(0);
      await expect(headChip(page, 'milestone')).toHaveText(M10.name);
      await expect(headChip(page, 'feature')).toHaveText(F2.id);
      await expect(crumb(page, 'spec')).toHaveText(SPEC_CRUMB('002'));
      await expect(page.locator(HEAD_MORE)).toHaveCount(0); // 002 holds F2 only

      await expect(crumb(page, 'workspace')).toHaveText('harbor'); // every tier since T19 · ISC-140.1
      await expect(item(page, 'spec')).toHaveAttribute('data-sep', 'scope');
      await expect(crumb(page, 'area')).toHaveText(en.shell.areas['dashboard'] ?? '');
      await expect(crumb(page, 'area')).toHaveAttribute('aria-current', 'page');
      await expect(item(page, 'area')).toHaveAttribute('data-sep', 'dot');
      await expect(crumb(page, 'spec')).not.toHaveAttribute('aria-current');
      await expect(crumb(page, 'claim')).toHaveCount(0);
      await expect(crumb(page, 'task')).toHaveCount(0);
    });

    test('the order in the DOM is workspace, spec, area', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      // spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
      await expect(page.locator(`${NAV} ol > li`)).toHaveCount(3);
      const names = await page.locator(`${NAV} [data-crumb]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-crumb')));
      expect(names).toEqual(['workspace', 'spec', 'area']);
    });

    for (const { area, tab, first } of TAB_ROUTES) {
      test(`every spec route: ${tab} shows the breadcrumb with the ${area} area`, async ({ page }) => {
        await page.goto(`/w/harbor/s/002/${tab}`);
        await expect(page.locator(NAV)).toBeVisible();
        // spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
        await expect(headChip(page, 'milestone')).toHaveText(M10.name);
        await expect(headChip(page, 'feature')).toContainText(F2.id);
        await expect(crumb(page, 'spec')).toContainText('002');
        const label = en.shell.areas[area] ?? '';
        await expect(page.locator(`${NAV} [data-crumb="area"][aria-current="page"]`)).toHaveText(label);
        if (first) await expect(page).toHaveURL(new RegExp(`/w/harbor/s/002/${tab}$`, 'u'));
      });
    }

    test('a claim in the Claims tab is the last crumb', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims#claim-ISC-51');
      const leaf = crumb(page, 'claim');
      await expect(leaf).toHaveText('ISC-51');
      await expect(leaf).toHaveAttribute('aria-current', 'page');
      await expect(item(page, 'claim')).toHaveAttribute('data-sep', 'down');
      await expect(leaf).toHaveAttribute('href', '/w/harbor/s/002/claims#claim-ISC-51');
      await expect(headChip(page, 'feature')).toContainText(F2.id); // ISC-51 sits in F2
      await expect(crumb(page, 'spec')).not.toHaveAttribute('aria-current');
      await expect(page.locator(`${NAV} [aria-current="page"]`)).toHaveCount(1);
      await expect(page.locator(`${NAV} li:last-child [data-crumb]`)).toHaveAttribute('data-crumb', 'claim');
      // The area is no longer the current level: a link to the tab, not a plain span.
      await expect(crumb(page, 'area')).toHaveAttribute('href', '/w/harbor/s/002/claims');
      await expect(crumb(page, 'area')).not.toHaveAttribute('aria-current');
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
        // spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
        await expect(spec).toHaveAttribute('aria-label', `${SPEC_CRUMB('001')}, ${archived}`);
        await expect(spec.locator('ui-icon')).toHaveCount(1); // the archive glyph
        await expect(headChip(page, 'milestone')).toHaveText(M10.name);
        await expect(headChip(page, 'feature')).toHaveText(F1.id);
        await expect(item(page, 'spec')).toHaveAttribute('data-sep', 'scope');
      });

      test('001 keeps the breadcrumb on its tab routes', async ({ page }) => {
        for (const tab of ['status', 'claims', 'tasks'] as const) {
          await page.goto(`/w/harbor/s/001/${tab}`);
          await expect(crumb(page, 'spec')).toHaveAttribute('aria-label', /archived$/u);
          await expect(headChip(page, 'feature')).toContainText(F1.id);
        }
      });
    });

    test('the links resolve: spec, and claim back to its area', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims#claim-ISC-51');
      await crumb(page, 'spec').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002$/u);
      await expect(page.locator('[data-page="spec-dashboard"]')).toBeVisible();

      await page.goto('/w/harbor/s/002/tasks#task-T27');
      await crumb(page, 'area').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/u); // the Data area opens on its first tab, no fragment
      await expect(page.locator('app-claims-tab')).toBeVisible();
      await expect(crumb(page, 'task')).toHaveCount(0);
    });

    test('the feature and milestone chips point at the planning tree', async ({ page }) => {
      await page.goto('/w/harbor/s/002');
      await expect(headChip(page, 'milestone')).toHaveAttribute('href', `/w/harbor/planning/tree?sel=milestone:${M10.slug}`);
      await expect(headChip(page, 'feature')).toHaveAttribute('href', `/w/harbor/planning/tree?sel=feature:${F2.id}`);
      await expect(crumb(page, 'spec')).toHaveAttribute('href', '/w/harbor/s/002');
      await page.goto('/w/harbor/s/001');
      await expect(headChip(page, 'milestone')).toHaveAttribute('href', `/w/harbor/planning/tree?sel=milestone:${M10.slug}`);
      await expect(headChip(page, 'feature')).toHaveAttribute('href', `/w/harbor/planning/tree?sel=feature:${F1.id}`);
    });

    test('the "+n" chip lists the other blocks a spec holds, each linking to its card', async ({ page }) => {
      await servePlanningWithSpecInF3(page);
      await page.goto('/w/harbor/s/002');
      const more = page.locator(HEAD_MORE);
      await expect(more).toHaveText('+1');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      const links = page.locator('.head-more-list a');
      await expect(links).toHaveCount(1);
      await expect(links.first()).toHaveAttribute('href', `/w/harbor/planning/tree?sel=feature:${F3.id}`);
      await expect(links.first()).toContainText(`${F3.id} ${F3.name}`);
      await expect(headChip(page, 'feature')).toHaveAttribute('href', `/w/harbor/planning/tree?sel=feature:${F2.id}`); // the main block stays the chip
    });

    test('the workspace link resolves', async ({ page }) => {
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
    });
  });
}

// The click-and-land cases (spec 026, ISC-167.1): a planning chip selects its object on the planning tree.
test.describe('feature and milestone links land', () => {
  test.use(atWidth(WIDTHS.desktop));

  test('the milestone chip selects its milestone on the planning tree', async ({ page }) => {
    await page.goto('/w/harbor/s/002');
    await headChip(page, 'milestone').click();
    await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/planning/tree' && url.searchParams.get('sel') === `milestone:${M10.slug}`);
    await expect(page.locator('[data-lens="tree"] [role="treeitem"]:focus')).toHaveAttribute('data-ref', `milestone:${M10.slug}`);
    await expect(page.locator('[data-lens="tree"] [role="treeitem"]:focus')).toBeInViewport();
  });

  test('the feature chip selects its feature on the planning tree', async ({ page }) => {
    await page.goto('/w/harbor/s/002');
    await headChip(page, 'feature').click();
    await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/planning/tree' && url.searchParams.get('sel') === `feature:${F2.id}`);
    await expect(page.locator('[data-lens="tree"] [role="treeitem"]:focus')).toHaveAttribute('data-ref', `feature:${F2.id}`);
    await expect(page.locator('[data-lens="tree"] [role="treeitem"]:focus')).toBeInViewport();
  });

  test('a "+n" list link selects the other block on the planning tree', async ({ page }) => {
    await servePlanningWithSpecInF3(page);
    await page.goto('/w/harbor/s/002');
    // "+n" is clickable once the planning answer is in, before the spec answer. That one adds the type chip in front of
    // the stage chip, the anchored popover moves with its trigger, and a press measured before the move lands outside
    // the panel: a light dismiss, and the link is never visible again. Open it once the row is complete.
    await expect(headChip(page, 'type')).toBeVisible();
    await page.locator(HEAD_MORE).click();
    await page.locator('.head-more-list a').first().click();
    await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/planning/tree' && url.searchParams.get('sel') === `feature:${F3.id}`);
    await expect(page.locator('[data-lens="tree"] [role="treeitem"]:focus')).toHaveAttribute('data-ref', `feature:${F3.id}`);
  });
});

// T7 · ISC-140: the eyebrow over the h1 on the eight pages without a spec breadcrumb, at 390, 820 and 1440, in English
// and German. `bun run e2e -- breadcrumb -g eyebrow`.
//
// The eyebrow is the element `[data-page-eyebrow]` (one per page, plain text, no link) directly above the page's h1:
// the first h1 after it in document order is visible and starts at most 16 px below it. Its segments are its text split
// at ` · `, compared case-insensitively (the uppercase is CSS, the catalog texts stay mixed case) against the route's
// workspace slug and the catalog values named by key, so the expectations follow the catalogs rather than literals.
// `/` names no workspace; `/help` and `/settings` start with the `APP` segment (`shell.eyebrow.app`, added by T8) and
// never name a workspace (design.md, across viewports). No eyebrow and no h1 may show a raw catalog key.

type Catalog = Record<string, unknown>;
type Language = 'en' | 'de';
const catalogs: Record<Language, Catalog> = { en: read('../src/i18n/en.json') as Catalog, de: read('../src/i18n/de.json') as Catalog };

/** The catalog value at a dotted key, or undefined when the key is missing. */
const lookup = (catalog: Catalog, key: string): string | undefined => {
  let node: unknown = catalog;
  for (const part of key.split('.')) node = typeof node === 'object' && node !== null ? (node as Record<string, unknown>)[part] : undefined;
  return typeof node === 'string' ? node : undefined;
};

const IDEA = 'console-audit-log';
const WORKSPACE = 'harbor';
const WORKSPACE_NAMES = ['harbor', 'lantern'];
/** A dotted catalog key such as `shell.pages.board` or `header.switcher.allWorkspaces`. */
const CATALOG_KEY = /\b[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+\b/u;

/**
 * A segment is the route's workspace, the catalog value at a key, a literal, or (spec 024: the page eyebrows carry
 * a count, `HARBOR · BOARD · 12 CARDS`) a count with an optional unit word; `null` asserts only "no workspace named".
 */
type Segment = { ws: true } | { key: string } | { literal: string } | { count: true };
const COUNT_SEGMENT = /^\d+( \p{L}+)?$/u;
interface EyebrowPage {
  readonly name: string;
  readonly path: string;
  readonly segments: readonly Segment[] | null;
  /** The visible h1, where design.md fixes it. */
  readonly h1?: RegExp;
  /**
   * Spec 024 (the unified head `spec-head-unified`): below 640 the idea's labels stack between the path and the h1, so at the
   * compact tier the eyebrow-to-h1 gap leaves out this element's box and its 8 px row gap.
   */
  readonly compactBetween?: string;
}

const EYEBROW_PAGES: readonly EyebrowPage[] = [
  { name: 'workspaces', path: '/', segments: null },
  // spec 058: the dashboard's eyebrow reads `WS · DASHBOARD` without a count, its h1 "Dashboard · <ws>".
  { name: 'dashboard', path: `/w/${WORKSPACE}`, segments: [{ ws: true }, { key: 'shell.pages.dashboard' }], h1: /^\s*Dashboard\s*·\s*\S+\s*$/u },
  // spec 058: the Specs page's eyebrow ends in `shell.pages.summary.specs` (`6 ACTIVE · 2 ARCHIVED`), its h1 reads
  // "Specs · <ws>" (spec 024).
  { name: 'specs', path: `/w/${WORKSPACE}/specs`, segments: [{ ws: true }, { key: 'shell.pages.specs' }, { count: true }, { count: true }], h1: /^\s*Specs\s*·\s*\S+\s*$/u },
  // spec 024: the eyebrows of board, features and milestones end in their count; the idea's ends in its slug.
  { name: 'board', path: `/w/${WORKSPACE}/board`, segments: [{ ws: true }, { key: 'shell.pages.board' }, { count: true }] },
  {
    name: 'idea',
    path: `/w/${WORKSPACE}/ideas/${IDEA}`,
    segments: [{ ws: true }, { key: 'shell.pages.board' }, { key: 'ideas.title' }, { literal: IDEA }],
    compactBetween: '[data-idea-chips]',
  },
  // spec 024: the help eyebrow reads SPECTANT · GUIDE.
  { name: 'help', path: '/help', segments: [{ key: 'shell.eyebrow.app' }, { key: 'help.eyebrow' }] },
  { name: 'settings', path: '/settings', segments: [{ key: 'shell.eyebrow.app' }, { key: 'settings.title' }] },
];

const segmentsOf = (text: string): string[] =>
  text
    .split('·')
    .map((part) => part.replace(/\s+/gu, ' ').trim().toLowerCase())
    .filter((part) => part.length > 0);

/** Opens the page and checks its eyebrow against the catalog of `language`. */
async function checkEyebrow(page: Page, entry: EyebrowPage, language: Language): Promise<void> {
  await page.goto(entry.path);
  const eyebrow = page.locator('[data-page-eyebrow]');
  await expect(eyebrow, `${entry.name}: one eyebrow`).toHaveCount(1);
  await expect(eyebrow, `${entry.name}: the eyebrow is visible`).toBeVisible();
  await expect(eyebrow.locator('a'), `${entry.name}: the eyebrow is plain text`).toHaveCount(0);

  // The h1 it heads: the first h1 after it in document order, visible and at most 16 px below it.
  const index = await eyebrow.evaluate((el) =>
    [...document.querySelectorAll('h1')].findIndex((h) => (el.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
  );
  expect(index, `${entry.name}: an h1 follows the eyebrow`).toBeGreaterThanOrEqual(0);
  const h1 = page.locator('h1').nth(index);
  await expect(h1, `${entry.name}: the h1 under the eyebrow is visible`).toBeVisible();
  if (entry.h1) await expect(h1, `${entry.name}: the h1`).toHaveText(entry.h1);
  const [top, head] = await Promise.all([eyebrow.boundingBox(), h1.boundingBox()]);
  let gap = (head?.y ?? -Infinity) - ((top?.y ?? 0) + (top?.height ?? 0));
  if (entry.compactBetween && (page.viewportSize()?.width ?? Infinity) < 640) {
    const between = await page.locator(entry.compactBetween).boundingBox();
    gap -= (between?.height ?? 0) + 8;
  }
  expect(gap, `${entry.name}: the eyebrow sits directly above the h1`).toBeGreaterThanOrEqual(-1);
  expect(gap, `${entry.name}: the eyebrow sits directly above the h1`).toBeLessThanOrEqual(16);

  const text = (await eyebrow.textContent()) ?? '';
  expect(text, `${entry.name}: no catalog key in the eyebrow`).not.toMatch(CATALOG_KEY);
  expect((await h1.textContent()) ?? '', `${entry.name}: no catalog key in the h1`).not.toMatch(CATALOG_KEY);
  const actual = segmentsOf(text);
  const global = entry.segments === null || entry.segments.every((segment) => !('ws' in segment));
  // Spec 058: the Specs page's eyebrow ends in two counts (`6 ACTIVE · 2 ARCHIVED`); every count segment is checked.
  (entry.segments ?? []).forEach((segment, index) => {
    if ('count' in segment) expect(actual[index] ?? '', `${entry.name}: the eyebrow segment ${String(index)} is a count`).toMatch(COUNT_SEGMENT);
  });
  if (global) for (const name of WORKSPACE_NAMES) expect(actual, `${entry.name}: no workspace in the eyebrow`).not.toContain(name);
  if (entry.segments === null) return;

  const expected = entry.segments.map((segment, index) => {
    if ('ws' in segment) return WORKSPACE;
    if ('literal' in segment) return segment.literal;
    if ('count' in segment) return actual[index] ?? '';
    const value = lookup(catalogs[language], segment.key);
    expect(value, `${entry.name}: the ${language} catalog holds ${segment.key}`).toBeDefined();
    return (value ?? '').toLowerCase();
  });
  expect(actual, `${entry.name}: the eyebrow segments in ${language}`).toEqual(expected);
}

test.describe('eyebrow', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const entry of EYEBROW_PAGES) {
        test(`eyebrow over the h1: ${entry.name} (${entry.path})`, async ({ page }) => {
          await checkEyebrow(page, entry, 'en');
        });
      }

      test('eyebrow in German on all eight pages', async ({ page }, info) => {
        const headers = { [SESSION_HEADER]: `eyebrow-de-${info.testId}` };
        await page.context().setExtraHTTPHeaders(headers);
        await page.request.post(RESET_PATH, { headers });
        const saved = await page.request.put('/api/settings', { data: { language: 'de' }, headers });
        expect(saved.ok()).toBe(true);
        for (const entry of EYEBROW_PAGES) await checkEyebrow(page, entry, 'de');
        await page.request.post(RESET_PATH, { headers });
      });
    });
  }
});

// T18 · ISC-140.1: the workspace leads the spec breadcrumb at every tier, compact included (design.md, Mobile § the spec
// breadcrumb). `bun run e2e -- breadcrumb -g "workspace first"`.
//
// On the spec pages of the stub workspace harbor at 390, 820 and 1440, the first entry of `nav[data-breadcrumb]` is the
// workspace link (`data-crumb="workspace"`, href `/w/harbor`, the workspace name), and the last entry carries
// `aria-current="page"`: the spec at compact, the area at medium and wide, or the claim when one is open.
const WORKSPACE_FIRST_PATHS = ['/w/harbor/s/002', '/w/harbor/s/002/status', '/w/harbor/s/002/claims#claim-ISC-51', '/w/harbor/s/001'];

test.describe('workspace first', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`workspace first: the workspace leads the spec breadcrumb at ${String(width)}`, async ({ page }) => {
        for (const path of WORKSPACE_FIRST_PATHS) {
          await page.goto(path);
          const entries = page.locator(`nav[data-breadcrumb] ol > li`);
          await expect(entries.last(), `${path}: the breadcrumb renders`).toBeVisible();
          const first = entries.first().locator('[data-crumb]').first();
          await expect(first, `${path}: the first entry is the workspace`).toHaveAttribute('data-crumb', 'workspace');
          await expect(first, `${path}: the workspace links to its dashboard`).toHaveAttribute('href', '/w/harbor');
          await expect(first, `${path}: the workspace is named`).toHaveText('harbor');
          await expect(first, `${path}: the workspace is visible`).toBeVisible();
          await expect(entries.last().locator('[aria-current="page"]'), `${path}: the last entry is current`).toHaveCount(1);
          await expect(page.locator('nav[data-breadcrumb] [aria-current="page"]'), `${path}: one current entry`).toHaveCount(1);
        }
      });
    });
  }
});

// T21 · ISC-140.2: the header pills carry labels (design.md, every viewport § header pills, and across viewports). At
// 390, 820 and 1440 every visible segment of `app-shell-nav` holds a visible label `[data-pill-label]` and its value
// `[data-pill-value]`; no segment's text is a bare number. The labels are catalog values looked up by key name and
// compared case-insensitively (the uppercase is CSS): `shell.pills.workspace`, `shell.pills.page`, `shell.pills.area`.
// On `/`, `/help` and `/settings` the area pill is absent, the workspace pill reads `shell.pills.all · n`, and no
// segment shows `0`. `bun run e2e -- breadcrumb -g pills`.
// ISC-140.2 refined (spec 024: one-row header on every width, principal 2026-10-13): the labels are visible from 1120 px;
// below it the Workspace label is part of the select's accessible name, and the Area select is the entry of the
// overflow menu `⋯`, label and value visible there.
// Spec 069 (ISC-554, ISC-558): no Spec pill is left on any page (`spec` is never expected, so its absence is
// asserted); on a spec page the nav shows the open spec as the crumb `[data-crumb="spec"]` with its ID instead.
const PILLS = 'app-shell-nav';
// spec 024: PAGE select (principal 2026-10-13): the PAGE select is the second pill; the Area pill only on a spec page
type PillName = 'workspace' | 'page' | 'spec' | 'area';
/** The expected value of a pill: an exact catalog-backed text, or a pattern the value must match. */
interface PillExpectation {
  readonly label: string;
  readonly value: { key: string; count: number } | { key: string } | { text: string } | { pattern: RegExp };
}
interface PillPage {
  readonly name: string;
  readonly path: string;
  /** The pills that render; the others must be absent. */
  readonly pills: Partial<Record<PillName, PillExpectation>>;
  /** The ID the spec crumb shows; without it the crumb is absent. */
  readonly crumb?: string;
}

const DATA_AREA = SPEC_AREAS.find((area) => area.tabs.includes('claims'))?.id ?? 'data';
const ALL_WORKSPACES: PillExpectation = { label: 'shell.pills.workspace', value: { key: 'shell.pills.all', count: WORKSPACE_NAMES.length } };
const PILL_PAGES: readonly PillPage[] = [
  {
    name: 'workspace page',
    path: `/w/${WORKSPACE}`,
    pills: {
      workspace: { label: 'shell.pills.workspace', value: { text: WORKSPACE } },
      // spec 058: the workspace address is the Dashboard; the page pill names it.
      page: { label: 'shell.pills.page', value: { key: 'shell.pages.dashboard' } },
    },
  },
  {
    name: 'specs page',
    path: `/w/${WORKSPACE}/specs`,
    pills: {
      workspace: { label: 'shell.pills.workspace', value: { text: WORKSPACE } },
      page: { label: 'shell.pills.page', value: { key: 'shell.pages.specs' } },
    },
  },
  {
    name: 'spec page',
    path: `/w/${WORKSPACE}/s/002/claims`,
    pills: {
      workspace: { label: 'shell.pills.workspace', value: { text: WORKSPACE } },
      page: { label: 'shell.pills.page', value: { key: 'shell.pages.specs' } },
      area: { label: 'shell.pills.area', value: { key: `shell.areas.${DATA_AREA}` } },
    },
    crumb: '002',
  },
  { name: 'workspaces overview', path: '/', pills: { workspace: ALL_WORKSPACES } },
  { name: 'help', path: '/help', pills: { workspace: ALL_WORKSPACES } },
  { name: 'settings', path: '/settings', pills: { workspace: ALL_WORKSPACES } },
];

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
/** The en catalog value at `key`; a missing key fails the test with its name rather than crashing the file. */
const pillCatalog = (where: string, key: string): string => {
  const value = lookup(catalogs.en, key);
  expect(value, `${where}: the en catalog holds ${key}`).toBeDefined();
  return value ?? '';
};
/** A whole-text, case-insensitive pattern for a catalog text. */
const exactly = (text: string): RegExp => new RegExp(`^\\s*${escapeRegExp(text).replace(/\s+/gu, '\\s+')}\\s*$`, 'iu');
const normalized = (text: string | null): string => (text ?? '').replace(/\s+/gu, ' ').trim();

async function checkPills(page: Page, entry: PillPage, width: number): Promise<void> {
  await page.goto(entry.path);
  const wide = width >= 1120;
  for (const name of ['workspace', 'page', 'spec', 'area'] as const) {
    const where = `${entry.name} (${entry.path}), the ${name} pill`;
    // spec 024: one-row header on every width (principal 2026-10-13): below 1120 the area select is the overflow entry
    const inMenu = name === 'area' && !wide;
    const segment = page.locator(inMenu ? 'header [data-menu="more"] [data-control="area"]' : `${PILLS} [data-control="${name}"]`);
    if (inMenu && entry.pills.area) await page.locator('header [data-tool="more"]').click();
    const expected = entry.pills[name];
    if (!expected) {
      await expect(segment, `${where} is absent`).toHaveCount(0);
      continue;
    }
    await expect(segment, `${where} renders once`).toHaveCount(1);
    await expect(segment, `${where} is visible`).toBeVisible();

    const label = segment.locator('[data-pill-label]');
    await expect(label, `${where} carries one label`).toHaveCount(1);
    // ISC-140.2 refined: visible from 1120 px, below it in the accessible name
    await expect(label, `${where}: the label is visible`).toBeVisible({ visible: wide || inMenu });
    if (!wide && !inMenu) {
      const named = new RegExp(escapeRegExp(pillCatalog(where, expected.label)), 'iu');
      await expect(segment, `${where}: the label is in the accessible name`).toHaveAccessibleName(named);
    }
    await expect(label, `${where}: the label is ${expected.label}`).toHaveText(exactly(pillCatalog(where, expected.label)), { useInnerText: false });

    const value = segment.locator('[data-pill-value]');
    await expect(value, `${where} carries one value`).toHaveCount(1);
    await expect(value, `${where}: the value is visible`).toBeVisible();
    const spec = expected.value;
    if ('pattern' in spec) {
      await expect(value, `${where}: the value`).toHaveText(spec.pattern);
    } else if ('text' in spec) {
      await expect(value, `${where}: the value`).toHaveText(exactly(spec.text));
    } else if ('count' in spec) {
      const all = pillCatalog(where, spec.key);
      const pattern = new RegExp(`^\\s*${escapeRegExp(all)}\\s*·\\s*${String(spec.count)}\\s*$`, 'iu');
      await expect(value, `${where}: the value is ${spec.key} · ${String(spec.count)}`).toHaveText(pattern);
    } else {
      await expect(value, `${where}: the value is ${spec.key}`).toHaveText(exactly(pillCatalog(where, spec.key)));
    }

    const text = normalized(await segment.textContent());
    expect(text, `${where}: the segment is not a bare number`).not.toMatch(/^\d+$/u);
    expect(text, `${where}: no catalog key in the segment`).not.toMatch(CATALOG_KEY);
    if (entry.path === '/' || entry.path === '/help' || entry.path === '/settings') {
      expect(text, `${where}: no 0 on an app page`).not.toMatch(/(^|[^\d])0([^\d]|$)/u);
    }
  }
  // Spec 069 (ISC-558): the open spec stays in the nav as its crumb, with its ID.
  const crumb = page.locator(`${PILLS} [data-crumb="spec"]`);
  if (entry.crumb === undefined) {
    await expect(crumb, `${entry.name}: no spec crumb`).toHaveCount(0);
  } else {
    await expect(crumb, `${entry.name}: the spec crumb is visible`).toBeVisible();
    await expect(crumb.locator('[data-crumb-id]'), `${entry.name}: the spec crumb shows ${entry.crumb}`).toHaveText(entry.crumb);
  }
}

test.describe('pills', () => {
  for (const width of [WIDTHS.phone, WIDTHS.tablet, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const entry of PILL_PAGES) {
        test(`pills carry labels: ${entry.name} (${entry.path}) at ${String(width)}`, async ({ page }) => {
          await checkPills(page, entry, width);
        });
      }
    });
  }
});

// T32 · ISC-142: polish of the orientation, at 390 and 1440 against the stub API. `bun run e2e -- breadcrumb -g polish`.
//
// (1) The idea page leads back to the board: a visible link to `/w/harbor/board` outside the header sits before the
//     eyebrow in document order (design.md, across viewports: the `←` in the place of the spec breadcrumb's), with a
//     non-empty accessible name that is no raw catalog key.
// (2) No two visible targets of a view share an accessible name. The check is scoped to the two groups the claim names,
//     so a legitimate repeat elsewhere (identical pagination, one link per row to the same page) cannot make it flaky:
//     the copy buttons of the `ui-command-chip`s on `/` (each names its command) and the `after` / `blocked by` links of
//     the claim cards on `/w/harbor/s/002/claims` (each names its claim; 002 holds two `after ISC-60` edges in the
//     golden). The names are Playwright's computed accessible names, read from each element's ARIA snapshot.
// (3) The h1 of the Features page names only the title: its accessible name is exactly `shell.pages.features`, and
//     neither that name nor the h1's text holds the glossary hint (`terms.feature`).

/** Playwright's computed accessible name of a link or button, from its ARIA snapshot (`- button "Copy command"`). */
async function accessibleName(target: Locator): Promise<string> {
  const snapshot = await target.ariaSnapshot();
  // A name with ": " makes the YAML line single-quoted (`- 'button "Copy … · waits on you: 006"'`).
  const match = /^-\s+'?(?:link|button)\s+("(?:[^"\\]|\\.)*")/u.exec(snapshot.trim());
  return match?.[1] === undefined ? '' : (JSON.parse(match[1]) as string);
}

/** The names that occur more than once in `names`. */
const repeated = (names: readonly string[]): string[] => [...new Set(names.filter((name, i) => names.indexOf(name) !== i))];

test.describe('polish', () => {
  for (const width of [WIDTHS.phone, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`polish: the idea page links back to the board at ${String(width)}`, async ({ page }) => {
        await page.goto(`/w/${WORKSPACE}/ideas/${IDEA}`);
        const h1 = page.locator('h1').first();
        await expect(h1, 'the idea page renders its h1').toBeVisible();
        // The eyebrow is ISC-140's (`-g eyebrow`); until it renders here, the back link must at least precede the h1.
        const eyebrow = (await page.locator('[data-page-eyebrow]').count()) > 0 ? page.locator('[data-page-eyebrow]') : h1;

        // Visible links to the board, outside the header, that precede the eyebrow in document order.
        const back = page.locator(`a[href="/w/${WORKSPACE}/board"]`).filter({ visible: true });
        const before = await back.evaluateAll(
          (links, ref) =>
            links.map((link) => link.closest('header') === null && (link.compareDocumentPosition(ref) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0),
          await eyebrow.elementHandle(),
        );
        const index = before.indexOf(true);
        expect(index, 'a visible link to the board sits before the eyebrow').toBeGreaterThanOrEqual(0);

        const name = await accessibleName(back.nth(index));
        expect(name.trim(), 'the back link has an accessible name').not.toBe('');
        expect(name, 'the back link names no catalog key').not.toMatch(CATALOG_KEY);
      });

      // spec 024: overview without lists (principal 2026-10-13): Next up and its copy chips left `/` for the workspace
      // dashboard, so the probe reads the Next up chips there (one per spec, as on `/` before; a row's reason chip
      // repeats its spec's command by design) and asserts `/` holds copy chips only inside the waiting rows of its tiles'
      // list areas (spec 066, ISC-518: one icon-only chip per waiting row with a command, none on a row in progress).
      test(`polish: every copy chip on the workspace dashboard names its command, the overview has none outside a waiting row, at ${String(width)}`, async ({ page }) => {
        await page.goto('/');
        await expect(page.locator('app-workspace-column').first()).toBeVisible();
        const overviewChips = page.locator('app-overview-page ui-command-chip');
        const waitingRows = page.locator('app-overview-page [data-tile-block="list"] li[data-tile-row][data-kind="waiting"]');
        const tileChips = waitingRows.locator('ui-command-chip[data-icon-only]');
        await expect(overviewChips, 'the overview shows no copy chip outside a waiting row').toHaveCount(await tileChips.count());
        for (const row of await waitingRows.all()) {
          await expect(row.locator('ui-command-chip'), 'at most one copy chip per row').toHaveCount(Math.min(1, await row.locator('ui-command-chip').count()));
        }
        for (const chip of await tileChips.all()) {
          const command = normalized(await chip.locator('code').textContent());
          expect.soft(await accessibleName(chip.getByRole('button')), `the copy chip of ${command} names its command`).toContain(command);
        }
        await page.goto(`/w/${WORKSPACE}`);
        const chips = page.locator('app-next-up-list ui-command-chip').filter({ visible: true });
        await expect(chips.first(), 'the workspace dashboard shows Next up copy chips').toBeVisible();
        const names: string[] = [];
        for (const chip of await chips.all()) {
          const command = normalized(await chip.locator('code').textContent());
          const name = await accessibleName(chip.getByRole('button'));
          expect.soft(name, `the copy chip of ${command} names its command`).toContain(command);
          names.push(name);
        }
        expect(names.length, 'at least two copy chips to compare').toBeGreaterThan(1);
        expect(repeated(names), 'no two copy chips share an accessible name').toEqual([]);
      });

      test(`polish: every after link on the claims tab names its claim at ${String(width)}`, async ({ page }) => {
        await page.goto(`/w/${WORKSPACE}/s/002/claims`);
        const edges = page.locator('[data-claim] a[data-edge]').filter({ visible: true });
        await expect(edges.first(), 'the claims tab shows edge links').toBeVisible();
        const names: string[] = [];
        for (const edge of await edges.all()) {
          const target = (await edge.getAttribute('data-edge')) ?? '';
          const owner = await edge.evaluate((el) => el.closest('[data-claim]')?.getAttribute('data-claim') ?? '');
          const name = await accessibleName(edge);
          expect.soft(name, `the edge of ${owner} names its target ${target}`).toContain(target);
          expect.soft(name, `the edge ${target} names its claim ${owner}`).toContain(owner);
          names.push(name);
        }
        expect(repeated(names), 'no two edge links share an accessible name').toEqual([]);
      });

      test(`polish: the Planning h1 holds no glossary hint at ${String(width)}`, async ({ page }) => {
        await page.goto(`/w/${WORKSPACE}/planning/tree`);
        const title = lookup(catalogs.en, 'shell.pages.planning');
        const hint = lookup(catalogs.en, 'terms.feature');
        expect(title, 'the en catalog holds shell.pages.planning').toBeDefined();
        expect(hint, 'the en catalog holds terms.feature').toBeDefined();

        const h1 = page.getByRole('heading', { level: 1 });
        await expect(h1, 'one h1').toHaveCount(1);
        await expect(h1, 'the h1 is visible').toBeVisible();
        expect.soft(normalized(await h1.textContent()), 'the h1 text holds no glossary hint').not.toContain(hint ?? '');
        await expect.soft(h1, 'the h1 name holds no glossary hint').not.toHaveAccessibleName(new RegExp(escapeRegExp(hint ?? ''), 'u'));
        await expect(h1, 'the h1 names only the title').toHaveAccessibleName(title ?? '');
      });
    });
  }
});

// T38 · ISC-143 (Anti): no location indicator shows a state the address does not carry. `bun run e2e -- breadcrumb -g
// reload`, at 390 and 1440 against the stub API.
//
// The location state of a view is the address (`pathname` + `hash`), the text of every `[data-page-eyebrow]`, every
// entry of `nav[data-breadcrumb]` (its level, text, href and `aria-current`) and every segment of `app-shell-nav` (its
// control, `[data-pill-label]` and `[data-pill-value]`). It is read once the view has settled (two reads in a row
// agree), the page is reloaded, and it is read again: the two must be equal, for every route with an indicator. Help and
// settings are reached in-app from a spec page (the router's popstate, no full load), so a remembered "last workspace"
// would show there: they name neither workspace, before and after the reload. The palette jump from lantern to harbor
// 007 · ISC-126 survives the reload, and the workspace pill names the address's workspace, harbor.
interface LocationState {
  readonly address: string;
  readonly eyebrow: readonly string[];
  readonly crumbs: readonly string[];
  readonly pills: readonly string[];
}

const RELOAD_ROUTES: ReadonlyArray<{ readonly path: string; readonly indicator: 'eyebrow' | 'crumbs' }> = [
  { path: '/', indicator: 'eyebrow' },
  { path: `/w/${WORKSPACE}`, indicator: 'eyebrow' },
  { path: `/w/${WORKSPACE}/board`, indicator: 'eyebrow' },
  { path: `/w/${WORKSPACE}/ideas/${IDEA}`, indicator: 'eyebrow' },
  { path: '/help', indicator: 'eyebrow' },
  { path: '/settings', indicator: 'eyebrow' },
  { path: `/w/${WORKSPACE}/s/002`, indicator: 'crumbs' },
  { path: `/w/${WORKSPACE}/s/002/claims`, indicator: 'crumbs' },
  { path: `/w/${WORKSPACE}/s/002/tasks`, indicator: 'crumbs' },
  { path: `/w/${WORKSPACE}/s/002/plan`, indicator: 'crumbs' },
];
/** harbor 007 · ISC-126, the claim the palette's claims cases find by its number alone (palette.spec.ts). */
const JUMP = { number: '126', entry: `claim:${WORKSPACE}:ISC-126`, url: `/w/${WORKSPACE}/s/007/claims#claim-ISC-126` };
const WORKSPACE_PILL_VALUE = `${PILLS} [data-control="workspace"] [data-pill-value]`;

/** The location state as the DOM shows it now. */
const locationOf = (page: Page): Promise<LocationState> =>
  page.evaluate(() => {
    const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/gu, ' ').trim();
    const all = (selector: string): Element[] => [...document.querySelectorAll(selector)];
    return {
      address: `${location.pathname}${location.hash}`,
      eyebrow: all('[data-page-eyebrow]').map(text),
      crumbs: all('nav[data-breadcrumb] [data-crumb], nav[data-breadcrumb] [data-crumb-more]').map((el) =>
        [el.getAttribute('data-crumb') ?? 'more', text(el), el.getAttribute('href') ?? '', el.getAttribute('aria-current') ?? ''].join(' | '),
      ),
      pills: all('app-shell-nav [data-control]').map((el) =>
        [el.getAttribute('data-control') ?? '', text(el.querySelector('[data-pill-label]')), text(el.querySelector('[data-pill-value]'))].join(' | '),
      ),
    };
  });

/** Waits for the route's indicator and the workspace pill, then for two reads in a row to agree, and returns that read. */
async function settledLocation(page: Page, indicator: 'eyebrow' | 'crumbs', where: string): Promise<LocationState> {
  const shown = indicator === 'eyebrow' ? page.locator('[data-page-eyebrow]').first() : page.locator('nav[data-breadcrumb] [data-crumb="spec"]');
  await expect(shown, `${where}: the ${indicator} renders`).toBeVisible();
  await expect(page.locator(WORKSPACE_PILL_VALUE), `${where}: the workspace pill renders`).toHaveText(/\S/u);
  let previous = '';
  let current: LocationState | undefined;
  await expect
    .poll(
      async () => {
        current = await locationOf(page);
        const key = JSON.stringify(current);
        const same = key === previous;
        previous = key;
        return same;
      },
      { message: `${where}: the location state settles`, intervals: [100, 250, 250, 500] },
    )
    .toBe(true);
  if (!current) throw new Error(`${where}: no location state read`);
  return current;
}

/** Reloads the page and expects the same location state as before. */
async function expectSameAfterReload(page: Page, before: LocationState, indicator: 'eyebrow' | 'crumbs', where: string): Promise<LocationState> {
  await page.reload();
  const after = await settledLocation(page, indicator, `${where}, after the reload`);
  expect(after, `${where}: the location state after the reload equals the one before`).toEqual(before);
  return after;
}

/** No workspace is named in the eyebrow, the breadcrumb or the pills of an app page. */
function expectNoWorkspaceNamed(state: LocationState, where: string): void {
  const shown = [...state.eyebrow, ...state.crumbs, ...state.pills].join(' \n ').toLowerCase();
  for (const name of WORKSPACE_NAMES) expect(shown, `${where}: no workspace named (${name})`).not.toContain(name);
}

/** An in-app navigation through the router's popstate listener: no full load, so in-memory state stays. */
async function navigateInApp(page: Page, path: string): Promise<void> {
  const probe = 'reloadProbe';
  await page.evaluate(
    ([target, key]) => {
      (window as unknown as Record<string, unknown>)[key] = true;
      history.pushState(null, '', target);
      dispatchEvent(new PopStateEvent('popstate', { state: null }));
    },
    [path, probe] as const,
  );
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(path)}$`, 'u'));
  const kept = await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key] === true, probe);
  expect(kept, `${path}: reached in-app, without a full load`).toBe(true);
}

test.describe('reload', () => {
  for (const width of [WIDTHS.phone, WIDTHS.desktop]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      for (const { path, indicator } of RELOAD_ROUTES) {
        test(`reload: ${path} shows the same location after a reload at ${String(width)}`, async ({ page }) => {
          await page.goto(path);
          const before = await settledLocation(page, indicator, path);
          expect(before.eyebrow.length + before.crumbs.length, `${path}: a location indicator is read`).toBeGreaterThan(0);
          expect(before.pills.length, `${path}: the pills are read`).toBeGreaterThan(0);
          await expectSameAfterReload(page, before, indicator, path);
        });
      }

      test(`reload: help and settings after a spec page name no workspace, before and after a reload at ${String(width)}`, async ({ page }) => {
        for (const target of ['/help', '/settings']) {
          await page.goto(`/w/${WORKSPACE}/s/002/claims`);
          const spec = await settledLocation(page, 'crumbs', 'the spec page');
          expect(spec.pills.join(' '), 'the spec page names its workspace').toContain(WORKSPACE);

          await navigateInApp(page, target);
          const where = `${target} after the spec page`;
          const before = await settledLocation(page, 'eyebrow', where);
          expectNoWorkspaceNamed(before, where);
          const after = await expectSameAfterReload(page, before, 'eyebrow', where);
          expectNoWorkspaceNamed(after, `${where}, after the reload`);
        }
      });

      test(`reload: a palette jump from lantern to a harbor claim shows the same location after a reload at ${String(width)}`, async ({ page }) => {
        await page.goto('/w/lantern');
        await expect(page.locator(WORKSPACE_PILL_VALUE), 'lantern is the current workspace').toHaveText(exactly('lantern'));
        await page.keyboard.press('ControlOrMeta+k');
        const palette = page.locator('app-command-palette dialog');
        await expect(palette).toBeVisible();
        await palette.getByRole('combobox').fill(JUMP.number);
        await expect(palette.locator('[role="option"][aria-selected="true"]')).toHaveAttribute('data-entry', JUMP.entry);
        await page.keyboard.press('Enter');
        await expect(palette).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`${escapeRegExp(JUMP.url)}$`, 'u'));

        const where = 'the palette jump';
        const before = await settledLocation(page, 'crumbs', where);
        await expect(page.locator(WORKSPACE_PILL_VALUE), `${where}: the workspace pill names the address's workspace`).toHaveText(exactly(WORKSPACE));
        await expectSameAfterReload(page, before, 'crumbs', where);
        await expect(page.locator(WORKSPACE_PILL_VALUE), `${where}, after the reload: the workspace pill names harbor`).toHaveText(exactly(WORKSPACE));
      });
    });
  }
});
