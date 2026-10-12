/**
 * Spec 008: the Help page against the stub API. `bun run e2e -- help`.
 *
 * - `glossary` (T150, ISC-116): `/help` renders exactly the thirteen rows of core's `GLOSSARY`, each cell equal to the
 *   row's term, common term, German term and definition (the definition's code spans render as `<code>`, so its text
 *   is the row's without backticks); under German settings the Spectant-term column shows the German terms; the page
 *   is reached from the palette entry "Help" and from the link in the `?` shortcut sheet.
 * - `workflow` (T151, ISC-123): one figure per spec type; harbor's feature row (its `specs/workflow.md`) runs review
 *   before tasks, lantern (no workflow file) the default order; the workspace select switches the figures and the
 *   source line between harbor, lantern and the default table; a workflow changed on the stub
 *   (`PUT /api/__stub/workflow`, per stub session) shows on the next read; each figure is one inline `svg` drawn from the
 *   parsed row (T161), its node and gate labels the catalogue words.
 *
 * The expected rows come from core's `GLOSSARY` and the planning goldens, the expected words from the catalogues, so
 * the spec states nothing the sources do not.
 */
import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { GLOSSARY } from '../../core/src/glossary';
import { atWidth, expect, test } from './fixtures';
import { RESET_PATH, SESSION_HEADER, WORKFLOW_PATH } from './stub-api';

/** The stages a workflow row may list. */
type Stage = 'plan' | 'tasks' | 'review' | 'build' | 'code-review' | 'close' | 'done';

/** The slice of a catalogue this spec reads. */
interface Catalogue {
  readonly stages: Readonly<Record<Stage, string>>;
  readonly palette: { readonly actions: { readonly help: string } };
  readonly help: {
    readonly title: string;
    readonly glossary: { readonly columns: { readonly term: string } };
    readonly workflow: {
      readonly figure: string;
      readonly move: string;
      readonly gateReviewed: string;
      readonly gateClosed: string;
      readonly custom: string;
      readonly default: string;
      readonly defaultCaption: string;
      readonly headingDefault: string;
      readonly source: { readonly custom: string; readonly default: string };
    };
  };
}
const catalogue = (lang: 'en' | 'de'): Catalogue =>
  JSON.parse(readFileSync(new URL(`../src/i18n/${lang}.json`, import.meta.url), 'utf8')) as Catalogue;
const en = catalogue('en');
const de = catalogue('de');
interface Row {
  readonly type: string;
  readonly stages: readonly Stage[];
}

/** The workflow rows the stub serves for a fixture tree: its planning golden's `workflow.rows`. */
const rowsOf = (tree: 'harbor' | 'lantern'): readonly Row[] =>
  (
    JSON.parse(readFileSync(new URL(`../../core/fixtures/${tree}.planning.golden.json`, import.meta.url), 'utf8')) as {
      workflow: { rows: Row[] };
    }
  ).workflow.rows;

const featureOf = (rows: readonly Row[]): Row => {
  const row = rows.find((r) => r.type === 'feature');
  if (!row) throw new Error('the golden has no feature row');
  return row;
};

/** The chain of a row as the "Transitions as text" list words it: `Plan → Review`, in the active catalogue. */
const chainOf = (row: Row): string[] =>
  row.stages.slice(1).map((to, i) => en.help.workflow.move.replace('{{from}}', en.stages[row.stages[i] as Stage]).replace('{{to}}', en.stages[to]));

/** A per-test stub session on the context, reset before and after, so a language or workflow never leaks. */
async function ownSession(page: Page, id: string): Promise<Record<string, string>> {
  const headers = { [SESSION_HEADER]: id };
  await page.context().setExtraHTTPHeaders(headers);
  await page.request.post(RESET_PATH, { headers });
  return headers;
}

const helpPage = (page: Page) => page.locator('[data-page="help"]');
const glossaryRows = (page: Page) => page.locator('[data-glossary] tbody tr');

/** Every glossary row's four cells, whitespace collapsed as the reader sees it. */
const cellsOf = (page: Page): Promise<string[][]> =>
  glossaryRows(page).evaluateAll((rows) =>
    rows.map((row) =>
      ['.term', '.common', '.german', '.definition'].map((cell) => (row.querySelector(cell)?.textContent ?? '').replace(/\s+/g, ' ').trim()),
    ),
  );

