/**
 * Spec 064, stage instead of phase (T63 · ISC-504, T64 · ISC-505): `bun run e2e -- stage-status -g "stage filter"` and
 * `-g "no phase word"`.
 *
 * - Stage filter (ISC-504), at 1440 and 390 px: an old address `/w/harbor/specs?phase=building` lands on `?stage=build`
 *   with its other parameters kept, lists exactly harbor's specs in `build` and presses the chip "Build";
 *   `?stage=review` lists exactly the specs in `review`; a reload keeps each list. The expected ids are the stub's
 *   dashboard body (`row.stage`), the answer the page reads, never written down here.
 * - No phase word (ISC-505), in en and de: on `/`, `/w/harbor`, `/w/harbor/specs`, in the open header spec select and
 *   in the open command palette with its spec results, no status chip of a spec reads a phase word (`phases.*` of the
 *   catalogue: scoping, building, climbing, complete). The test reads the chip elements (the list row's
 *   `[data-cell=phase] ui-chip`, the select's and the palette's chips, the stage filter chips, the KPI legend), never
 *   the page's free text. The legend shows below the wide tier only, so it is read at 820 px.
 *
 * Every test runs in its own stub session (`X-Spectant-Stub-Session`), reset before and after, so a stored language or
 * favourite never leaks into another test.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import { workspaceRoutes } from '../../server/src/contracts/spec-routes.contract.ts';
import { atWidth, expect, headerControl, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const WS = 'harbor';
type Language = 'en' | 'de';
type Catalogue = Record<string, unknown>;

/** The fields of a dashboard row (core's `DashboardSpecRow`) this suite reads. */
interface Row {
  readonly id: string;
  readonly slug: string;
  readonly stage: string;
}

const catalogue = (lang: Language): Catalogue =>
  JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8')) as Catalogue;

/** One text of a catalogue by its dotted key. */
function textOf(cat: Catalogue, path: string): string {
  const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], cat);
  if (typeof value !== 'string') throw new Error(`catalogue has no ${path}`);
  return value;
}

const escape = (word: string): string => word.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

/** The phase words of a catalogue (`phases.*` without `idea`, which is a stage word since spec 064), as one regex. */
function phaseWords(lang: Language): RegExp {
  const phases = catalogue(lang)['phases'] as Record<string, string>;
  const words = Object.entries(phases)
    .filter(([key]) => key !== 'idea')
    .map(([, word]) => escape(word));
  return new RegExp(`(^|[^\\p{L}])(${words.join('|')})($|[^\\p{L}])`, 'iu');
}

const sessionOf = (testId: string): string => `stage-status-${testId}`;

/** Harbor's active rows from the dashboard route the page reads, under the context's session. */
async function rowsOf(page: Page): Promise<Row[]> {
  const answer = await page.request.get(`/api/workspaces/${WS}/dashboard`);
  expect(answer.ok()).toBe(true);
  return ((await answer.json()) as { specs: Row[] }).specs;
}

const listIds = (page: Page): Promise<string[]> =>
  page
    .locator('[data-panel="specs"] [data-spec-row]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-spec-row') ?? '').sort());

/** The stage filter chip with this word (its visible label without the count). */
const stageChip = (page: Page, label: string): Locator =>
  page.locator('ui-filter-chips[data-filter="stage"] button.chip').filter({ hasText: new RegExp(`^\\s*${escape(label)}\\s*\\d+\\s*$`, 'u') });

test.beforeEach(async ({ page }, info) => {
  const headers = { [SESSION_HEADER]: sessionOf(info.testId) };
  await page.context().setExtraHTTPHeaders(headers);
  await page.request.post(RESET_PATH, { headers });
});
test.afterEach(async ({ request }, info) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: sessionOf(info.testId) } });
});

