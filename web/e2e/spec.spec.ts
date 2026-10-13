/**
 * ISC-76: the area menu and the tab bar of the spec page against the stub API. `bun run e2e -- spec -g "deep link"` is
 * the claim's probe: `/w/harbor/s/002/claims` selects the Data area and the Claims tab from the URL alone, the area
 * menu marks Data `aria-current="page"`, and the tab bar shows only Claims · Tasks · Evidence with the counts the spec
 * model carries. Live is an enabled entry now its Board and Matrix are built.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Locator } from '@playwright/test';
import type { Diagnostic } from '../../core/src/diagnostics.ts';
import type { SpecPageModel } from '../../core/src/files.ts';
import { atWidth, expect, test, headerControl } from './fixtures';

const GOLDEN = fileURLToPath(new URL('../../core/fixtures/harbor.spec.golden.json', import.meta.url));
const HARBOR_002 = (JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, SpecPageModel>)['specs/002-web-console'];
if (!HARBOR_002) throw new Error('harbor.spec.golden.json holds no specs/002-web-console');
const { claims, tasks } = HARBOR_002.areas.data;

const REASON = "Comes with this spec's later tasks";
const TIERS = [
  { width: 390, tier: 'compact' },
  { width: 820, tier: 'medium' },
  { width: 1440, tier: 'wide' },
] as const;

for (const { width, tier } of TIERS) {
  test.describe(`spec at ${String(width)}`, () => {
    test.use(atWidth(width));

    test('deep link selects the Data area and the Claims tab', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims');
      await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);

      const trigger = page.locator('header [data-control="area"]');
      // spec 024: one-row header, overflow menu below 1120 (principal 2026-10-13): the label is read from the attribute, visible or not
      await expect(trigger).toHaveAttribute('aria-label', 'Area: Data');
      await expect(trigger).toContainText('Data');

      const tabs = page.locator('app-tab-bar a');
      await expect(tabs).toHaveCount(3);
      expect(await tabs.evaluateAll((links) => links.map((link) => link.getAttribute('data-tab')))).toEqual(['claims', 'tasks', 'evidence']);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'claims');
      await expect(page.locator('app-tab-bar [data-count="claims"]')).toHaveText(`${String(claims.closed)}/${String(claims.total)}`);
      if (tasks) await expect(page.locator('app-tab-bar [data-count="tasks"]')).toHaveText(`${String(tasks.landed)}/${String(tasks.total)}`);
      await expect(page.locator('app-tab-bar [data-count="evidence"]')).toHaveCount(0);

      // spec 024: one-row header, overflow menu below 1120 (principal 2026-10-13)
      await (await headerControl(page, 'area')).click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(menu.locator('[data-area]')).toHaveCount(6);
      await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-area', 'data');
      await expect(menu.locator('[role="menu"], [role="menuitem"]')).toHaveCount(0);
    });

    test('area menu shows Live enabled, linking to its Board, with no unbuilt reason', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      // spec 024: one-row header, overflow menu below 1120 (principal 2026-10-13)
      await (await headerControl(page, 'area')).click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();

      for (const area of ['live']) {
        const entry = menu.locator(`[data-area="${area}"]`);
        await expect(entry, area).not.toHaveAttribute('aria-disabled', /.*/);
        await expect(entry, area).not.toContainText(REASON);
        await expect(entry, area).toHaveAttribute('href', '/w/harbor/s/002/board');
      }

      // The layout height, not the painted box: the sheet may still be mid-transform when the rows are measured.
      const rows = await menu.locator('[data-area]').evaluateAll((entries) => entries.map((entry) => (entry as HTMLElement).offsetHeight));
      for (const height of rows) expect(height).toBeGreaterThanOrEqual(tier === 'compact' ? 56 : 44);
      if (tier === 'compact') {
        await expect(page.locator('dialog[open]')).toHaveCount(1);
        await expect(page.locator('dialog[open]')).toContainText('Claims');
      } else {
        await expect(page.locator(':popover-open')).toHaveCount(1);
      }
    });

    test('switching the tab bar changes the URL', async ({ page }) => {
      await page.goto('/w/harbor/s/002/claims');
      await page.locator('app-tab-bar a[data-tab="tasks"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/tasks$/);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'tasks');
      // spec 024: one-row header, overflow menu below 1120 (principal 2026-10-13)
      await expect(page.locator('header [data-control="area"]')).toHaveAttribute('aria-label', 'Area: Data');

      await page.locator('app-tab-bar a[data-tab="evidence"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/evidence$/);
      await page.goBack();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/tasks$/);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'tasks');
    });
  });
}

