/**
 * T24 · ISC-134.1: the tech page's five tabs against the stub API, on harbor. `bun run e2e -- tech -g tabs`.
 * Data: `core/fixtures/harbor.tech.golden.json` (the `…/tech` body: pages, specs, fog) and `core/fixtures/harbor.golden.json`
 * (the dashboard rows the Status tab reads: a spec is complete at stage `done`), the subline from `src/i18n/en.json`.
 * Every expected value comes from those files, never a literal.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';

interface DocsSection {
  readonly id: string;
  readonly heading: string;
}
interface DocsFigure {
  readonly kind: string;
  readonly asset?: string;
}
interface DocsPage {
  readonly sections: readonly DocsSection[];
  readonly figures: readonly DocsFigure[];
}
interface TechSpec {
  readonly id: string;
  readonly phase: string;
  readonly approach: unknown;
  readonly fog: readonly string[];
}
interface TechGolden {
  readonly pages: { readonly overview: DocsPage; readonly architecture: DocsPage; readonly risks: DocsPage } | null;
  readonly specs: readonly TechSpec[];
}
interface DashboardGolden {
  readonly specs: ReadonlyArray<{ readonly id: string; readonly stage: string }>;
}

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const TECH = read('../../core/fixtures/harbor.tech.golden.json') as TechGolden;
const DASHBOARD = read('../../core/fixtures/harbor.golden.json') as DashboardGolden;
const EN = read('../src/i18n/en.json') as { tech: { subline: { file: string } } };

const WS = 'harbor';
/** The tab-bar order of the design (`TECH_TABS`); `/w/:ws/tech` opens the first. */
const TABS = ['overview', 'architecture', 'status', 'specs', 'open'] as const;
type Tab = (typeof TABS)[number];

const PAGES = TECH.pages;
if (PAGES === null) throw new Error('tech.spec: the harbor tech golden has no pages');
const SPEC_IDS = TECH.specs.map((spec) => spec.id);
const COMPLETE = new Set(DASHBOARD.specs.filter((row) => row.stage === 'done').map((row) => row.id));
const FOGGY = TECH.specs.filter((spec) => spec.phase !== 'complete' && spec.fog.length > 0);
const IMAGES = PAGES.overview.figures.filter((figure) => figure.kind === 'image' && figure.asset !== undefined);
const MERMAIDS = PAGES.architecture.figures.filter((figure) => figure.kind === 'mermaid');

const tabUrl = (tab: Tab): RegExp => new RegExp(`/w/${WS}/tech/${tab}$`);
const panelOf = (page: Page): Locator => page.locator('[data-tech-panel]');
const tabOf = (page: Page, tab: Tab): Locator => panelOf(page).locator(`[data-tech-tab="${tab}"]`);

/** Waits for the tab's panel, then checks it is the only one shown. */
async function expectOnlyPanel(page: Page, tab: Tab): Promise<void> {
  await expect(tabOf(page, tab)).toBeVisible();
  await expect(panelOf(page).locator('[data-tech-tab]')).toHaveCount(1);
}

/** `scrollWidth` and `clientWidth` of the document and `<main>`. */
async function sideways(page: Page): Promise<Record<'document' | 'main', { scroll: number; client: number }>> {
  return page.evaluate(() => {
    const root = document.scrollingElement ?? document.documentElement;
    const main = document.querySelector('main');
    return {
      document: { scroll: root.scrollWidth, client: root.clientWidth },
      main: { scroll: main?.scrollWidth ?? -1, client: main?.clientWidth ?? -2 },
    };
  });
}

