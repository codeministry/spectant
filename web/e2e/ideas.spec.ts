/**
 * T152 · ISC-124.2: the backlog's stories as ideas on every surface that shows them, against the harbor goldens served
 * by the stub API (`core/fixtures/harbor.planning.golden.json`, `harbor.golden.json`). `bun run e2e -- ideas`.
 *
 * - The Features page shows each story on its feature block (F2, F7), the Milestones page on its milestone (Harbor 1.0;
 *   the other story names a milestone the master does not hold), the dashboard in the "Ideas · n" disclosure, collapsed
 *   until opened, and the palette in its Ideas group.
 * - The idea page `/w/harbor/ideas/console-audit-log` renders the chips, the heading and the body read-only: the page
 *   sends only GET or HEAD to the story route and holds no form, input, textarea, select or button. An unknown slug is
 *   the not-found page (ISC-71).
 *
 * Every expected value derives from the goldens. Each test runs in its own stub session, so a board write of another
 * file's worker (an allocation removes a story) never reaches these trees.
 */
import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';

import type { PlanningModel } from '../../core/src/planning';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const planning = read('../../core/fixtures/harbor.planning.golden.json') as PlanningModel;
const dashboard = read('../../core/fixtures/harbor.golden.json') as {
  ideas: { count: number; list: ReadonlyArray<{ slug: string; title: string; feature: string | null; milestone: string | null }> };
};
type Catalogue = {
  stages: { idea: string };
  types: Record<string, string>;
  ideas: { source: string };
  palette: { groups: { ideas: string } };
  planning: { ideas: { label: string } };
  specs: { ideas: { title: string } };
};
const en = read('../src/i18n/en.json') as Catalogue;

const template = (text: string, values: Record<string, string | number>): string =>
  text.replace(/\{\{\s*(\w+)\s*\}\}/gu, (_, key: string) => String(values[key]));

const ideas = planning.ideas;
const STORY = ideas.find((idea) => idea.slug === 'console-audit-log');
const withIdeas = planning.features.filter((feature) => feature.ideas.length > 0);
const milestonesWithIdeas = planning.milestones.filter((milestone) => milestone.ideas.length > 0);
if (ideas.length !== 2 || !STORY || withIdeas.length === 0 || milestonesWithIdeas.length === 0 || dashboard.ideas.count !== ideas.length) {
  throw new Error('the harbor goldens no longer hold two stories, console-audit-log, a feature and a milestone with an idea');
}