// ── T53: the spec dashboard (ISC-78, ISC-72) ──────────────────────────────────────────────────────────

const SPEC = HARBOR_002;
const DASHBOARD_BASE = '/w/harbor/s/002';

/** Each area tile and the route it opens (the first tab of its area). */
const AREA_TILES = [
  ['status', `${DASHBOARD_BASE}/status`],
  ['live', `${DASHBOARD_BASE}/board`],
  ['data', `${DASHBOARD_BASE}/claims`],
  ['docs', `${DASHBOARD_BASE}/plan`],
  ['notes', `${DASHBOARD_BASE}/notes`],
] as const;

test.describe('dashboard', () => {
  test('dashboard key numbers equal the golden', async ({ page }) => {
    await page.goto(DASHBOARD_BASE);
    const band = page.locator('app-spec-dashboard [data-section="kpi"]');
    const { claims, tasks, rounds, gates, waiting } = SPEC.keyNumbers;
    await expect(band.locator('[data-kpi="claims"] .figure')).toHaveText(`${claims.closed}/${claims.total}`);
    await expect(band.locator('[data-kpi="claims"] .meta')).toContainText(`${claims.open}`);
    await expect(band.locator('[data-kpi="claims"] .meta')).toContainText(`${claims.takeable}`);
    await expect(band.locator('[data-kpi="tasks"] .figure')).toHaveText(`${tasks.landed}/${tasks.total}`);
    await expect(band.locator('[data-kpi="round"] .figure')).toHaveText(`${rounds.count}`);
    await expect(band.locator('[data-kpi="gates"] .figure')).toHaveText(`${gates.ok}/${gates.total}`);
    await expect(band.locator('[data-kpi="waiting"] .figure')).toHaveText(`${waiting}`);
    await expect(band.locator('[data-kpi="waiting"] a')).toHaveAttribute('href', `${DASHBOARD_BASE}#waiting`);
  });

  test('dashboard idea quote and next command equal the golden', async ({ page }) => {
    await page.goto(DASHBOARD_BASE);
    const quote = page.locator('app-spec-dashboard [data-section="idea"] blockquote');
    await expect(quote).toContainText(SPEC.ideaQuote ?? 'the golden has no idea quote');
    const next = page.locator('app-spec-dashboard [data-section="next"]');
    await expect(next.locator('ui-command-chip code')).toHaveText(SPEC.next.command ?? '');
    await expect(next.locator('[data-reason]')).toHaveText(SPEC.next.reasons.slice(0, 3));
  });

  test('dashboard lanes keep the model order with their counts', async ({ page }) => {
    await page.goto(DASHBOARD_BASE);
    const rows = page.locator('app-spec-dashboard [data-lane]');
    await expect(rows).toHaveCount(SPEC.lanes.length);
    const names = await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-lane')));
    expect(names).toEqual(SPEC.lanes.map((lane) => lane.name));
    expect(names.at(-1)).toBe('operator');
    await expect(rows.locator('.lane-count')).toHaveText(SPEC.lanes.map((lane) => `${lane.landed}/${lane.total}`));
    await expect(rows.first()).toHaveAttribute('href', `${DASHBOARD_BASE}/board?lane=${SPEC.lanes[0]?.name ?? ''}`);
  });

  test('dashboard area tiles link to their routes', async ({ page }) => {
    await page.goto(DASHBOARD_BASE);
    await expect(page.locator('app-spec-dashboard [data-area-tile]')).toHaveCount(AREA_TILES.length);
    for (const [area, href] of AREA_TILES) {
      await expect(page.locator(`app-spec-dashboard [data-area-tile="${area}"]`)).toHaveAttribute('href', href);
    }
  });
});

// ── T155: the priority chip on the dashboard row, the spec head and the breadcrumb (ISC-118) ─────────────────────

/**
 * `bun run e2e -- spec -g priority`. The harbor fixture sets `priority:` on three specs (core/fixtures/README.md): 006
 * `P1`, 002 `P2`, 005 `high` (not a level: it reads as P3 with a `frontmatter-priority` warning); 004 has no key and
 * reads as P3 without one. Each chip shows its level's text in full, never cut, at 390 px as at 1440 px.
 */
