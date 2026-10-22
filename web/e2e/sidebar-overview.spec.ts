/**
 * Spec 067 · T16 · ISC-528 (`bun run e2e -- sidebar-overview`): the detail sidebar's overview of every object type.
 * A spec chosen in the Specs list or on the workspace board shows its stage, priority and type, goal, next step with its
 * reason, claims and tasks, warnings, feature, milestone, the agent holding a claim and its last change, as far as the
 * spec carries them; a story its state, fields and excerpt; a feature, milestone and claim their planning facts. A
 * value the object lacks has no row and no row stays empty.
 *
 * Against the stub API: the spec values come from harbor's dashboard body as the stub serves it (core's output), the
 * other objects' from the planning golden's `facts`. `X-Spectant-Stub-Locks: working` puts a held claim on 002.
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

function entry(ref: RelationRef): Relation {
  const found: Relation | undefined = INDEX[ref];
  if (!found) throw new Error(`the harbor planning golden lost ${ref}`);
  return found;
}

/** The fields of a served dashboard row this suite compares. */
interface Row {
  readonly id: string;
  readonly type: string | null;
  readonly priority: string;
  readonly goal: string;
  readonly nextCommand: string | null;
  readonly nextReason: string;
  readonly feature: string | null;
  readonly featureName: string | null;
  readonly milestone: string | null;
  readonly progress: { readonly closed: number; readonly total: number };
  readonly tasks: { readonly landed: number; readonly total: number } | null;
  readonly taken: ReadonlyArray<{ readonly session: string }>;
  readonly warnings: readonly unknown[];
  readonly updated: string | null;
  readonly lastRound: string | null;
}

const WORKING = { 'X-Spectant-Stub-Locks': 'working' };

async function rowOf(page: Page, id: string): Promise<Row> {
  const response = await page.request.get('/api/workspaces/harbor/dashboard', { headers: WORKING });
  const body = (await response.json()) as { specs: Row[] };
  const row = body.specs.find((r) => r.id === id);
  if (!row) throw new Error(`the harbor dashboard lost spec ${id}`);
  return row;
}

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const refSel = (ref: RelationRef): string => `[data-ref="${ref}"]`;
const factNames = (sb: Locator): Promise<string[]> => sb.locator('[data-fact]').evaluateAll((els) => els.map((el) => el.getAttribute('data-fact') ?? ''));

/** No row of the overview is empty: every key has its value, every value shows text or an element. */
async function expectNoEmptyRow(sb: Locator): Promise<void> {
  const empty = await sb.locator('dt, dd, [data-part="goal"], [data-part="reason"], [data-part="excerpt"]').evaluateAll((els) =>
    els.filter((el) => el.textContent.trim() === '' && el.children.length === 0).map((el) => el.outerHTML),
  );
  expect(empty).toEqual([]);
  const dts = await sb.locator('dt').count();
  expect(await sb.locator('dd').count()).toBe(dts);
}

/** The sidebar shows every field the dashboard row carries for spec `row.id`, and nothing for a field it lacks. */
async function expectSpecOverview(page: Page, row: Row): Promise<void> {
  const sb = sidebar(page);
  await expect(sb.locator('[data-part="title"]')).toHaveText(entry(`spec:${row.id}`).title);
  await expect(sb.locator('[data-part="priority"]')).toHaveAttribute('data-level', row.priority);
  await expect(sb.locator('[data-part="stage"]')).toHaveCount(1);
  await expect(sb.locator('[data-part="spec-type"]')).toHaveCount(row.type ? 1 : 0);
  await expect(sb.locator('[data-part="goal"]')).toHaveText(row.goal);
  if (row.nextCommand) {
    await expect(sb.locator('[data-part="next"] ui-command-chip')).toContainText(row.nextCommand);
    await expect(sb.locator('[data-part="reason"]')).toHaveText(row.nextReason);
  } else await expect(sb.locator('[data-part="next"]')).toHaveCount(0);

  const claims = sb.locator('[data-metric="claims"]');
  if (row.progress.total > 0) await expect(claims).toContainText(`${row.progress.closed}/${row.progress.total}`);
  else await expect(claims).toHaveCount(0);
  const tasks = sb.locator('[data-metric="tasks"]');
  if (row.tasks && row.tasks.total > 0) await expect(tasks).toContainText(`${row.tasks.landed}/${row.tasks.total}`);
  else await expect(tasks).toHaveCount(0);
  const warnings = sb.locator('[data-metric="warnings"]');
  if (row.warnings.length > 0) {
    await expect(warnings).toContainText(String(row.warnings.length));
    await expect(warnings).toHaveAttribute('href', `/w/harbor/s/${row.id}/status`);
  } else await expect(warnings).toHaveCount(0);

  const expected = [
    ...(row.feature ? ['feature'] : []),
    ...(row.milestone ? ['milestone'] : []),
    ...(row.taken.length > 0 ? ['agent'] : []),
    ...(row.updated || row.lastRound ? ['changed'] : []),
  ];
  expect(await factNames(sb)).toEqual(expected);
  if (row.feature) await expect(sb.locator('[data-fact="feature"] dd')).toHaveText(row.featureName ? `${row.feature} · ${row.featureName}` : row.feature);
  if (row.milestone) await expect(sb.locator('[data-fact="milestone"] dd')).toHaveText(row.milestone);
  if (row.taken.length > 0) await expect(sb.locator('[data-fact="agent"] ui-actor-chip')).toBeVisible();
  const newest = [row.updated, row.lastRound].filter((v): v is string => v !== null).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  if (newest) await expect(sb.locator('[data-fact="changed"] time')).toHaveAttribute('datetime', newest);
  await expectNoEmptyRow(sb);
}

