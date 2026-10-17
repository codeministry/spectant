/**
 * ISC-76: the area menu and the tab bar of the spec page against the stub API. `bun run e2e -- spec -g "deep link"` is
 * the claim's probe: `/w/harbor/s/002/claims` selects the Data area and the Claims tab from the URL alone, the area
 * menu marks Data `aria-current="page"`, and the tab bar shows only Claims · Tasks · Evidence with the counts the spec
 * model carries. Live is an enabled entry now its Board and Matrix are built.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import type { Diagnostic } from '../../core/src/diagnostics.ts';
import type { LibraryCatalog, LibraryDoc, SpecPageModel } from '../../core/src/files.ts';
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
      // Spec 017 (T45, ISC-158): Data holds exactly Claims and Tasks; the evidence is in the Library area.
      await expect(tabs).toHaveCount(2);
      expect(await tabs.evaluateAll((links) => links.map((link) => link.getAttribute('data-tab')))).toEqual(['claims', 'tasks']);
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

      await page.locator('app-tab-bar a[data-tab="claims"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);
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
  // Spec 017 (T45, ISC-158): the Library tile where the Docs tile stood.
  ['library', `${DASHBOARD_BASE}/library`],
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

    // Spec 006 (ISC-114.2): the eyebrow is heading · "since <instant> via <command>"; the instant is a <time> in the
    // shared `en` form in the test's zone (`03/04/2026, 10:00 AM`), and the capitals come from CSS alone.
    const since = SPEC.next.since ?? '';
    const eyebrow = next.locator('[data-next-eyebrow]');
    const time = eyebrow.locator('time');
    const instant = await page.evaluate(
      (iso) =>
        new Intl.DateTimeFormat('en-US', { day: '2-digit', month: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(
          Date.parse(iso),
        ),
      since,
    );
    await expect(time).toHaveAttribute('datetime', since);
    await expect(time).toHaveText(instant);
    await expect(eyebrow).toHaveText(`Next step · since ${instant} via ${SPEC.next.via ?? ''}`);
    await expect(eyebrow).toHaveCSS('text-transform', 'uppercase');
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
const ROW_PRIORITY = (id: string): string => `li:has([data-spec-row="${id}"]) ui-priority`;
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

// ── T47: the spec area Library (spec 017, ISC-158) ─────────────────────────────────────────────────────────────

/**
 * `bun run e2e -- spec -g library`. The spec page's areas are exactly Dashboard · Status · Live · Data · Library · Notes,
 * Data holds exactly Claims and Tasks, and `/w/:ws/s/:id/library` is the workspace Library's component
 * (`app-library-page`, `data-scope="spec"`) narrowed to the spec: its rows are the spec's catalog documents, its missing
 * entries and its evidence subgroup included, plus the workspace's constitution, nothing else; the one tab Documents
 * counts them; the control counts are the spec's own; no rail, no spec select, no group head, and the reader leaves
 * "Open in spec" out. Every expected value comes from the stub's library route (`STUB_LIBRARY` on harbor) and
 * `src/i18n/en.json`, never a literal count. The three specs cover an evidence subgroup (002), a missing entry (003)
 * and a stale one (004); a test checks the fixture holds each before the others rely on it.
 */
const EN = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as {
  shell: { areas: Record<string, string>; tabs: Record<string, string> };
};
const AREA_ORDER = ['dashboard', 'status', 'live', 'data', 'library', 'notes'] as const;
const LIBRARY_ROUTE = '/api/workspaces/harbor/library';
const LIBRARY_ENTRY = 'app-library-page [data-library-entry]';
const LIBRARY_SPECS = ['002', '003', '004'] as const;

/** The group key of a catalog document: the spec folder's number, `workspace` as it is. */
const libraryKey = (spec: string): string => /^(\d+)-/u.exec(spec)?.[1] ?? spec;