for (const width of [WIDTHS.desktop, WIDTHS.phone] as const) {
  test.describe(`stage filter at ${String(width)}`, () => {
    test.use(atWidth(width));

    test(`stage filter: ?phase=building lands on ?stage=build with the build specs, ?stage=review lists the review specs, each kept by a reload (${String(width)})`, async ({
      page,
    }) => {
      const rows = await rowsOf(page);
      const inStage = (stage: string): string[] =>
        rows
          .filter((row) => row.stage === stage)
          .map((row) => row.id)
          .sort();
      const en = catalogue('en');

      for (const { path, stage, kept } of [
        { path: `/w/${WS}/specs?phase=building&sort=id`, stage: 'build', kept: { sort: 'id' } },
        { path: `/w/${WS}/specs?stage=review`, stage: 'review', kept: {} },
      ] as const) {
        const expected = inStage(stage);
        expect(expected.length, `harbor has specs in ${stage}`).toBeGreaterThan(0);
        expect(expected.length, `harbor has specs outside ${stage}`).toBeLessThan(rows.length);
        await page.goto(path);
        for (const pass of ['load', 'reload'] as const) {
          if (pass === 'reload') await page.reload();
          await expect
            .poll(() => {
              const url = new URL(page.url());
              return { stage: url.searchParams.get('stage'), phase: url.searchParams.get('phase'), ...Object.fromEntries(Object.keys(kept).map((key) => [key, url.searchParams.get(key)])) };
            }, `${path} (${pass}): the address`)
            .toEqual({ stage, phase: null, ...kept });
          await expect.poll(() => listIds(page), `${path} (${pass}): exactly the specs in ${stage}`).toEqual(expected);
          await expect(page.locator('[data-panel="specs"] app-idea-row'), `${path} (${pass}): no idea rows`).toHaveCount(0);
          const chip = stageChip(page, textOf(en, `stages.${stage}`));
          await expect(chip, `${path} (${pass}): one chip ${stage}`).toHaveCount(1);
          await expect(chip).toHaveAttribute('aria-pressed', 'true');
          await expect(page.locator('ui-filter-chips[data-filter="stage"] button.chip[aria-pressed="true"]')).toHaveCount(1);
        }
      }
    });
  });
}

/** The texts of every chip under `scope` that read a phase word: empty when the surface speaks stages only. */
async function phaseChips(scope: Locator, words: RegExp): Promise<string[]> {
  return (await scope.allTextContents()).map((text) => text.replace(/\s+/gu, ' ').trim()).filter((text) => words.test(text));
}