test.use(atWidth(WIDTHS.desktop));

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `ideas-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

/** The slug and visible text of every `ui-idea-chip` under `scope`, in document order. */
const chipsIn = async (page: Page, scope: string): Promise<Array<{ href: string | null; text: string; title: string | null }>> =>
  page.locator(`${scope} ui-idea-chip a`).evaluateAll((els) =>
    els.map((el) => ({ href: el.getAttribute('href'), text: el.textContent.trim(), title: el.getAttribute('title') })),
  );

const chipOf = (slug: string, title: string) => ({ href: `/w/harbor/ideas/${slug}`, text: title, title: slug });

test.describe('ideas on the planning pages', () => {
  test('the Features page shows each story on its feature block, F2 and F7', async ({ page }) => {
    await page.goto('/w/harbor/features');
    await expect(page.locator('ol.rows > li').first()).toBeVisible();
    expect(withIdeas.map((f) => f.id)).toEqual(['F2', 'F7']);
    for (const feature of planning.features) {
      const row = page.locator(`ol.rows > li:has(article[id="${feature.id}"])`);
      const block = row.locator('[data-ideas]');
      if (feature.ideas.length === 0) {
        await expect(block).toHaveCount(0);
        continue;
      }
      await expect(block).toHaveAttribute('data-ideas', String(feature.ideas.length));
      await expect(block.locator('[data-ideas-label]')).toHaveText(template(en.planning.ideas.label, { count: feature.ideas.length }));
      expect(await chipsIn(page, `ol.rows > li:has(article[id="${feature.id}"]) [data-ideas]`)).toEqual(
        feature.ideas.map((idea) => chipOf(idea.slug, idea.title)),
      );
    }
    await expect(page.locator('ol.rows ui-idea-chip')).toHaveCount(ideas.length);
  });

  test('the Milestones page shows the story of Harbor 1.0 and no other', async ({ page }) => {
    await page.goto('/w/harbor/milestones');
    await expect(page.locator('h1#milestones')).toBeVisible();
    expect(milestonesWithIdeas.map((m) => m.name)).toEqual(['Harbor 1.0']);
    const expected = milestonesWithIdeas.flatMap((m) => m.ideas.map((idea) => chipOf(idea.slug, idea.title)));
    await expect(page.locator('[data-ideas]')).toHaveCount(milestonesWithIdeas.length);
    const block = page.locator('[data-ideas]');
    await expect(block).toHaveAttribute('data-ideas', String(expected.length));
    await expect(block.locator('[data-ideas-label]')).toHaveText(template(en.planning.ideas.label, { count: expected.length }));
    expect(await chipsIn(page, '[data-ideas]')).toEqual(expected);
    await expect(page.locator('ui-idea-chip')).toHaveCount(expected.length);
  });
});

test.describe('ideas on the dashboard', () => {
  test('the disclosure "Ideas · 2" is collapsed, then lists both stories when opened', async ({ page }) => {
    await page.goto('/w/harbor');
    const panel = page.locator('app-ideas-panel');
    await expect(panel).toHaveAttribute('data-ideas', String(dashboard.ideas.count));
    await expect(panel.locator('[data-ideas-title]')).toHaveText(template(en.specs.ideas.title, { count: dashboard.ideas.count }));

    const fold = panel.locator('ui-disclosure');
    const summary = fold.locator('button.summary');
    await expect(summary).toHaveAttribute('aria-expanded', 'false');
    await expect(fold).not.toHaveAttribute('data-open', /.*/u);
    await expect(fold.locator('.region')).toHaveAttribute('inert', '');
    await expect(panel.locator('ui-idea-chip').first()).toBeHidden();

    await summary.click();
    await expect(summary).toHaveAttribute('aria-expanded', 'true');
    await expect(fold).toHaveAttribute('data-open', '');
    await expect(fold.locator('.region')).not.toHaveAttribute('inert', /.*/u);
    const rows = panel.locator('li[data-idea]');
    await expect(rows).toHaveCount(dashboard.ideas.count);
    for (const [index, idea] of dashboard.ideas.list.entries()) {
      const row = rows.nth(index);
      await expect(row).toHaveAttribute('data-idea', idea.slug);
      await expect(row.locator('ui-idea-chip a')).toBeVisible();
      await expect(row.locator('ui-idea-chip a')).toHaveAttribute('href', `/w/harbor/ideas/${idea.slug}`);
      await expect(row.locator('ui-idea-chip a')).toHaveText(idea.title);
      await expect(row.locator('[data-idea-where]')).toHaveText([idea.feature, idea.milestone].filter(Boolean).join(' · '));
    }
  });
});

test.describe('ideas in the palette', () => {
  test('the group Ideas lists both stories; Enter opens the idea page', async ({ page }) => {
    await page.goto('/w/harbor');
    await expect(page.locator('header [data-control="palette"]')).toBeVisible();
    await page.keyboard.press('Meta+k');
    const palette = page.locator('app-command-palette dialog');
    await expect(palette).toBeVisible();
    const group = palette.locator('[data-group="ideas"]');
    await expect(group.locator('[role="option"]')).toHaveCount(ideas.length);
    expect(await group.locator('[role="option"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-entry')))).toEqual(
      ideas.map((idea) => `idea/harbor/${idea.slug}`),
    );
    await expect(palette.locator(`[id="${(await group.getAttribute('aria-labelledby')) ?? 'missing'}"]`)).toHaveText(en.palette.groups.ideas);
    for (const idea of ideas) {
      const option = group.locator(`[role="option"][data-entry="idea/harbor/${idea.slug}"]`);
      await expect(option).toContainText(idea.slug);
      // The label is clamped with an ellipsis; the accessible name carries the whole title and the feature.
      await expect(option).toHaveAttribute('aria-label', [idea.title, idea.feature].filter(Boolean).join(', '));
    }

    await palette.getByRole('combobox').fill(STORY.slug);
    await expect(group.locator('[role="option"]')).toHaveCount(1);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/w\/harbor\/ideas\/console-audit-log$/u);
    await expect(page.locator('h1#idea')).toHaveText(STORY.title);
  });
});

test.describe('the idea page', () => {
  test('renders the chips, the heading and the body, reads only, offers no control', async ({ page }) => {
    const storyRequests: Array<{ method: string; path: string }> = [];
    page.on('request', (req) => {
      const path = new URL(req.url()).pathname;
      if (path.startsWith('/api/workspaces/harbor/ideas/')) storyRequests.push({ method: req.method(), path });
    });

    await page.goto(`/w/harbor/ideas/${STORY.slug}`);
    const host = page.locator('app-idea-page');
    await expect(host.locator('h1#idea')).toHaveText(STORY.title);

    const chips = host.locator('[data-idea-chips]');
    await expect(chips.locator('[data-idea-chip="stage"]')).toContainText(en.stages.idea);
    await expect(chips.locator('[data-idea-chip="type"]')).toContainText(en.types[STORY.type ?? ''] ?? 'missing');
    await expect(chips.locator('[data-idea-chip="feature"]')).toContainText(STORY.feature ?? 'missing');
    await expect(chips.locator('[data-idea-chip="milestone"]')).toContainText(STORY.milestone ?? 'missing');
    await expect(chips.locator('[data-idea-chip="priority"]')).toContainText(STORY.priority);

    const body = (await (await page.request.get(`/api/workspaces/harbor/ideas/${STORY.slug}`)).json()) as { hash: string };
    await expect(host.locator('[data-idea-source]')).toHaveText(template(en.ideas.source, { path: STORY.path, hash: body.hash.slice(0, 8) }));

    const prose = host.locator('ui-doc-prose');
    await expect(prose.getByRole('heading', { name: 'Problem' })).toBeVisible();
    await expect(prose).toContainText('A setting changed in the console leaves no trace');
    await expect(prose.locator('li', { hasText: 'An audit page in the console, newest first' })).toHaveCount(1);

    await expect(host.locator('form, input, textarea, select, button, [contenteditable]:not([contenteditable="false"])')).toHaveCount(0);
    await expect(host.getByRole('button')).toHaveCount(0);
    await expect(host.getByRole('textbox')).toHaveCount(0);

    expect(storyRequests.length, 'the page loads its story').toBeGreaterThan(0);
    expect(storyRequests.filter((r) => r.method !== 'GET' && r.method !== 'HEAD')).toEqual([]);
    expect(new Set(storyRequests.map((r) => r.path))).toEqual(new Set([`/api/workspaces/harbor/ideas/${STORY.slug}`]));
  });

  test('an unknown slug shows not-found', async ({ page }) => {
    await page.goto('/w/harbor/ideas/no-such-story');
    await expect(page.locator('app-not-found')).toBeVisible();
    await expect(page.locator('app-idea-page h1#idea')).toHaveCount(0);
    await expect(page.locator('app-idea-page [data-idea-chips]')).toHaveCount(0);
  });
});