/** The documents the spec area Library of `id` must list: the spec's own, then the workspace's constitution. */
async function specLibraryDocs(request: APIRequestContext, id: string): Promise<{ own: LibraryDoc[]; expected: LibraryDoc[] }> {
  const answer = await request.get(LIBRARY_ROUTE);
  expect(answer.status()).toBe(200);
  const catalog = (await answer.json()) as LibraryCatalog;
  const own = catalog.docs.filter((doc) => doc.spec !== 'workspace' && libraryKey(doc.spec) === id);
  const constitution = catalog.docs.filter((doc) => doc.spec === 'workspace' && doc.type === 'constitution');
  expect(own.length, `harbor ${id} has catalog documents`).toBeGreaterThan(0);
  expect(constitution, 'harbor has exactly one constitution').toHaveLength(1);
  return { own, expected: [...own, ...constitution] };
}

/** Every row the spec area Library draws: path, spec, state, and whether it stands in an evidence subgroup. */
const libraryRows = (page: Page) =>
  page.locator(LIBRARY_ENTRY).evaluateAll((els) =>
    els.map((el) => ({
      path: el.getAttribute('data-library-entry'),
      spec: el.getAttribute('data-spec'),
      state: el.getAttribute('data-state'),
      evidence: el.closest('[data-library-evidence]') !== null,
    })),
  );

const byPathOf = <T extends { path: string | null }>(list: readonly T[]): T[] => [...list].sort((a, b) => (a.path ?? '').localeCompare(b.path ?? ''));

