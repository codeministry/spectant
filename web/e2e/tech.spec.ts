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

/*
 * T25 · ISC-134.2: the tech page is reachable (area menu, palette) and holds without `specs/tech.md`.
 * `bun run e2e -- tech -g reach` and `-g empty`. Data: the harbor dashboard golden's `kpis` (the menu's summary),
 * `core/fixtures/lantern.tech.golden.json` (`pages: null`: specs and fog only) and `src/i18n/en.json`.
 */
interface Kpis {
  readonly kpis: { readonly specs: number; readonly fog: number };
}
interface ReachCopy {
  readonly shell: { readonly pages: { readonly tech: string; readonly summary: { readonly tech: string } } };
  readonly tech: {
    readonly palette: { readonly tab: string };
    readonly tabs: Readonly<Record<Tab, string>>;
    readonly subline: { readonly noFile: string };
    readonly empty: { readonly title: string; readonly body: string };
    readonly open: { readonly noRisks: string; readonly none: string; readonly questions: string };
  };
}
const COPY = EN as unknown as ReachCopy;
const HARBOR_KPIS = (DASHBOARD as unknown as Kpis).kpis;
const LANTERN = read('../../core/fixtures/lantern.tech.golden.json') as TechGolden;
const LANTERN_WS = 'lantern';
const LANTERN_FOGGY = LANTERN.specs.filter((spec) => spec.phase !== 'complete' && spec.fog.length > 0);
/** The command the empty state offers (`DRAFT_COMMAND` of `tech-docs-tab.ts`): named by the claim, in neither file. */
const DRAFT_COMMAND = '/spec-doc';
/** WCAG 2.5.8: the copy button's hit area spans at least this many CSS px on both axes. */
const HIT = 44;

const fill = (template: string, params: Readonly<Record<string, string | number>>): string =>
  Object.entries(params).reduce((text, [key, value]) => text.replaceAll(`{{${key}}}`, String(value)), template);
const lanternUrl = (tab: Tab): RegExp => new RegExp(`/w/${LANTERN_WS}/tech/${tab}$`);

async function openAreaMenu(page: Page): Promise<Locator> {
  await page.locator('header [data-control="area"]').click();
  const menu = page.locator('nav[aria-label="Areas"]');
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Whether the points `HIT / 2 - 1` px off the button's centre (left, right, up, down, two diagonals) still hit the
 * button: its hit area spans at least `HIT` × `HIT`, however small the drawn button is.
 */
async function hitArea(button: Locator): Promise<boolean[]> {
  return button.evaluate((el, reach) => {
    const box = el.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const probes: Array<[number, number]> = [
      [x - reach, y],
      [x + reach, y],
      [x, y - reach],
      [x, y + reach],
      [x - reach, y - reach],
      [x + reach, y + reach],
    ];
    return probes.map(([px, py]) => {
      const hit = document.elementFromPoint(px, py);
      return hit !== null && (hit === el || el.contains(hit));
    });
  }, HIT / 2 - 1);
}

test.describe('reach', () => {
  for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('the area menu lists Tech fifth with the KPI summary; it lands on overview, current in the menu and on the trigger', async ({ page }) => {
        await page.goto(`/w/${WS}`);
        await expect(page.locator('header [data-control="area"]')).toBeVisible();
        let menu = await openAreaMenu(page);
        const entries = menu.locator('[data-page]');
        expect(await entries.evaluateAll((all) => all.map((el) => el.getAttribute('data-page')))).toEqual(['specs', 'board', 'features', 'milestones', 'tech']);
        const tech = menu.locator('[data-page="tech"]');
        await expect(tech).toHaveAttribute('href', `/w/${WS}/tech`);
        await expect(tech.locator('.entry-name')).toHaveText(COPY.shell.pages.tech);
        await expect(tech.locator('.sub')).toHaveText(fill(COPY.shell.pages.summary.tech, { specs: HARBOR_KPIS.specs, fog: HARBOR_KPIS.fog }));

        await tech.click();
        await expect(page).toHaveURL(tabUrl('overview'));
        await expectOnlyPanel(page, 'overview');
        await expect(page.locator('header [data-control="area"]')).toContainText(COPY.shell.pages.tech);
        menu = await openAreaMenu(page);
        await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
        await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-page', 'tech');
      });

      test('the palette finds Tech · Architecture for "arch"; opening it lands on the architecture tab', async ({ page }) => {
        await page.goto(`/w/${WS}`);
        await expect(page.locator('header [data-control="palette"]')).toBeVisible();
        await page.locator('header [data-control="palette"]').click();
        const box = page.locator('app-command-palette').getByRole('combobox');
        await expect(box).toBeVisible();
        await box.fill('arch');
        const option = page.locator(`app-command-palette [role="option"][data-entry="tech/${WS}/architecture"]`);
        await expect(option).toBeVisible();
        await expect(option).toContainText(fill(COPY.tech.palette.tab, { tab: COPY.tech.tabs.architecture }));
        await option.click();
        await expect(page).toHaveURL(tabUrl('architecture'));
        await expectOnlyPanel(page, 'architecture');
      });
    });
  }
});

