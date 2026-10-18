/**
 * Spec 021 (density and readability), the anti group (T57 · ISC-255, `bun run e2e -- density -g "density anti"`): no
 * number, counter or statement of the 021 surfaces shows a value the API model does not serve, and loading, folding
 * and setting the density call no host but loopback. Each case runs against the default stub and the dense stub
 * (`DENSE_HEADER: on`) at 1440 px.
 *
 * - Numbers: every number the dashboard (KPI band, spec-list head, "Show all N", filter chips, TL;DR language chip),
 *   the Tasks tab (head line, `all` and per-lane / per-status chips) and the spec head (partial waits text) shows is
 *   compared with the body of the same route the page reads, fetched by the test (`page.request.get`). The test reads
 *   fields; the only arithmetic is the master tile's open count (`total - closed`) and its ring percent
 *   (`floor(closed / total · 100)`), which the model does not carry as fields, and grouping rows by `phase`/`type` for
 *   the filter chips (the model carries no per-phase count).
 * - Loopback: every request and web socket the page opens while it loads the dashboard, opens and closes every 021 fold
 *   (spec list, TL;DR, overlaps, the compact "Details of <id>", library sections) and sets the density on the settings
 *   page goes to 127.0.0.1, localhost or ::1.
 *
 * The byte half of the claim (repository hash before and after) is the server's: `bun run test:readonly -- -t density`.
 * Every test runs in its own stub session (`X-Spectant-Stub-Session`), reset after the test, so a stored density never
 * leaks into another test.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import type { SpecPageModel, TasksTab } from '../../core/src/files.ts';
import { SPEC_API_ROOT, specRoutes } from '../../server/src/spec-routes.contract.ts';
import { atWidth, expect, test } from './fixtures';
import { DENSE_HEADER, EDGES_HEADER, SESSION_HEADER, STUB_DENSE } from './stub-api';

/**
 * The fields of core's `DashboardModel` (`core/src/dashboard.ts`) this test reads, spelled out here because that module
 * does not type-check under the e2e tsconfig; the names are core's.
 */
interface DashboardModel {
  readonly kpis: {
    readonly specs: number;
    readonly stageGroups: Readonly<Record<'scoping' | 'building' | 'complete', number>>;
    readonly master: { readonly closed: number; readonly total: number } | null;
    readonly claims: { readonly closed: number; readonly total: number };
    readonly takeable: number;
    readonly openClaims: number;
    readonly warnings: number;
    readonly specsWithWarnings: number;
    readonly fog: number;
    readonly specsWithFog: number;
    readonly archived: number;
  };
  readonly specs: ReadonlyArray<{ readonly phase: string | null; readonly type: string | null; readonly stageGroup: string; readonly fog: number }>;
  readonly brief: { readonly lang?: string | null } | null;
}

const WS = 'harbor';
/** The spec whose head, tasks tab and overlaps fold the tests read: harbor 002, the golden spec with the overlap. */
const SPEC = '002';
/** The route the dashboard page reads (`dashboardUrl` of the web's `ApiClient`). */
const DASHBOARD_API = `${SPEC_API_ROOT}/${WS}/dashboard`;
const STUBS = [
  { label: 'default', headers: {} as Record<string, string> },
  { label: 'dense', headers: { [DENSE_HEADER]: 'on' } as Record<string, string> },
] as const;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

/** The English catalogue: the chip labels are its texts, so a chip is found by the label of the key it counts. */
const EN = JSON.parse(readFileSync(join(import.meta.dirname, '../src/i18n/en.json'), 'utf8')) as Record<string, unknown>;
/** One text of the English catalogue by its dotted key. */
const text = (path: string): string => {
  const value = path.split('.').reduce<unknown>((node, key) => (node as Record<string, unknown> | undefined)?.[key], EN);
  if (typeof value !== 'string') throw new Error(`en.json has no ${path}`);
  return value;
};
const phaseLabel = (key: string): string => text(`phases.${key}`);
const statusLabel = (key: string): string => text(`tasks.status.${key}`);
const FOG_LABEL = text('specs.filter.fog');
const SPECS_ALL = text('specs.filter.all');
const TASKS_ALL = text('tasks.filters.all');

const sessionOf = (testId: string): string => `density-anti-${testId}`;

/** Every integer in a text, in order. */
const numbers = (text: string | null): number[] => [...(text ?? '').matchAll(/\d+/gu)].map((m) => Number(m[0]));
const numbersOf = async (locator: Locator): Promise<number[]> => numbers(await locator.textContent());