test.describe('sidebar overview: wide (1440)', () => {
  test.use(atWidth(WIDTHS.desktop));

  test.beforeEach(async ({ page }) => {
    await page.setExtraHTTPHeaders(WORKING);
  });

  test('spec overview: harbor 002 chosen in the Specs list shows every field it carries', async ({ page }) => {
    const row = await rowOf(page, '002');
    expect(row.taken.length).toBeGreaterThan(0);
    await page.goto('/w/harbor/specs');
    await page.locator(`a.row-link${refSel('spec:002')}`).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe('spec:002');
    await expectSpecOverview(page, row);
  });

  test('spec overview: harbor 002 chosen on the workspace board shows the same fields', async ({ page }) => {
    const row = await rowOf(page, '002');
    await page.goto('/w/harbor/board');
    await page.locator(`a.title${refSel('spec:002')}`).click();
    await expect(sidebar(page)).toHaveAttribute('data-presentation', 'floating');
    await expectSpecOverview(page, row);
  });

  test('spec overview: a spec without a priority mark, agent, milestone, tasks or next step shows no empty row', async ({ page }) => {
    const row = await rowOf(page, '008');
    expect([row.priority, row.taken.length, row.milestone, row.tasks, row.nextCommand]).toEqual(['P3', 0, null, null, null]);
    await page.goto('/w/harbor/specs');
    await page.locator(`a.row-link${refSel('spec:008')}`).click();
    await expectSpecOverview(page, row);
    const sb = sidebar(page);
    for (const part of ['[data-fact="agent"]', '[data-fact="milestone"]', '[data-part="next"]', '[data-metric="tasks"]', '[data-metric="warnings"]']) {
      await expect(sb.locator(part)).toHaveCount(0);
    }
  });

  test('idea overview: a story from the Specs list and the board shows its state, fields and excerpt', async ({ page }) => {
    const ref: RelationRef = 'idea:console-audit-log';
    const facts = entry(ref).facts;
    if (!facts || !('excerpt' in facts) || !facts.excerpt) throw new Error('the harbor planning golden lost the story facts');
    const feature = entry('feature:F2');
    const check = async (): Promise<void> => {
      const sb = sidebar(page);
      await expect(sb.locator('app-idea-facts')).toBeVisible();
      await expect(sb.locator('[data-fact="state"] ui-state-chip')).toHaveAttribute('data-state', facts.state);
      await expect(sb.locator('[data-fact="priority"] ui-priority')).toHaveAttribute('data-level', facts.priority);
      expect(await factNames(sb)).toEqual(['state', 'priority', 'type', 'feature']);
      await expect(sb.locator('[data-fact="feature"] dd')).toHaveText(`${feature.id} · ${feature.title}`);
      await expect(sb.locator('[data-part="excerpt"]')).toHaveText(facts.excerpt ?? '');
      await expectNoEmptyRow(sb);
    };
    await page.goto('/w/harbor/specs');
    await page.locator('app-spec-table app-idea-row[data-idea="console-audit-log"] a.link').click();
    await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(ref);
    await check();
    await page.goto('/w/harbor/board');
    await page.locator(`a.title${refSel(ref)}`).click();
    await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(ref);
    await check();
  });

  test('planning overview: a feature from the gantt, a milestone and a claim from the tree show their facts', async ({ page }) => {
    const facts = entry('feature:F2').facts;
    const why = facts && 'why' in facts ? facts.why : undefined;
    if (!why) throw new Error('the harbor planning golden lost F2’s why line');
    await page.goto('/w/harbor/planning/gantt');
    await page.locator(`app-planning-gantt button[data-lane]${refSel('feature:F2')}`).click();
    let sb = sidebar(page);
    await expect(sb.locator('app-planning-facts[data-type="feature"]')).toBeVisible();
    await expect(sb.locator('[data-fact="why"] dd')).toHaveText(why);
    await expect(sb.locator('[data-fact="specs"] li').first()).toBeVisible();
    await expectNoEmptyRow(sb);

    await page.goto('/w/harbor/planning/tree');
    await page.locator(`[role="treeitem"]${refSel('milestone:harbor-1-0')}`).click();
    sb = sidebar(page);
    await expect(sb.locator('app-planning-facts[data-type="milestone"]')).toBeVisible();
    await expect(sb.locator('[data-fact="target"] time')).toHaveAttribute('datetime', /^2026-05-14/u);
    await expect(sb.locator('[data-fact="description"] dd')).toHaveText('First release a teammate can install.');
    await expect(sb.locator('[data-fact="features"] a[data-sel="feature:F2"]')).toBeVisible();
    await expectNoEmptyRow(sb);

    await page.goto('/w/harbor/planning/tree?sel=claim:ISC-74');
    sb = sidebar(page);
    await expect(sb.locator('app-planning-facts[data-type="claim"]')).toBeVisible();
    expect(await factNames(sb)).toEqual(['state', 'probe', 'lock']);
    await expect(sb.locator('[data-fact="state"] ui-state-chip')).toHaveAttribute('data-state', 'open');
    await expect(sb.locator('[data-fact="probe"] pre')).toContainText('settings-page');
    await expect(sb.locator('[data-fact="lock"] ui-actor-chip')).toBeVisible();
    await expectNoEmptyRow(sb);
  });
});