test.describe('spec area library', () => {
  test.describe('at 1440', () => {
    test.use(atWidth(1440));

    test('library: the fixture covers an evidence subgroup, a missing and a stale entry across the probed specs', async ({ request }) => {
      const owns = await Promise.all(LIBRARY_SPECS.map(async (id) => (await specLibraryDocs(request, id)).own));
      const all = owns.flat();
      expect(all.filter((doc) => doc.type === 'evidence').length, 'an evidence subgroup').toBeGreaterThan(0);
      expect(all.filter((doc) => doc.state === 'missing').length, 'a missing entry').toBeGreaterThan(0);
      expect(all.filter((doc) => doc.state === 'stale').length, 'a stale entry').toBeGreaterThan(0);
    });

    for (const id of LIBRARY_SPECS) {
      test(`library: ${id} lists exactly its own documents plus the constitution, counted in the tab and the controls, no rail`, async ({
        page,
        request,
      }) => {
        const { own, expected } = await specLibraryDocs(request, id);
        const evidence = own.filter((doc) => doc.type === 'evidence');

        const answered = page.waitForResponse((r) => new URL(r.url()).pathname === LIBRARY_ROUTE && r.request().method() === 'GET');
        await page.goto(`/w/harbor/s/${id}/library`);
        expect((await answered).status()).toBe(200);

        // The workspace Library's own component, in spec scope, without a rail, a spec select or a group head.
        const library = page.locator('app-library-page');
        await expect(library).toHaveAttribute('data-scope', 'spec');
        await expect(page.locator('app-shell')).toHaveAttribute('data-no-rail', '');
        await expect(page.locator('aside.shell-rail')).toHaveCount(0);
        await expect(library.locator('[data-library-spec]')).toHaveCount(0);
        await expect(library.locator('[data-library-group-head]')).toHaveCount(0);

        // The tab bar: the eyebrow Library and one tab, Documents, current, with the count of the listed documents.
        await expect(page.locator('app-tab-bar [data-area-eyebrow]')).toHaveText(EN.shell.areas['library'] ?? '');
        const tabs = page.locator('app-tab-bar a');
        await expect(tabs).toHaveCount(1);
        await expect(tabs.first()).toHaveAttribute('data-tab', 'library');
        await expect(tabs.first()).toHaveAttribute('aria-current', 'page');
        await expect(tabs.first()).toContainText(EN.shell.tabs['library'] ?? '');
        await expect(page.locator('app-tab-bar [data-count="library"]')).toHaveText(String(expected.length));

        // The control counts are the spec's own missing and stale documents (the constitution is outside them).
        for (const key of ['missing', 'stale'] as const) {
          const count = own.filter((doc) => doc.state === key).length;
          await expect(library.locator(`[data-library-control="${key}"] [data-library-control-count]`), key).toHaveText(String(count));
        }

        // The spec's group first, the workspace-wide one (the constitution) after it.
        const groups = library.locator('[data-library-group]');
        await expect(groups).toHaveCount(2);
        expect(await groups.evaluateAll((els) => els.map((el) => el.getAttribute('data-library-group')))).toEqual([id, 'workspace']);

        // The evidence subgroup, collapsed with its count, then opened block by block until every document stands.
        const subgroup = library.locator(`[data-library-evidence="${id}"]`);
        await expect(subgroup).toHaveCount(evidence.length === 0 ? 0 : 1);
        if (evidence.length > 0) {
          await expect(subgroup.locator('[data-library-evidence-count]')).toHaveText(String(evidence.length));
          const toggle = subgroup.locator('[data-library-evidence-toggle]');
          await expect(toggle).toHaveAttribute('aria-expanded', 'false');
          await expect(page.locator(LIBRARY_ENTRY)).toHaveCount(expected.length - evidence.length);
          await toggle.click();
          await expect(toggle).toHaveAttribute('aria-expanded', 'true');
          const more = subgroup.locator('[data-library-evidence-more]');
          while ((await more.count()) > 0) {
            const before = await subgroup.locator('[data-library-entry]').count();
            await more.click();
            await expect(subgroup.locator('[data-library-entry]')).not.toHaveCount(before);
          }
          await expect(subgroup.locator('[data-library-entry]')).toHaveCount(evidence.length);
        }

        // Exactly the spec's documents plus the constitution, each once, with its spec and state.
        await expect(page.locator(LIBRARY_ENTRY)).toHaveCount(expected.length);
        expect(byPathOf(await libraryRows(page))).toEqual(
          byPathOf(expected.map((doc) => ({ path: doc.path, spec: doc.spec, state: doc.state, evidence: doc.type === 'evidence' }))),
        );
        for (const doc of own.filter((d) => d.state !== 'ok')) {
          await expect(library.locator(`[data-library-entry="${doc.path}"] [data-library-chip="${doc.state}"]`), doc.path).toHaveCount(1);
        }

        // At wide the first document opens in the reader, in the spec context: no "Open in spec".
        const reader = library.locator('[data-library-reader]');
        await expect(reader).toHaveAttribute('data-context', 'spec');
        await expect(reader.locator('[data-library-open]')).toHaveCount(0);
      });
    }

    // Code review 017, #5: the route's spec ref resolves as the server's `resolveSpec` does, so the folder and the bare
    // slug list the same documents and counts as the number.
    test('library: 002 under its folder and its slug lists the same documents as under its number', async ({ page, request }) => {
      const { own, expected } = await specLibraryDocs(request, '002');
      const folder = own[0]?.spec ?? '';
      expect(folder).toMatch(/^002-./u);
      const listed = expected.filter((doc) => doc.type !== 'evidence').map((doc) => doc.path).sort();
      for (const ref of ['002', folder, folder.replace(/^\d+-/u, '')]) {
        await page.goto(`/w/harbor/s/${ref}/library`);
        const library = page.locator('app-library-page');
        await expect(library, ref).toHaveAttribute('data-scope', 'spec');
        await expect(page.locator(LIBRARY_ENTRY), ref).toHaveCount(listed.length);
        expect((await page.locator(LIBRARY_ENTRY).evaluateAll((els) => els.map((el) => el.getAttribute('data-library-entry') ?? ''))).sort(), ref).toEqual(listed);
        for (const key of ['missing', 'stale'] as const) {
          const count = own.filter((doc) => doc.state === key).length;
          await expect(library.locator(`[data-library-control="${key}"] [data-library-control-count]`), `${ref} ${key}`).toHaveText(String(count));
        }
      }
    });

    test('library: a spec document offers "Open in spec" in the workspace Library, not in the spec area', async ({ page, request }) => {
      const { own } = await specLibraryDocs(request, '002');
      const doc = own.find((d) => d.type === 'spec');
      if (doc === undefined) throw new Error('spec.spec: harbor 002 has no spec.md in the catalog');

      await page.goto(`/w/harbor/library#${doc.path}`);
      await expect(page.locator('[data-library-reader]')).toHaveAttribute('data-context', 'workspace');
      await expect(page.locator('[data-library-reader] [data-library-open]')).toHaveCount(1);

      await page.goto(`/w/harbor/s/002/library#${doc.path}`);
      await expect(page.locator('app-library-page')).toHaveAttribute('data-scope', 'spec');
      await expect(page.locator('[data-library-reader]')).toHaveAttribute('data-context', 'spec');
      await expect(page.locator('[data-library-reader]')).toBeVisible();
      await expect(page.locator('[data-library-reader] [data-library-open]')).toHaveCount(0);
    });
  });

  for (const width of [390, 1440] as const) {
    test.describe(`area menu at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('library: the areas are exactly Dashboard · Status · Live · Data · Library · Notes, Library current; Data opens Claims and Tasks', async ({
        page,
      }) => {
        await page.goto('/w/harbor/s/002/library');
        await expect(page.locator('app-library-page')).toHaveAttribute('data-scope', 'spec');
        await expect(page.locator('header [data-control="area"]')).toHaveAttribute('aria-label', `Area: ${EN.shell.areas['library'] ?? ''}`);

        await (await headerControl(page, 'area')).click();
        const menu = page.getByRole('navigation', { name: 'Areas' });
        await expect(menu).toBeVisible();
        const entries = menu.locator('[data-area]');
        await expect(entries).toHaveCount(AREA_ORDER.length);
        expect(await entries.evaluateAll((els) => els.map((el) => el.getAttribute('data-area')))).toEqual([...AREA_ORDER]);
        await expect(entries.locator('.entry-name')).toHaveText(AREA_ORDER.map((area) => EN.shell.areas[area] ?? ''));
        await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
        await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-area', 'library');
        await expect(menu.locator('[data-area="library"]')).toHaveAttribute('href', '/w/harbor/s/002/library');
        await expect(menu.locator('[data-area="data"]')).toHaveAttribute('href', '/w/harbor/s/002/claims');
        await expect(menu.locator('[data-area][aria-disabled]')).toHaveCount(0);
        if (width === 390) {
          // The compact sheet lists each area's tabs: Data exactly Claims and Tasks, Library its one tab Documents.
          await expect(menu.locator('[data-area="data"] .tab-list > span')).toHaveText([EN.shell.tabs['claims'] ?? '', EN.shell.tabs['tasks'] ?? '']);
          await expect(menu.locator('[data-area="library"] .tab-list > span')).toHaveText([EN.shell.tabs['library'] ?? '']);
        }

        await menu.locator('[data-area="data"]').click();
        await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/u);
        const tabs = page.locator('app-tab-bar a');
        await expect(tabs).toHaveCount(2);
        expect(await tabs.evaluateAll((links) => links.map((link) => link.getAttribute('data-tab')))).toEqual(['claims', 'tasks']);
        await expect(page.locator('app-library-page')).toHaveCount(0);
        if (width === 1440) await expect(page.locator('aside.shell-rail')).toHaveCount(1);
      });
    });
  }
});

/*
 * Group `deep link` of spec 017 (T49, ISC-158.1): the former Docs and Evidence addresses of a spec land in its Library
 * area. `bun run e2e -- spec -g "deep link"` is the claim's probe (it also runs ISC-76's three tests above).
 * - Each former address `/w/harbor/s/<id>/<tab>` (plan, design, decisions, constitution, evidence) and the former Docs
 *   area (`docs`, any path below it) lands on `/w/harbor/s/<id>/library` with exactly the selection written out in
 *   `formerTargets` (not read from the app): plan and design open that document of the spec (its catalog path as
 *   fragment, no `?doc=` left over), decisions the spec.md at its `## Decisions` section (`?section=decisions`, the
 *   heading in view and focused), constitution the workspace's constitution, evidence the list filtered to evidence
 *   (`?type=evidence`, the evidence subgroup open), `docs` the plain Library area. A kind the spec has no document of
 *   (002 has no design.md) lands on the plain Library area with `?doc=` dropped.
 * - Each is checked twice, by a direct load and by an in-app navigation without a page load (a history push the router
 *   follows); either way one step back lands on the spec dashboard, never on the old address.
 * - `g o`, the former Docs area's sequence, opens the Library area of the spec; no former Docs tab stands in the bar,
 *   and the shortcut sheet lists no binding for one.
 * Specs 002 (an evidence subgroup, no design.md) and 004 (a design.md, no evidence). The CLI's `-g` ignores case, so
 * `-g library` runs these tests too.
 */
const DEEP_EN = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as {
  library: { types: Readonly<Record<string, string>>; filters: { all: string } };
};
const FORMER_TABS = ['plan', 'design', 'decisions', 'constitution', 'evidence'] as const;
const FORMER_PATHS = [...FORMER_TABS, 'docs', 'docs/plan'] as const;
type FormerPath = (typeof FORMER_PATHS)[number];

type FormerLanding =
  | { readonly kind: 'doc'; readonly doc: LibraryDoc; readonly decisions: boolean }
  | { readonly kind: 'evidence'; readonly evidence: readonly LibraryDoc[] }
  | { readonly kind: 'plain' };

interface FormerTarget {
  readonly query: Readonly<Record<string, string>>;
  /** The fragment without `#`; `''` for none. */
  readonly hash: string;
  readonly landing: FormerLanding;
}

/** design.md 017 § Umleitungen, as T48 landed them: where each former address of spec `id` leads. */
async function formerTargets(request: APIRequestContext, id: string): Promise<Record<FormerPath, FormerTarget>> {
  const answer = await request.get(LIBRARY_ROUTE);
  expect(answer.status()).toBe(200);
  const catalog = (await answer.json()) as LibraryCatalog;
  const own = catalog.docs.filter((doc) => doc.spec !== 'workspace' && libraryKey(doc.spec) === id);
  const folder = own[0]?.spec;
  if (folder === undefined) throw new Error(`spec.spec: harbor ${id} has no catalog documents`);
  const byPath = (path: string): LibraryDoc | undefined => catalog.docs.find((doc) => doc.path === path);
  const plain: FormerTarget = { query: {}, hash: '', landing: { kind: 'plain' } };
  const ofKind = (kind: 'plan' | 'design'): FormerTarget => {
    const doc = byPath(`${folder}/${kind}.md`);
    return doc === undefined ? plain : { query: {}, hash: doc.path, landing: { kind: 'doc', doc, decisions: false } };
  };
  const spec = byPath(`${folder}/spec.md`);
  const constitution = byPath('constitution.md');
  if (spec === undefined || constitution === undefined) throw new Error(`spec.spec: harbor ${id} lacks spec.md or the constitution`);
  return {
    plan: ofKind('plan'),
    design: ofKind('design'),
    decisions: { query: { section: 'decisions' }, hash: spec.path, landing: { kind: 'doc', doc: spec, decisions: true } },
    constitution: { query: {}, hash: constitution.path, landing: { kind: 'doc', doc: constitution, decisions: false } },
    evidence: { query: { type: 'evidence' }, hash: '', landing: { kind: 'evidence', evidence: own.filter((doc) => doc.type === 'evidence') } },
    docs: plain,
    'docs/plan': plain,
  };
}

test.describe('deep link of a former Docs or Evidence address', () => {
  test.use(atWidth(1440));

  const MARK = 'spectantE2eNoReload';
  const READER = 'app-library-page [data-library-reader]';

  /** The spec dashboard, rendered: where every navigation below starts and every step back returns to. */
  async function atDashboard(page: Page, id: string): Promise<void> {
    await page.goto(`/w/harbor/s/${id}`);
    await expect(page.locator('app-spec-dashboard')).toBeVisible();
  }

  /** An in-app navigation to `path`: a history push the router follows, with no page load (the mark survives it). */
  async function navigateInApp(page: Page, path: string): Promise<void> {
    await page.evaluate(
      ({ target, mark }) => {
        (window as unknown as Record<string, unknown>)[mark] = true;
        history.pushState(null, '', target);
        dispatchEvent(new PopStateEvent('popstate', { state: null }));
      },
      { target: path, mark: MARK },
    );
  }

  const noReload = (page: Page): Promise<unknown> => page.evaluate((mark) => (window as unknown as Record<string, unknown>)[mark], MARK);

  async function expectLanding(page: Page, id: string, from: FormerPath, target: FormerTarget): Promise<void> {
    const what = `/w/harbor/s/${id}/${from}`;
    await expect(page.locator('app-library-page'), what).toHaveAttribute('data-scope', 'spec');
    await expect(page, what).toHaveURL((url) => url.pathname === `/w/harbor/s/${id}/library` && !url.searchParams.has('doc'));
    const url = new URL(page.url());
    expect(Object.fromEntries(url.searchParams), `query of ${what}`).toEqual(target.query);
    expect(url.hash, `fragment of ${what}`).toBe(target.hash === '' ? '' : `#${target.hash}`);

    const current = page.locator(`${LIBRARY_ENTRY}[aria-current="true"]`);
    const landing = target.landing;
    switch (landing.kind) {
      case 'doc': {
        await expect(current, what).toHaveCount(1);
        await expect(current, what).toHaveAttribute('data-library-entry', landing.doc.path);
        await expect(page.locator(`${READER} .lib-reader-title`), what).toHaveText(landing.doc.title);
        await expect(page.locator(`${READER} .lib-file`), what).toHaveText(`specs/${landing.doc.path}`);
        if (landing.decisions) {
          const heading = page.locator(`${READER} .docs-prose h2`).filter({ hasText: /^\s*Decisions\s*$/u });
          await expect(heading, what).toHaveCount(1);
          await expect(heading, what).toBeFocused();
          await expect(heading, what).toBeInViewport();
        }
        break;
      }
      case 'evidence': {
        const pill = page.locator('app-library-page [data-library-types]').getByRole('button', { name: DEEP_EN.library.types['evidence'] ?? '', exact: true });
        if (landing.evidence.length === 0) {
          // A spec without evidence (004): the filter names it all the same and lists nothing; no pill to press.
          await expect(page.locator('app-library-page [data-library-types]'), what).toBeVisible();
          await expect(pill, what).toHaveCount(0);
          await expect(page.locator(LIBRARY_ENTRY), what).toHaveCount(0);
          break;
        }
        await expect(pill, what).toHaveAttribute('aria-pressed', 'true');
        const subgroup = page.locator(`app-library-page [data-library-evidence="${id}"]`);
        await expect(subgroup.locator('[data-library-evidence-toggle]'), what).toHaveAttribute('aria-expanded', 'true');
        await expect(subgroup.locator('[data-library-evidence-count]'), what).toHaveText(String(landing.evidence.length));
        await expect(subgroup.locator('[data-library-entry]').first(), what).toBeVisible();
        const rows = await libraryRows(page);
        expect(rows.length, what).toBeGreaterThan(0);
        const evidencePaths = new Set(landing.evidence.map((doc) => doc.path));
        for (const row of rows) {
          expect(row.evidence, `${what}: ${row.path ?? ''} stands in the evidence subgroup`).toBe(true);
          expect(evidencePaths.has(row.path ?? ''), `${what}: ${row.path ?? ''} is evidence`).toBe(true);
        }
        break;
      }
      case 'plain': {
        // Nothing named: the list unfiltered, and at this width the reader shows the first row, as on any plain visit.
        const first = page.locator(LIBRARY_ENTRY).first();
        await expect(first, what).toBeVisible();
        await expect(current, what).toHaveCount(1);
        await expect(current, what).toHaveAttribute('data-library-entry', (await first.getAttribute('data-library-entry')) ?? '');
        // No type filter: the pill "All" is the pressed one.
        await expect(page.locator('app-library-page [data-library-types] [aria-pressed="true"]'), what).toHaveText(DEEP_EN.library.filters.all);
        break;
      }
    }
  }

  /** One step back lands on the spec dashboard and stays there: the old address was no history entry of its own. */
  async function expectBackToDashboard(page: Page, id: string, from: FormerPath): Promise<void> {
    await page.goBack();
    await expect(page, `back from ${from}`).toHaveURL((url) => url.pathname === `/w/harbor/s/${id}` && url.search === '' && url.hash === '');
    await expect(page.locator('app-spec-dashboard')).toBeVisible();
    expect(new URL(page.url()).pathname).toBe(`/w/harbor/s/${id}`);
  }

  for (const id of ['002', '004'] as const) {
    for (const from of FORMER_PATHS) {
      test(`${id}/${from} by a direct load lands in the Library area with its selection, and back skips it`, async ({ page, request }) => {
        const target = (await formerTargets(request, id))[from];
        await atDashboard(page, id);
        await page.goto(`/w/harbor/s/${id}/${from}`);
        await expectLanding(page, id, from, target);
        await expectBackToDashboard(page, id, from);
      });

      test(`${id}/${from} by an in-app navigation lands in the Library area with its selection, and back skips it`, async ({ page, request }) => {
        const target = (await formerTargets(request, id))[from];
        await atDashboard(page, id);
        await navigateInApp(page, `/w/harbor/s/${id}/${from}`);
        await expectLanding(page, id, from, target);
        expect(await noReload(page), 'no page load').toBe(true);
        await expectBackToDashboard(page, id, from);
        expect(await noReload(page), 'no page load').toBe(true);
      });
    }

    test(`${id}: g o, the former Docs sequence, opens the Library area; no former Docs tab or binding is left`, async ({ page }) => {
      await page.goto(`/w/harbor/s/${id}/status`);
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'status');

      await page.keyboard.press('?');
      const sheet = page.locator('app-shortcut-sheet dialog');
      await expect(sheet).toBeVisible();
      await expect(sheet.locator('[data-context="spec"] [data-binding="go-area-library"] kbd')).toHaveText(['g', 'o']);
      for (const tab of FORMER_TABS) await expect(sheet.locator(`[data-binding="go-tab-${tab}"]`), tab).toHaveCount(0);
      await expect(sheet.locator('[data-binding="go-docs"]')).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(sheet).toBeHidden();

      await page.keyboard.press('g');
      await page.keyboard.press('o');
      await expect(page).toHaveURL((url) => url.pathname === `/w/harbor/s/${id}/library` && url.search === '' && url.hash === '');
      await expect(page.locator('app-library-page')).toHaveAttribute('data-scope', 'spec');
      const tabs = page.locator('app-tab-bar a');
      await expect(tabs).toHaveCount(1);
      await expect(tabs.first()).toHaveAttribute('data-tab', 'library');
      for (const tab of FORMER_TABS) await expect(page.locator(`app-tab-bar [data-tab="${tab}"]`), tab).toHaveCount(0);
    });
  }
});
