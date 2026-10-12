/**
 * T41 · ISC-105: the breadcrumb of the spec head on every spec route, archived specs included, at 390 and 1440, against
 * the stub API (`core/fixtures/harbor.planning.golden.json`). `bun run e2e -- breadcrumb`.
 *
 * The levels are `milestone · feature › spec › area › claim or task`; the compact tier returns the short form
 * `harbor / ⚑ Harbor 1.0 · F2 › 002 › ISC-51` (the workspace first since T19 · ISC-140.1, no area, the spec as its mono
 * id). "Links resolve" splits in two:
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
      await expect(page.locator(`${NAV} ol > li`)).toHaveCount(compact ? 4 : 5);

      await expect(crumb(page, 'milestone')).toHaveText(M10.name);
      await expect(crumb(page, 'feature')).toHaveText(compact ? F2.id : `${F2.id} ${F2.name}`);
      await expect(crumb(page, 'spec')).toHaveText(compact ? '002' : `002 ${slugOf('002')}`);
      await expect(page.locator(`${NAV} [data-crumb-more]`)).toHaveCount(0); // 002 holds F2 only

      await expect(crumb(page, 'workspace')).toHaveText('harbor'); // every tier since T19 · ISC-140.1
      await expect(item(page, 'milestone')).toHaveAttribute('data-sep', 'scope');
      if (compact) {
        await expect(crumb(page, 'area')).toHaveCount(0);
        await expect(crumb(page, 'spec')).toHaveAttribute('aria-current', 'page'); // the spec is the last crumb
      } else {
        await expect(crumb(page, 'area')).toHaveText(en.shell.areas['dashboard'] ?? '');
        await expect(crumb(page, 'area')).toHaveAttribute('aria-current', 'page');
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
      await expect(page.locator(`${NAV} ol > li`)).toHaveCount(compact ? 4 : 5);
      const names = await page.locator(`${NAV} [data-crumb]`).evaluateAll((els) => els.map((el) => el.getAttribute('data-crumb')));
      expect(names).toEqual(compact ? ['workspace', 'milestone', 'feature', 'spec'] : ['workspace', 'milestone', 'feature', 'spec', 'area']);
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

/** A segment is the route's workspace or the catalog value at a key; `null` asserts only "no workspace named". */
type Segment = { ws: true } | { key: string };
interface EyebrowPage {
  readonly name: string;
  readonly path: string;
  readonly segments: readonly Segment[] | null;
  /** The visible h1, where design.md fixes it. */
  readonly h1?: RegExp;
}

const EYEBROW_PAGES: readonly EyebrowPage[] = [
  { name: 'workspaces', path: '/', segments: null },
  { name: 'dashboard', path: `/w/${WORKSPACE}`, segments: [{ ws: true }, { key: 'shell.pages.specs' }], h1: /^\s*Specs(\s*·\s*\d+)?\s*$/u },
  { name: 'board', path: `/w/${WORKSPACE}/board`, segments: [{ ws: true }, { key: 'shell.pages.board' }] },
  { name: 'idea', path: `/w/${WORKSPACE}/ideas/${IDEA}`, segments: [{ ws: true }, { key: 'shell.pages.board' }, { key: 'ideas.title' }] },
  { name: 'features', path: `/w/${WORKSPACE}/features`, segments: [{ ws: true }, { key: 'shell.pages.features' }] },
  { name: 'milestones', path: `/w/${WORKSPACE}/milestones`, segments: [{ ws: true }, { key: 'shell.pages.milestones' }] },
  { name: 'help', path: '/help', segments: [{ key: 'shell.eyebrow.app' }, { key: 'help.title' }] },
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
  const gap = (head?.y ?? -Infinity) - ((top?.y ?? 0) + (top?.height ?? 0));
  expect(gap, `${entry.name}: the eyebrow sits directly above the h1`).toBeGreaterThanOrEqual(-1);
  expect(gap, `${entry.name}: the eyebrow sits directly above the h1`).toBeLessThanOrEqual(16);

  const text = (await eyebrow.textContent()) ?? '';
  expect(text, `${entry.name}: no catalog key in the eyebrow`).not.toMatch(CATALOG_KEY);
  expect((await h1.textContent()) ?? '', `${entry.name}: no catalog key in the h1`).not.toMatch(CATALOG_KEY);
  const actual = segmentsOf(text);
  const global = entry.segments === null || entry.segments.every((segment) => !('ws' in segment));
  if (global) for (const name of WORKSPACE_NAMES) expect(actual, `${entry.name}: no workspace in the eyebrow`).not.toContain(name);
  if (entry.segments === null) return;

  const expected = entry.segments.map((segment) => {
    if ('ws' in segment) return WORKSPACE;
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