const PRIORITY_CASES = [
  { id: '006', level: 'P1', why: 'priority: P1' },
  { id: '002', level: 'P2', why: 'priority: P2' },
  { id: '004', level: 'P3', why: 'no priority key' },
  { id: '005', level: 'P3', why: 'priority: high, the invalid value' },
] as const;

/** Where the chip sits: the dashboard row (T136), the spec head's chips and the breadcrumb (T134). */
const ROW_PRIORITY = (id: string): string => `[data-spec-row="${id}"] ui-priority`;
const HEAD_PRIORITY = 'app-spec-head ui-priority[data-head-chip="priority"]';
const CRUMB_PRIORITY = 'app-spec-head ui-priority[data-crumb-priority]';

/** The chip's box against its own content and against every ancestor that clips: a cut chip fails either check. */
const chipFit = (chip: Locator) =>
  chip.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const clippedBy: string[] = [];
    for (let parent = el.parentElement; parent; parent = parent.parentElement) {
      if (!/^(hidden|clip)$/u.test(getComputedStyle(parent).overflowX)) continue;
      const outer = parent.getBoundingClientRect();
      if (box.left < outer.left - 0.5 || box.right > outer.right + 0.5) clippedBy.push(parent.tagName.toLowerCase());
    }
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, clippedBy };
  });

async function expectPriorityChip(host: Locator, level: string, where: string): Promise<void> {
  await expect(host, where).toHaveCount(1);
  await expect(host, where).toHaveAttribute('data-level', level);
  const chip = host.locator('.chip');
  await expect(chip, where).toBeVisible();
  await expect(chip, where).toHaveAccessibleName(`priority ${level}`);
  await expect(chip.locator('span[aria-hidden="true"]'), where).toHaveText(level, { useInnerText: true });
  const fit = await chipFit(chip);
  expect(fit.scrollWidth, `${where}: scrollWidth ${String(fit.scrollWidth)} ≤ clientWidth ${String(fit.clientWidth)}`).toBeLessThanOrEqual(fit.clientWidth);
  expect(fit.clippedBy, `${where}: no clipping ancestor cuts the chip`).toEqual([]);
}

for (const width of [390, 1440] as const) {
  test.describe(`priority at ${String(width)}`, () => {
    test.use(atWidth(width));

    test('priority: the dashboard rows show P1, P2 and P3 in full', async ({ page }) => {
      await page.goto('/w/harbor');
      for (const { id, level, why } of PRIORITY_CASES) {
        await expectPriorityChip(page.locator(ROW_PRIORITY(id)), level, `row ${id} (${why})`);
      }
    });

    for (const { id, level, why } of PRIORITY_CASES) {
      test(`priority: the spec head and the breadcrumb of ${id} show ${level} (${why})`, async ({ page }) => {
        await page.goto(`/w/harbor/s/${id}`);
        await expectPriorityChip(page.locator(HEAD_PRIORITY), level, `head ${id}`);
        // spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
        await expect(page.locator(CRUMB_PRIORITY), `breadcrumb ${id}`).toHaveCount(0);
        await expect(page.locator('app-spec-head ui-priority'), `once in the head ${id}`).toHaveCount(1);
      });
    }
  });
}

test.describe('priority warning', () => {
  /**
   * The `frontmatter-priority` warning travels in the dashboard model's `diagnostics`, which no page renders yet: the
   * warnings panel lists the rows' `warnings`, and the spec page carries none of the tree's diagnostics. So the warning
   * half is checked on the model the dashboard page loads: exactly one, on 005's `spec.md`, none for a missing key.
   */
  test('priority: the invalid value carries one frontmatter-priority warning, a missing key none', async ({ page }) => {
    const answer = await page.request.get('/api/workspaces/harbor/dashboard');
    expect(answer.status()).toBe(200);
    // `DashboardModel.diagnostics`, typed here: `core/src/dashboard.ts` pulls in modules that fail this tsconfig.
    const model = (await answer.json()) as { readonly diagnostics: ReadonlyArray<{ readonly file: string; readonly diagnostic: Diagnostic }> };
    const warnings = model.diagnostics.filter(({ diagnostic }) => diagnostic.code === 'frontmatter-priority');
    expect(warnings.map(({ file, diagnostic }) => [file, diagnostic.severity])).toEqual([['specs/005-config-format-choice/spec.md', 'warning']]);

    await page.goto('/w/harbor');
    await expectPriorityChip(page.locator(ROW_PRIORITY('005')), 'P3', 'row 005 beside its warning');
  });
});