test.describe('tabs', () => {
  test.describe('wide', () => {
    test.use(atWidth(WIDTHS.desktop));

    test('the bare route lands on overview; five tabs in order switch URL and panel; the subline counts the specs', async ({ page }) => {
      await page.goto(`/w/${WS}/tech`);
      await expect(page).toHaveURL(tabUrl('overview'));
      await expect(page.locator('h1#tech')).toBeVisible();
      await expect(page.locator('[data-subline]')).toHaveText(EN.tech.subline.file.replace('{{count}}', String(TECH.specs.length)));

      const bar = page.locator('app-tech-page app-tab-bar[data-placement="main"]');
      const links = bar.locator('a[data-tab]');
      await expect(links).toHaveCount(TABS.length);
      expect(await links.evaluateAll((all) => all.map((a) => a.getAttribute('data-tab')))).toEqual([...TABS]);
      await expect(page.locator('app-tab-bar')).toHaveCount(1);
      await expectOnlyPanel(page, 'overview');
      await expect(bar.locator('a[aria-current="page"]')).toHaveAttribute('data-tab', 'overview');

      for (const tab of [...TABS.slice(1), TABS[0]]) {
        await bar.locator(`a[data-tab="${tab}"]`).click();
        await expect(page).toHaveURL(tabUrl(tab));
        await expect(bar.locator('a[aria-current="page"]')).toHaveCount(1);
        await expect(bar.locator('a[aria-current="page"]')).toHaveAttribute('data-tab', tab);
        await expectOnlyPanel(page, tab);
      }
    });

    test('overview renders the golden headings and loads its image through the asset route; architecture draws the mermaid figure', async ({ page }) => {
      await page.goto(`/w/${WS}/tech/overview`);
      const overview = tabOf(page, 'overview');
      for (const section of PAGES.overview.sections) await expect(overview.locator(`[id="${section.id}"]`)).toHaveText(section.heading);

      const images = overview.locator('figure.image-figure img');
      await expect(images).toHaveCount(IMAGES.length);
      for (const [index, figure] of IMAGES.entries()) {
        const img = images.nth(index);
        await img.scrollIntoViewIfNeeded();
        await expect
          .poll(() =>
            img.evaluate((el) => {
              const src = new URL((el as HTMLImageElement).currentSrc || (el.getAttribute('src') ?? ''), location.href);
              return { path: src.pathname, asset: src.searchParams.get('path'), loaded: (el as HTMLImageElement).naturalWidth > 0 };
            }),
          )
          .toEqual({ path: `/api/workspaces/${WS}/tech/asset`, asset: figure.asset, loaded: true });
      }
      await expect(overview.locator('[data-tech-section]')).toHaveCount(0);

      await page.goto(`/w/${WS}/tech/architecture`);
      const architecture = tabOf(page, 'architecture');
      for (const section of PAGES.architecture.sections) await expect(architecture.locator(`[id="${section.id}"]`)).toHaveText(section.heading);
      await expect(architecture.locator('figure.mermaid-figure')).toHaveCount(MERMAIDS.length);
      for (let index = 0; index < MERMAIDS.length; index++) {
        await expect(architecture.locator('figure.mermaid-figure').nth(index).locator('.mermaid-svg svg').first()).toBeVisible();
      }
    });

    test('status: one row per golden spec, the complete ones after the divider', async ({ page }) => {
      await page.goto(`/w/${WS}/tech/status`);
      const status = tabOf(page, 'status');
      const rows = status.locator('table tr[data-spec]');
      await expect(rows).toHaveCount(SPEC_IDS.length);
      expect((await rows.evaluateAll((all) => all.map((tr) => tr.getAttribute('data-spec') ?? ''))).toSorted()).toEqual(SPEC_IDS.toSorted());
      expect((await status.locator('table tr[data-spec][data-complete]').evaluateAll((all) => all.map((tr) => tr.getAttribute('data-spec') ?? ''))).toSorted()).toEqual(
        [...COMPLETE].toSorted(),
      );

      const order = await status.locator('table tr[data-spec], table tr[data-divider]').evaluateAll((all) =>
        all.map((tr) => (tr.hasAttribute('data-divider') ? '|' : (tr.getAttribute('data-spec') ?? ''))),
      );
      const divider = order.indexOf('|');
      expect(divider, 'the divider row').toBe(COMPLETE.size > 0 ? SPEC_IDS.length - COMPLETE.size : -1);
      if (divider >= 0) {
        expect(order.slice(0, divider).filter((id) => COMPLETE.has(id)), 'complete specs before the divider').toEqual([]);
        expect(order.slice(divider + 1).every((id) => COMPLETE.has(id)), 'only complete specs after the divider').toBe(true);
      }
    });

    test('specs: one card per golden spec; goal and plan links land on the spec and its plan', async ({ page }) => {
      await page.goto(`/w/${WS}/tech/specs`);
      const cards = tabOf(page, 'specs').locator('ui-card[data-tech-spec]');
      await expect(cards).toHaveCount(SPEC_IDS.length);

      for (const spec of TECH.specs) {
        const card = cards.and(page.locator(`[data-tech-spec="${spec.id}"]`));
        await expect(card.locator('a[data-tech-link="goal"]')).toHaveAttribute('href', `/w/${WS}/s/${spec.id}`);
        await expect(card.locator('a[data-tech-link="spec"]')).toHaveAttribute('href', `/w/${WS}/s/${spec.id}`);
        await expect(card.locator('a[data-tech-link="plan"]')).toHaveCount(spec.approach === null ? 0 : 1);
        if (spec.approach !== null) await expect(card.locator('a[data-tech-link="plan"]')).toHaveAttribute('href', `/w/${WS}/s/${spec.id}/plan`);
      }

      for (const spec of TECH.specs) {
        await page.goto(`/w/${WS}/tech/specs`);
        await page.locator(`[data-tech-spec="${spec.id}"] a[data-tech-link="goal"]`).click();
        await expect(page).toHaveURL(new RegExp(`/w/${WS}/s/${spec.id}$`));
        await expect(page.locator('app-spec-head')).toBeVisible();
        if (spec.approach === null) continue;
        await page.goto(`/w/${WS}/tech/specs`);
        await page.locator(`[data-tech-spec="${spec.id}"] a[data-tech-link="plan"]`).click();
        await expect(page).toHaveURL(new RegExp(`/w/${WS}/s/${spec.id}/plan$`));
        await expect(page.locator('app-docs-tab[data-doc="plan"]')).toBeVisible();
      }
    });

    test('open: the risks block, a fog group per open spec with fog, each line landing on its status', async ({ page }) => {
      await page.goto(`/w/${WS}/tech/open`);
      const open = tabOf(page, 'open');
      const risks = open.locator('[data-tech-risks]');
      await expect(risks).toBeVisible();
      for (const section of PAGES.risks.sections) await expect(risks.locator(`[id="${section.id}"]`)).toHaveText(section.heading);

      const groups = open.locator('[data-fog-spec]');
      await expect(groups).toHaveCount(FOGGY.length);
      expect(await groups.evaluateAll((all) => all.map((group) => group.getAttribute('data-fog-spec')))).toEqual(FOGGY.map((spec) => spec.id));
      for (const spec of FOGGY) {
        const links = open.locator(`[data-fog-spec="${spec.id}"] li a`);
        await expect(links).toHaveCount(spec.fog.length);
        for (const [index, line] of spec.fog.entries()) {
          await expect(links.nth(index)).toContainText(line);
          await expect(links.nth(index)).toHaveAttribute('href', `/w/${WS}/s/${spec.id}/status`);
        }
      }

      for (const spec of FOGGY) {
        for (let index = 0; index < spec.fog.length; index++) {
          await page.goto(`/w/${WS}/tech/open`);
          await page.locator(`[data-fog-spec="${spec.id}"] li a`).nth(index).click();
          await expect(page).toHaveURL(new RegExp(`/w/${WS}/s/${spec.id}/status$`));
          await expect(page.locator('app-status-tab')).toBeVisible();
        }
      }
    });
  });

  test.describe('compact', () => {
    test.use(atWidth(WIDTHS.phone));

    test('the tabs sit in the header row, no tab scrolls sideways, Status stacks its rows', async ({ page }) => {
      await page.goto(`/w/${WS}/tech`);
      await expect(page).toHaveURL(tabUrl('overview'));
      const bar = page.locator('header app-tab-bar[data-placement="header"]');
      await expect(bar.locator('a[data-tab]')).toHaveCount(TABS.length);
      await expect(page.locator('app-tab-bar')).toHaveCount(1);
      await expect(page.locator('app-tech-page app-tab-bar')).toHaveCount(0);

      for (const tab of TABS) {
        await bar.locator(`a[data-tab="${tab}"]`).click();
        await expect(page).toHaveURL(tabUrl(tab));
        await expect(bar.locator('a[aria-current="page"]')).toHaveAttribute('data-tab', tab);
        await expectOnlyPanel(page, tab);
        if (tab === 'status') {
          const stacked = tabOf(page, 'status').locator('ul[data-stacked] a.row[data-spec]');
          await expect(stacked).toHaveCount(SPEC_IDS.length);
          await expect(tabOf(page, 'status').locator('table')).toHaveCount(0);
          expect((await stacked.and(page.locator('[data-complete]')).evaluateAll((all) => all.map((a) => a.getAttribute('data-spec') ?? ''))).toSorted()).toEqual(
            [...COMPLETE].toSorted(),
          );
        }
        if (tab === 'specs') await expect(tabOf(page, 'specs').locator('ui-card[data-tech-spec]')).toHaveCount(SPEC_IDS.length);
        if (tab === 'open') await expect(tabOf(page, 'open').locator('[data-fog-spec]')).toHaveCount(FOGGY.length);
        if (tab === 'architecture') await expect(tabOf(page, 'architecture').locator('figure.mermaid-figure[data-rendered] .mermaid-svg svg').first()).toBeVisible();
        const found = await sideways(page);
        expect(found.document.scroll, `${tab}: document scrollWidth`).toBe(found.document.client);
        expect(found.main.scroll, `${tab}: main scrollWidth`).toBe(found.main.client);
      }
    });
  });
});