test.describe('glossary', () => {
  test.use(atWidth(1440));

  test('renders the thirteen GLOSSARY rows cell for cell in English', async ({ page }) => {
    await page.goto('/help');
    await expect(helpPage(page).getByRole('heading', { level: 1 })).toHaveText(en.help.title);
    await expect(glossaryRows(page)).toHaveCount(13);
    expect(GLOSSARY).toHaveLength(13);
    await expect
      .poll(() => cellsOf(page))
      .toEqual(GLOSSARY.map((row) => [row.term, row.common, row.german, row.definition.replace(/`/g, '')]));
    // The code spans of a definition render as code, not as backticks.
    await expect(page.locator('#term-feature .definition code')).toHaveText('### F<n>');
  });

  test('shows the German terms under German settings', async ({ page }, info) => {
    const headers = await ownSession(page, `help-glossary-de-${info.testId}`);
    await page.goto('/help');
    await expect.poll(async () => (await cellsOf(page)).map((cells) => cells[0])).toEqual(GLOSSARY.map((row) => row.term));

    const saved = await page.request.put('/api/settings', { data: { language: 'de' }, headers });
    expect(saved.ok()).toBe(true);
    await page.reload();
    await expect(helpPage(page).getByRole('heading', { level: 1 })).toHaveText(de.help.title);
    await expect(page.locator('[data-glossary] thead th').first()).toHaveText(de.help.glossary.columns.term);
    await expect(glossaryRows(page)).toHaveCount(13);
    await expect.poll(async () => (await cellsOf(page)).map((cells) => [cells[0], cells[2]])).toEqual(GLOSSARY.map((row) => [row.german, row.german]));

    await page.request.post(RESET_PATH, { headers });
  });

  test('is reached from the palette entry Help', async ({ page }) => {
    await page.goto('/w/harbor');
    await expect(page.locator('header [data-control="palette"]')).toBeVisible();
    await page.keyboard.press('Meta+k');
    const entry = page.locator('app-command-palette dialog [role="option"][data-entry="action/help"]');
    await expect(entry).toHaveText(en.palette.actions.help);
    await entry.click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(glossaryRows(page)).toHaveCount(13);
  });

  test('is reached from the link in the ? shortcut sheet', async ({ page }) => {
    await page.goto('/w/harbor');
    await expect(page.locator('header [data-control="palette"]')).toBeVisible();
    await page.keyboard.press('?');
    const link = page.locator('app-shortcut-sheet dialog [data-sheet-help]');
    await expect(link).toHaveText(en.help.title);
    await link.click();
    await expect(page).toHaveURL(/\/help$/);
    await expect(page.locator('app-shortcut-sheet dialog')).toBeHidden();
    await expect(glossaryRows(page)).toHaveCount(13);
  });
});

test.describe('workflow', () => {
  test.use(atWidth(1440));

  const TYPES = rowsOf('harbor').map((row) => row.type);
  const figures = (page: Page) => page.locator('figure[data-workflow-figure]');
  const feature = (page: Page) => page.locator('figure[data-workflow-figure="feature"]');
  const source = (page: Page) => page.locator('[data-workflow-source]');
  /** The stages on the feature figure's main line, in drawing order (the detours below it left out). */
  const stagesOf = (page: Page): Promise<string[]> =>
    feature(page)
      .locator('[data-diagram] g[data-stage]:not([data-detour])')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-stage') ?? ''));

  /** Opens the feature figure's "Transitions as text" and expects its list to start with `chain`. */
  async function expectChain(page: Page, chain: readonly string[]): Promise<void> {
    const details = feature(page).locator('details.as-text');
    if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
    const moves = details.locator('li');
    for (const [i, move] of chain.entries()) await expect(moves.nth(i)).toContainText(move);
  }

  test('draws one captioned figure per spec type, and harbor runs review before tasks', async ({ page }) => {
    expect(TYPES).toHaveLength(7);
    await page.goto('/help?ws=harbor');
    await expect(figures(page)).toHaveCount(7);
    expect(await figures(page).evaluateAll((els) => els.map((el) => el.getAttribute('data-workflow-figure')))).toEqual(TYPES);
    for (const type of TYPES) {
      await expect(page.locator(`figure[data-workflow-figure="${type}"] .figure-name`)).toHaveText(en.help.workflow.figure.replace('{{type}}', type));
    }
    await expect(source(page)).toHaveText(en.help.workflow.source.custom);

    const harbor = featureOf(rowsOf('harbor'));
    expect(harbor.stages.indexOf('review')).toBeLessThan(harbor.stages.indexOf('tasks'));
    await expectChain(page, chainOf(harbor));
    await expect(feature(page).locator('[data-workflow-origin]')).toHaveText(en.help.workflow.custom);

    // Every figure holds its inline svg at once, the harbor row drawn in table order with the catalogue words.
    await expect(page.locator('figure[data-workflow-figure] [data-diagram][data-rendered] svg[role="img"]')).toHaveCount(7);
    await expect.poll(() => stagesOf(page)).toEqual(harbor.stages);
    await expect(feature(page).locator('[data-diagram] g[data-stage]:not([data-detour]) text')).toHaveText(harbor.stages.map((stage) => en.stages[stage]));
    await expect(feature(page).locator('[data-diagram] g[data-gate-note]')).toHaveText([en.help.workflow.gateReviewed, en.help.workflow.gateClosed]);
    await expect(page.locator('[data-workflow-legend]')).toHaveCount(1);
  });

  test('lantern, without a workflow file, runs the default order', async ({ page }) => {
    await page.goto('/help?ws=lantern');
    await expect(figures(page)).toHaveCount(7);
    await expect(source(page)).toHaveText(en.help.workflow.source.default);
    const lantern = featureOf(rowsOf('lantern'));
    expect(lantern.stages.indexOf('tasks')).toBeLessThan(lantern.stages.indexOf('review'));
    await expectChain(page, chainOf(lantern));
    await expect(feature(page).locator('[data-workflow-origin]')).toHaveText(en.help.workflow.default);
  });

  test('the workspace select switches the figures and the source line', async ({ page }) => {
    await page.goto('/help?ws=harbor');
    const select = page.locator('select[data-workflow-workspace]');
    await expect(source(page)).toHaveText(en.help.workflow.source.custom);
    const harborStages = await stagesOf(page);
    expect(harborStages).toEqual(featureOf(rowsOf('harbor')).stages);

    await select.selectOption('lantern');
    await expect(page).toHaveURL(/\/help\?ws=lantern$/);
    await expect(source(page)).toHaveText(en.help.workflow.source.default);
    await expect.poll(() => stagesOf(page)).toEqual(featureOf(rowsOf('lantern')).stages);
    await expectChain(page, chainOf(featureOf(rowsOf('lantern'))));

    await select.selectOption('');
    await expect(page).toHaveURL(/\/help\?ws=$/);
    await expect(source(page)).toHaveText(en.help.workflow.defaultCaption);
    await expect(page.locator('#help-workflows')).toHaveText(en.help.workflow.headingDefault);
    await expect(figures(page)).toHaveCount(7);
    await expectChain(page, chainOf(featureOf(rowsOf('lantern'))));

    await select.selectOption('harbor');
    await expect(page).toHaveURL(/\/help\?ws=harbor$/);
    await expect(source(page)).toHaveText(en.help.workflow.source.custom);
    await expectChain(page, chainOf(featureOf(rowsOf('harbor'))));
  });

  test('a workflow changed on the stub shows on the next read', async ({ page }, info) => {
    const headers = await ownSession(page, `help-workflow-${info.testId}`);
    await page.goto('/help?ws=harbor');
    await expect.poll(() => stagesOf(page)).toContain('tasks');

    // harbor's own workflow.md with the feature row edited: tasks dropped, the fixed gates kept.
    const file = readFileSync(new URL('../../core/fixtures/harbor/specs/workflow.md', import.meta.url), 'utf8');
    const edited = file.replace(/^\| feature \|.*$/m, '| feature | plan · review · build · code-review · close · done | spec |');
    expect(edited).not.toBe(file);
    const put = await page.request.put(`${WORKFLOW_PATH}?ws=harbor`, { data: edited, headers: { ...headers, 'Content-Type': 'text/markdown' } });
    expect(put.status()).toBe(204);

    await page.reload();
    const changed: Row = { type: 'feature', stages: ['plan', 'review', 'build', 'code-review', 'close', 'done'] };
    await expect.poll(() => stagesOf(page)).toEqual(changed.stages);
    await expectChain(page, chainOf(changed));
    const moves = await feature(page).locator('details.as-text li').allTextContents();
    expect(moves.filter((move) => move.includes(en.stages.tasks))).toEqual([]);
    await expect(source(page)).toHaveText(en.help.workflow.source.custom);

    await page.request.post(RESET_PATH, { headers });
  });
});