test.describe('no phase word', () => {
  test.use(atWidth(WIDTHS.desktop));

  for (const lang of ['en', 'de'] as const) {
    test(`no phase word: start, dashboard, spec list, header select and palette show stages only (${lang})`, async ({ page, request }, info) => {
      const headers = { [SESSION_HEADER]: sessionOf(info.testId) };
      expect((await request.put('/api/settings', { data: { language: lang }, headers })).ok()).toBe(true);
      const rows = await rowsOf(page);
      // Every harbor spec a favourite, so the header select lists each with its status chip.
      for (const row of rows) expect((await request.put(workspaceRoutes.favorite(WS, row.slug), { headers })).ok(), row.slug).toBe(true);
      const words = phaseWords(lang);
      const chips = (page: Page): Locator => page.locator('ui-chip, ui-state-chip, app-kpi-band .legend .entry');

      // The start and the dashboard: no chip there reads a phase word.
      for (const [path, ready] of [
        ['/', 'app-workspace-column'],
        [`/w/${WS}`, '[data-page="workspace"] app-kpi-band'],
      ] as const) {
        await page.goto(path);
        await expect(page.locator(ready).first()).toBeVisible();
        await expect(page.locator('html')).toHaveAttribute('lang', lang);
        expect(await phaseChips(chips(page), words), `${path} (${lang})`).toEqual([]);
      }

      // The spec list: one status chip per row, each a stage word; the filter chips too.
      await page.goto(`/w/${WS}/specs`);
      await expect(page.locator('[data-panel="specs"] [data-spec-row]').first()).toBeVisible();
      const status = page.locator('[data-panel="specs"] app-spec-row [data-cell="phase"] ui-chip');
      await expect(status).toHaveCount(rows.length);
      expect(await phaseChips(status, words), `spec list (${lang})`).toEqual([]);
      // Spec 064 (T69, ISC-510): the idea rows below the specs carry their state as a pill in the same column, read
      // "<stages.idea> · <state>": the stage word, never a phase word.
      const ideaPills = page.locator('[data-panel="specs"] app-idea-row [data-cell="phase"] ui-chip[data-idea-state]');
      await expect.poll(() => ideaPills.count(), `idea pills (${lang})`).toBeGreaterThan(0);
      expect(await phaseChips(ideaPills, words), `idea pills (${lang})`).toEqual([]);
      for (const pill of await ideaPills.all()) {
        const state = (await pill.getAttribute('data-state')) ?? '';
        const line = `${textOf(catalogue(lang), 'stages.idea')} · ${textOf(catalogue(lang), `states.item.${state}`)}`;
        await expect(pill, `idea pill ${state} (${lang})`).toHaveText(new RegExp(`^\\s*${escape(line)}\\s*$`, 'u'));
      }
      for (const row of rows) {
        const chip = page.locator(`[data-panel="specs"] [data-spec-row="${row.id}"]`).locator('xpath=ancestor-or-self::li[1]').locator('[data-cell="phase"] ui-chip');
        await expect(chip, `${row.id} reads its stage`).toHaveText(textOf(catalogue(lang), `stages.${row.stage}`));
      }
      const filters = page.locator('ui-filter-chips[data-filter="stage"] button.chip');
      await expect(filters.first()).toBeVisible();
      expect(await phaseChips(filters, words), `stage filter chips (${lang})`).toEqual([]);
      expect(await phaseChips(chips(page), words), `/w/${WS}/specs (${lang})`).toEqual([]);

      // The header favourites list (spec 069), open: a chip per favourite spec row of harbor, none a phase word.
      await (await headerControl(page, 'favorites')).click();
      const picker = page.locator('nav[data-picker="favorites"]');
      await expect(picker).toBeVisible();
      await expect(picker.locator(`[data-favorites-group="${WS}"] [data-spec] ui-chip`)).toHaveCount(rows.length);
      expect(await phaseChips(picker.locator('ui-chip'), words), `header select (${lang})`).toEqual([]);
      await page.keyboard.press('Escape');
      await expect(picker).toBeHidden();

      // The command palette, open with its spec results: a stage chip per spec, none a phase word.
      await page.keyboard.press('Meta+k');
      const palette = page.locator('app-command-palette dialog');
      await expect(palette).toBeVisible();
      await expect(palette.locator('[role="listbox"]')).not.toHaveAttribute('aria-busy', 'true');
      const stageChips = palette.locator('[data-group="specs"] ui-chip.p-stage');
      await expect.poll(() => stageChips.count(), `palette spec results (${lang})`).toBeGreaterThan(0);
      expect(await phaseChips(palette.locator('ui-chip, .p-status'), words), `palette (${lang})`).toEqual([]);
      await page.keyboard.press('Escape');

      // The KPI legend of the Specs tile, shown below the wide tier: a stage word per part.
      await page.setViewportSize(atWidth(WIDTHS.tablet).viewport);
      await page.goto(`/w/${WS}`);
      const legend = page.locator('app-kpi-band [data-kpi="specs"] .legend .entry');
      await expect.poll(() => legend.count(), `KPI legend (${lang})`).toBeGreaterThan(0);
      expect(await phaseChips(legend, words), `KPI legend (${lang})`).toEqual([]);
      expect(await phaseChips(chips(page), words), `/w/${WS} at 820 (${lang})`).toEqual([]);
    });
  }
});