async function getJson<T>(page: Page, url: string, headers: Record<string, string>): Promise<T> {
  const answer = await page.request.get(url, { headers });
  expect(answer.status(), `GET ${url}`).toBe(200);
  return (await answer.json()) as T;
}

/** The chips of one `ui-filter-chips`, as label (the text without the count) → count. */
async function chipsOf(group: Locator): Promise<Map<string, { count: number; name: string | null }>> {
  const out = new Map<string, { count: number; name: string | null }>();
  for (const chip of await group.locator('button.chip').all()) {
    const count = Number((await chip.locator('.count').textContent())?.trim());
    const whole = (await chip.textContent()) ?? '';
    const text = whole.replace(/\d+\s*$/u, '').trim();
    out.set(text, { count, name: await chip.getAttribute('aria-label') });
  }
  return out;
}

/** Counts rows by one field, in no order. */
function countBy<T>(rows: readonly T[], key: (row: T) => string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const row of rows) {
    const k = key(row);
    if (k !== null) out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

const tile = (page: Page, kpi: string): Locator => page.locator(`app-kpi-band .band [data-kpi="${kpi}"]`);
const valueOf = (t: Locator): Locator => t.locator('.figure .value');
const denOf = (t: Locator): Locator => t.locator('.figure .den');
const metaOf = (t: Locator): Locator => t.locator('.meta');

for (const stub of STUBS) {
  test.describe(`density anti on the ${stub.label} stub`, () => {
    test.use(atWidth(1440));

    test.beforeEach(async ({ page }, info) => {
      await page.setExtraHTTPHeaders({ ...stub.headers, [SESSION_HEADER]: sessionOf(info.testId) });
    });
    test.afterEach(async ({ request }, info) => {
      await request.post('/api/__stub/reset', { headers: { [SESSION_HEADER]: sessionOf(info.testId) } });
    });

    test(`density anti: every dashboard number equals the API answer (${stub.label})`, async ({ page }) => {
      const model = await getJson<DashboardModel>(page, DASHBOARD_API, stub.headers);
      const k = model.kpis;
      await page.goto(`/w/${WS}`);
      await expect(tile(page, 'master')).toBeVisible();

      // KPI band: six tiles, none for the archived count.
      await expect(page.locator('app-kpi-band .band ui-kpi-tile')).toHaveCount(6);
      await expect(page.locator('app-kpi-band [data-kpi="archived"]')).toHaveCount(0);

      const master = tile(page, 'master');
      if (k.master === null) {
        await expect(denOf(master)).toHaveCount(0);
      } else {
        expect(await numbersOf(valueOf(master))).toEqual([k.master.closed]);
        expect(await numbersOf(denOf(master))).toEqual([k.master.total]);
        // Derived: the model carries closed and total, not open nor the percent.
        expect(await numbersOf(metaOf(master))).toEqual([k.master.closed, k.master.total - k.master.closed]);
        const percent = k.master.total === 0 ? [] : [Math.floor((k.master.closed / k.master.total) * 100)];
        expect(await numbersOf(master.locator('ui-ring .text'))).toEqual(percent);
        // The percent stands once in the tile (ISC-245.1): the ring alone.
        expect(((await master.textContent()) ?? '').match(/%/gu)?.length ?? 0).toBe(percent.length);
      }

      const claims = tile(page, 'claims');
      expect(await numbersOf(valueOf(claims))).toEqual([k.claims.closed]);
      expect(await numbersOf(denOf(claims))).toEqual([k.claims.total]);

      const specs = tile(page, 'specs');
      expect(await numbersOf(valueOf(specs))).toEqual([k.stageGroups.complete]);
      expect(await numbersOf(denOf(specs))).toEqual([k.specs]);

      const takeable = tile(page, 'takeable');
      expect(await numbersOf(valueOf(takeable))).toEqual([k.takeable]);
      expect(await numbersOf(denOf(takeable))).toEqual([k.openClaims]);

      const warnings = tile(page, 'warnings');
      expect(await numbersOf(valueOf(warnings))).toEqual([k.warnings]);
      expect(await numbersOf(metaOf(warnings))).toEqual([k.specsWithWarnings, k.specs]);

      const fog = tile(page, 'fog');
      expect(await numbersOf(valueOf(fog))).toEqual([k.fog]);
      expect(await numbersOf(metaOf(fog))).toEqual([k.specsWithFog, k.specs]);

      // No statement line carries a number of its own.
      for (const statement of await page.locator('app-kpi-band .band .statement').all()) {
        expect(await numbersOf(statement)).toEqual([]);
      }

      // The model is consistent with itself where the tiles and the list read two fields for one count.
      expect(model.specs).toHaveLength(k.specs);
      const groups = countBy(model.specs, (row) => row.stageGroup);
      for (const group of ['scoping', 'building', 'complete'] as const) expect(groups.get(group) ?? 0).toBe(k.stageGroups[group]);

      // Spec list head: the active and the archived count, "Show all N".
      const table = page.locator('app-spec-table');
      expect(await numbersOf(table.locator('[data-count="active"]'))).toEqual([model.specs.length]);
      expect(await numbersOf(table.locator('[data-count="archived"]'))).toEqual([k.archived]);
      const showAll = table.locator('[data-fold="specs"] button.summary');
      if (model.specs.length > 5) expect(await numbersOf(showAll)).toEqual([model.specs.length]);

      // Filter chips: `all` is every row, each phase / type chip the rows with that field, fog the rows with fog.
      const phases = await chipsOf(table.locator('ui-filter-chips[data-filter="phase"]'));
      const all = phases.get(SPECS_ALL);
      expect(all?.count).toBe(model.specs.length);
      expect(numbers(all?.name ?? null)).toEqual([model.specs.length]);
      const byPhase = countBy(model.specs, (row) => row.phase);
      const fogRows = model.specs.filter((row) => row.fog > 0).length;
      expect(phases.size).toBe(1 + byPhase.size + (fogRows > 0 ? 1 : 0));
      for (const [phase, count] of byPhase) expect(phases.get(phaseLabel(phase))?.count, `phase chip ${phase}`).toBe(count);
      if (fogRows > 0) {
        expect(phases.get(FOG_LABEL)?.count).toBe(fogRows);
        expect(fogRows).toBe(k.specsWithFog);
      }

      const byType = countBy(model.specs, (row) => row.type);
      const typeGroup = table.locator('ui-filter-chips[data-filter="type"]');
      if (byType.size < 2) {
        await expect(typeGroup).toHaveCount(0);
      } else {
        const types = await chipsOf(typeGroup);
        expect(types.size).toBe(1 + byType.size);
        const allTypes = types.get(SPECS_ALL);
        expect(allTypes?.count).toBe(model.specs.length);
        expect(numbers(allTypes?.name ?? null)).toEqual([model.specs.length]);
        for (const [type, count] of byType) expect(types.get(type)?.count, `type chip ${type}`).toBe(count);
      }

      // TL;DR language chip: only when the served `lang:` differs from the interface language (en).
      const chip = page.locator('[data-ui="brief"] [data-brief-lang]');
      const primary = (model.brief?.lang ?? '').split('-')[0] ?? '';
      if (primary === '' || primary.toLowerCase() === 'en') {
        await expect(chip).toHaveCount(0);
      } else {
        await expect(chip.locator('[aria-hidden="true"]')).toHaveText(primary.toUpperCase());
      }
    });

    test(`density anti: the tasks tab and the spec head count what the API serves (${stub.label})`, async ({ page }) => {
      const tasks = await getJson<TasksTab>(page, specRoutes.tasks(WS, SPEC), stub.headers);
      await page.goto(`/w/${WS}/s/${SPEC}/tasks`);
      const head = page.locator('[data-tasks-done]');
      await expect(head).toBeVisible();
      expect(await numbersOf(head)).toEqual([tasks.counts.done, tasks.counts.rows]);

      const statuses = await chipsOf(page.locator('ui-filter-chips[data-filter="status"]'));
      expect(statuses.get(TASKS_ALL)?.count).toBe(tasks.counts.rows);
      expect(numbers(statuses.get(TASKS_ALL)?.name ?? null)).toEqual([tasks.counts.rows]);
      expect(statuses.size).toBe(1 + tasks.counts.byStatus.length);
      for (const entry of tasks.counts.byStatus) expect(statuses.get(statusLabel(entry.name))?.count, `status chip ${entry.name}`).toBe(entry.count);

      const lanes = await chipsOf(page.locator('ui-filter-chips[data-filter="lane"]'));
      expect(lanes.get(TASKS_ALL)?.count).toBe(tasks.counts.rows);
      expect(lanes.size).toBe(1 + tasks.counts.byLane.length);
      for (const entry of tasks.counts.byLane) expect(lanes.get(entry.name)?.count, `lane chip ${entry.name}`).toBe(entry.count);

      // The spec head on the same page: a partial wait names waiting and open (the tab chips) as served; none or a whole wait, no text.
      const spec = await getJson<SpecPageModel>(page, specRoutes.spec(WS, SPEC), stub.headers);
      const meta = page.locator('app-spec-head [data-waits-meta]');
      const wait = spec.head.waits ?? null;
      if (wait === null || wait.full) await expect(meta).toHaveCount(0);
      else expect(await numbersOf(meta)).toEqual([wait.heldTasks, wait.readyTasks]);
    });

    test(`density anti: loading, folding and setting the density call loopback only (${stub.label})`, async ({ page }) => {
      const urls: string[] = [];
      page.context().on('request', (req) => urls.push(req.url()));
      page.on('websocket', (ws) => urls.push(ws.url()));
      const toggleTwice = async (toggle: Locator): Promise<void> => {
        await expect(toggle).toBeVisible();
        const before = await toggle.getAttribute('aria-expanded');
        await toggle.click();
        await expect(toggle).not.toHaveAttribute('aria-expanded', before ?? '');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', before ?? 'false');
      };

      // Dashboard: the spec list and the TL;DR fold.
      await page.goto(`/w/${WS}`);
      await expect(page.locator('app-spec-table [data-spec-row]').first()).toBeVisible();
      await toggleTwice(page.locator('app-spec-table [data-fold="specs"] button.summary'));
      const brief = page.locator('[data-ui="brief"] [data-brief-fold] button.summary');
      if ((await brief.count()) > 0) await toggleTwice(brief);

      // Spec page: the overlaps fold at 1440, the details fold at compact.
      await page.goto(`/w/${WS}/s/${SPEC}`);
      await expect(page.locator('app-spec-head h1')).toContainText(SPEC);
      await toggleTwice(page.locator('app-spec-head [data-head-overlap-fold] button.summary'));
      await page.setViewportSize({ width: 390, height: 900 });
      await toggleTwice(page.locator('app-spec-head [data-head-details] button.summary'));
      await page.setViewportSize({ width: 1440, height: 900 });

      // Library: the long document under the dense stub; the sections of the first document otherwise.
      await page.goto(stub.label === 'dense' ? `/w/${WS}/library#${STUB_DENSE.doc.path}` : `/w/${WS}/library`);
      const sections = page.locator('[data-library-reader] [data-library-section] > .head h2.heading button.summary');
      if (stub.label === 'dense') await expect(sections).toHaveCount(STUB_DENSE.doc.sections);
      for (const toggle of (await sections.all()).slice(0, 3)) await toggleTwice(toggle);

      // Settings: density compact, then back to comfortable.
      await page.goto('/settings');
      const radios = page.locator('ui-segmented[data-setting="density"] [role="radio"]');
      for (const index of [1, 0]) {
        const put = page.waitForRequest((req) => req.method() === 'PUT' && new URL(req.url()).pathname === '/api/settings');
        await radios.nth(index).click();
        await put;
        await expect(radios.nth(index)).toHaveAttribute('aria-checked', 'true');
      }

      expect(urls.length).toBeGreaterThan(0);
      const network = urls.filter((url) => /^(https?|wss?):/u.test(url));
      const offLoopback = network.filter((url) => !LOOPBACK.has(new URL(url).hostname));
      expect(offLoopback, `requests beside loopback (${network.length} in all)`).toEqual([]);
    });
  });
}

/** Under the edges stub harbor 002 waits partly on 006: the head names waiting and open tasks as the spec route serves them (ISC-252.1: the Tasks tab chip units). */
test.describe('density anti on the edges stub', () => {
  test.use(atWidth(1440));

  test('density anti: the spec head waits text names waiting and open tasks as served (edges)', async ({ page }) => {
    const headers = { [EDGES_HEADER]: 'waiting' };
    await page.setExtraHTTPHeaders(headers);
    const spec = await getJson<SpecPageModel>(page, specRoutes.spec(WS, SPEC), headers);
    const wait = spec.head.waits ?? null;
    // The fixture must hold the case, or the comparison proves nothing.
    if (wait === null || wait.full) throw new Error(`harbor ${SPEC} under the edges stub serves no partial wait`);
    await page.goto(`/w/${WS}/s/${SPEC}`);
    const meta = page.locator('app-spec-head [data-waits-meta]');
    await expect(meta).toBeVisible();
    expect(await numbersOf(meta)).toEqual([wait.heldTasks, wait.readyTasks]);
  });
});