test.describe('empty', () => {
  if (LANTERN.pages !== null) throw new Error('tech.spec: the lantern tech golden is expected without pages');

  for (const width of [WIDTHS.desktop, WIDTHS.phone]) {
    const compact = width === WIDTHS.phone;
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('without tech.md: the noFile subline, the /spec-doc empty state, the muted risks line, full Status and Specs, no tab disabled', async ({ page }) => {
        await page.goto(`/w/${LANTERN_WS}/tech`);
        await expect(page).toHaveURL(lanternUrl('overview'));
        await expect(page.locator('[data-subline]')).toHaveText(fill(COPY.tech.subline.noFile, { count: LANTERN.specs.length }));

        const bar = page.locator(compact ? 'header app-tab-bar[data-placement="header"]' : 'app-tech-page app-tab-bar[data-placement="main"]');
        await expect(bar.locator('a[data-tab]')).toHaveCount(TABS.length);
        await expect(bar.locator('[aria-disabled], [disabled], [inert]')).toHaveCount(0);

        for (const tab of TABS) {
          await bar.locator(`a[data-tab="${tab}"]`).click();
          await expect(page).toHaveURL(lanternUrl(tab));
          await expect(bar.locator('a[aria-current="page"]')).toHaveAttribute('data-tab', tab);
          const panel = panelOf(page);

          if (tab === 'overview' || tab === 'architecture') {
            const empty = panel.locator('ui-empty-state[data-tech-empty]');
            await expect(empty).toBeVisible();
            await expect(empty.locator('.title')).toHaveText(COPY.tech.empty.title);
            await expect(empty.locator('.body')).toHaveText(COPY.tech.empty.body);
            await expect(panel.locator('ui-doc-prose')).toHaveCount(0);
            const chip = empty.locator('ui-command-chip');
            await expect(chip).toHaveCount(1);
            await expect(chip.locator('code')).toHaveText(DRAFT_COMMAND);
            const copy = chip.getByRole('button');
            await copy.scrollIntoViewIfNeeded();
            await expect(copy).toBeVisible();
            if (compact) expect(await hitArea(copy), `${tab}: the copy button's hit area spans ${String(HIT)} × ${String(HIT)}`).toEqual(Array<boolean>(6).fill(true));
            // Reduced motion holds the copied state until blur, so the check cannot race the highlight fade.
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await copy.click();
            await expect(copy).toHaveAttribute('data-copied', '');
            await page.emulateMedia({ reducedMotion: 'no-preference' });
          }

          if (tab === 'status') {
            const rows = tabOf(page, 'status').locator(compact ? 'ul[data-stacked] a.row[data-spec]' : 'table tr[data-spec]');
            await expect(rows).toHaveCount(LANTERN.specs.length);
            expect((await rows.evaluateAll((all) => all.map((el) => el.getAttribute('data-spec') ?? ''))).toSorted()).toEqual(LANTERN.specs.map((spec) => spec.id).toSorted());
          }

          if (tab === 'specs') {
            await expect(tabOf(page, 'specs').locator('ui-card[data-tech-spec]')).toHaveCount(LANTERN.specs.length);
            for (const spec of LANTERN.specs) {
              await expect(panel.locator(`[data-tech-spec="${spec.id}"] a[data-tech-link="goal"]`)).toHaveAttribute('href', `/w/${LANTERN_WS}/s/${spec.id}`);
            }
          }

          if (tab === 'open') {
            const open = tabOf(page, 'open');
            await expect(open.locator('[data-tech-norisks]')).toHaveText(COPY.tech.open.noRisks);
            await expect(open.locator('[data-tech-risks]')).toHaveCount(0);
            await expect(open.locator('ui-command-chip')).toHaveCount(0);
            const lines = LANTERN_FOGGY.reduce((sum, spec) => sum + spec.fog.length, 0);
            await expect(open.locator('#tech-open-questions')).toHaveText(fill(COPY.tech.open.questions, { lines, specs: LANTERN_FOGGY.length }));
            const groups = open.locator('[data-fog-spec]');
            await expect(groups).toHaveCount(LANTERN_FOGGY.length);
            expect(await groups.evaluateAll((all) => all.map((group) => group.getAttribute('data-fog-spec')))).toEqual(LANTERN_FOGGY.map((spec) => spec.id));
            for (const spec of LANTERN_FOGGY) await expect(open.locator(`[data-fog-spec="${spec.id}"] li a`)).toHaveCount(spec.fog.length);
            await expect(open.locator('[data-tech-fog-none]')).toHaveCount(LANTERN_FOGGY.length === 0 ? 1 : 0);
            if (LANTERN_FOGGY.length === 0) await expect(open.locator('[data-tech-fog-none]')).toHaveText(COPY.tech.open.none);
          }
        }
      });
    });
  }
});
