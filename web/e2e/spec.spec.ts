/**
 * ISC-76: the area menu and the tab bar of the spec page against the stub API. `bun run e2e -- spec -g "deep link"` is
 * the claim's probe: `/w/harbor/s/002/claims` selects the Data area and the Claims tab from the URL alone, the area
 * menu marks Data `aria-current="page"`, and the tab bar shows only Claims · Tasks · Evidence with the counts the spec
 * model carries. Live is a disabled entry with its reason while its views are not built.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { SpecPageModel } from '../../core/src/files.ts';
import { atWidth, expect, test } from './fixtures';

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
      await expect(trigger).toHaveAccessibleName('Area: Data');
      await expect(trigger).toContainText('Data');

      const tabs = page.locator('app-tab-bar a');
      await expect(tabs).toHaveCount(3);
      expect(await tabs.evaluateAll((links) => links.map((link) => link.getAttribute('data-tab')))).toEqual(['claims', 'tasks', 'evidence']);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'claims');
      await expect(page.locator('app-tab-bar [data-count="claims"]')).toHaveText(`${String(claims.closed)}/${String(claims.total)}`);
      if (tasks) await expect(page.locator('app-tab-bar [data-count="tasks"]')).toHaveText(`${String(tasks.landed)}/${String(tasks.total)}`);
      await expect(page.locator('app-tab-bar [data-count="evidence"]')).toHaveCount(0);

      await trigger.click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();
      await expect(trigger).toHaveAttribute('aria-expanded', 'true');
      await expect(menu.locator('[data-area]')).toHaveCount(6);
      await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
      await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-area', 'data');
      await expect(menu.locator('[role="menu"], [role="menuitem"]')).toHaveCount(0);
    });

    test('area menu shows Live disabled with its reason', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      await page.locator('header [data-control="area"]').click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();

      for (const area of ['live']) {
        const entry = menu.locator(`[data-area="${area}"]`);
        await expect(entry, area).toHaveAttribute('aria-disabled', 'true');
        await expect(entry, area).toContainText(REASON);
        await expect(entry, area).not.toHaveAttribute('href', /.*/);
      }
      await menu.locator('[data-area="live"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/status$/);

      const rows = await menu.locator('[data-area]').evaluateAll((entries) => entries.map((entry) => entry.getBoundingClientRect().height));
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
      await expect(page.locator('header [data-control="area"]')).toHaveAccessibleName('Area: Data');

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
    await expect(band.locator('[data-kpi="waiting"] a')).toHaveAttribute('href', `${DASHBOARD_BASE}/status#waiting`);
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
