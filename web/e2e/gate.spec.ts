/**
 * T79 · ISC-85 · ISC-86: the gate button in the spec head against the stub API (`core/fixtures/harbor.spec.golden.json`),
 * at 390 and 1440. The four states from the reviewed gate and the lock sources, the dialog with the three hashed
 * files, the scripted 409 and 423, the agent banner and the "No agent source" line. `bun run e2e -- gate`.
 */
import { readFileSync } from 'node:fs';
import { atWidth, expect, test, WIDTHS } from './fixtures';

type SpecGolden = {
  readonly gates: { readonly reviewed: { readonly state: string; readonly at?: string; readonly files?: readonly string[] } };
};
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const goldens = JSON.parse(readFileSync(new URL('../../core/fixtures/harbor.spec.golden.json', import.meta.url), 'utf8')) as Record<
  string,
  SpecGolden
>;
const reviewedFiles = (key: string): readonly string[] => goldens[key]?.gates.reviewed.files ?? [];

const SESSION = 'X-Spectant-Stub-Session';
const LOCKS = 'X-Spectant-Stub-Locks';
const WRITE = 'X-Spectant-Stub-Write';
const HEAD = 'app-spec-head';
const GATE = `${HEAD} [data-gate-action]`;
const DIALOG = `${HEAD} [data-gate-dialog]`;

for (const width of [WIDTHS.phone, WIDTHS.desktop]) {
  test.describe(`gate at ${String(width)}`, () => {
    test.use(atWidth(width));

    test('003 is ready', async ({ page }) => {
      await page.goto('/w/harbor/s/003/status');
      await expect(page.locator(GATE)).toHaveAttribute('data-state', 'ready');
      await expect(page.locator(GATE)).toBeEnabled();
      await expect(page.locator(GATE)).toBeVisible();
    });

    test('006 is stale and names the changed files of gates.reviewed.files', async ({ page }) => {
      await page.goto('/w/harbor/s/006');
      await expect(page.locator(GATE)).toHaveAttribute('data-state', 'stale');
      const expected = reviewedFiles('specs/006-partial-push');
      expect(expected.length).toBeGreaterThan(0);
      await expect(page.locator(`${HEAD} [data-changed-files] li`)).toHaveText([...expected]);
    });

    test('002 is done with the time of the mark', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const gate = page.locator(GATE);
      await expect(gate).toHaveAttribute('data-state', 'done');
      // spec 024: prototype value (principal: the prototype wins) — the time and the session stand in the `.gate-hint` under the button.
      // spec 006: the shared format in the test's zone (Europe/Berlin, en): `gates.reviewed.at` 2026-03-07T15:30:00Z.
      await expect(gate).toContainText(/Re-mark/u);
      const hint = page.locator(`${HEAD} [data-gate-hint]`);
      await expect(hint).toHaveText('Reviewed 03/07/2026, 4:30 PM');
      await expect(hint.locator('time')).toHaveAttribute('datetime', goldens['specs/002-web-console']?.gates.reviewed.at ?? '');
    });

    test('006 names the time of its stale mark in the shared format', async ({ page }) => {
      await page.goto('/w/harbor/s/006');
      // `gates.reviewed.at` 2026-03-08T12:00:00Z in Europe/Berlin.
      await expect(page.locator(`${HEAD} [data-gate-hint]`)).toHaveText('reviewed 03/08/2026, 1:00 PM · changed since');
    });

    test.describe('under a frontier lock', () => {
      test.use({ extraHTTPHeaders: { [LOCKS]: 'frontier' } });

      test('002 is paused with the session as visible text, and the agent banner shows', async ({ page }) => {
        await page.goto('/w/harbor/s/002/status');
        const gate = page.locator(GATE);
        await expect(gate).toHaveAttribute('data-state', 'paused');
        await expect(gate).toBeDisabled();
        // spec 024: prototype value (principal: the prototype wins) — the time and the session stand in the `.gate-hint` under the button.
        const hint = page.locator(`${HEAD} [data-gate-hint]`);
        await expect(hint).toContainText(/a:claude:(?:sess-2|stub-002-isc-\d+)/u);
        const banner = page.locator(`${HEAD} [data-agent-banner]`);
        await expect(banner).toBeVisible();
        const session = (await hint.textContent()) ?? '';
        const named = /a:claude:(?:sess-2|stub-002-isc-\d+)/u.exec(session)?.[0] ?? '';
        await expect(banner.locator('[data-session]')).toHaveText(named);
        await expect(banner.locator('[data-writes-paused]')).toBeVisible();
        await expect(page.locator(`${HEAD} [data-no-source-line]`)).toHaveCount(0);
      });
    });

    test.describe('with no lock source', () => {
      test.use({ extraHTTPHeaders: { [LOCKS]: 'none' } });

      test('002 shows the "No agent source" line and no banner', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        await expect(page.locator(`${HEAD} [data-no-source-line]`)).toHaveText(/No agent source/u);
        await expect(page.locator(`${HEAD} [data-agent-banner]`)).toHaveCount(0);
      });
    });

    test.describe('the dialog', () => {
      test.use({ extraHTTPHeaders: { [SESSION]: `gate-t79-ok-${String(width)}` } });

      test('lists the three hashed files with their hashes and confirms to done', async ({ page }) => {
        await page.request.post('/api/__stub/reset');
        await page.goto('/w/harbor/s/003');
        await page.locator(GATE).click();
        const dialog = page.locator(DIALOG);
        await expect(dialog).toBeVisible();
        const files = dialog.locator('[data-hashed-file]');
        await expect(files).toHaveCount(3);
        await expect(files.locator('.file')).toHaveText(['spec.md', 'plan.md', 'tasks.md']);
        for (const hash of await files.locator('[data-hash]').all()) await expect(hash).toHaveText(/^([0-9a-f]{12}|absent)$/u);
        await expect(files.locator('[data-hash]').first()).toHaveText(/^[0-9a-f]{12}$/u);
        await expect(dialog.locator('[data-confirm]')).toBeDisabled();
        for (const box of await dialog.locator('[data-gate-check]').all()) await box.check();
        await dialog.locator('[data-confirm]').click();
        await expect(dialog).toBeHidden();
        const written = page.locator(`${HEAD} [data-gate-written]`);
        await expect(written).toBeVisible();
        await expect(written).toContainText(/^Reviewed mark written \d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2} [AP]M\.$/u);
        await expect(written.locator('time')).toHaveAttribute('datetime', /^\d{4}-\d{2}-\d{2}T/u);
        await expect(page.locator(GATE)).toHaveAttribute('data-state', 'done');
      });
    });

    test.describe('a scripted 409', () => {
      test.use({ extraHTTPHeaders: { [SESSION]: `gate-t79-409-${String(width)}`, [WRITE]: 'stale' } });

      test('shows the inline alert with Reload and writes nothing', async ({ page }) => {
        await page.goto('/w/harbor/s/003');
        await page.locator(GATE).click();
        const dialog = page.locator(DIALOG);
        for (const box of await dialog.locator('[data-gate-check]').all()) await box.check();
        await dialog.locator('[data-confirm]').click();
        const alert = dialog.locator('[data-write-conflict]');
        await expect(alert).toBeVisible();
        await expect(alert).toHaveAttribute('role', 'alert');
        await expect(alert.locator('[data-reload]')).toBeVisible();
        await expect(page.locator(`${HEAD} [data-gate-written]`)).toHaveCount(0);
      });
    });

    test.describe('a scripted 423', () => {
      test.use({ extraHTTPHeaders: { [SESSION]: `gate-t79-423-${String(width)}`, [WRITE]: 'locked' } });

      test("names the lock's session and writes nothing", async ({ page }) => {
        await page.goto('/w/harbor/s/003');
        await page.locator(GATE).click();
        const dialog = page.locator(DIALOG);
        for (const box of await dialog.locator('[data-gate-check]').all()) await box.check();
        await dialog.locator('[data-confirm]').click();
        await expect(dialog.locator('[data-write-locked]')).toContainText(/a:claude:stub-003-isc-\d+/u);
        await expect(page.locator(`${HEAD} [data-gate-written]`)).toHaveCount(0);
      });
    });
  });
}

test.describe('spec head per tier', () => {
  test.describe('at 1440', () => {
    test.use(atWidth(WIDTHS.desktop));

    test('breadcrumb, title, chips and the action cluster', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const head = page.locator(HEAD);
      const crumbs = head.locator('[data-breadcrumb]');
      await expect(crumbs).toBeVisible();
      // spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
      await expect(crumbs.locator('[data-crumb="spec"]')).toHaveText('Spec 002');
      await expect(crumbs.locator('[data-crumb="area"]')).toHaveAttribute('aria-current', 'page');
      await expect(head.locator('.spec-title')).toHaveAttribute('title', 'Web console');
      await expect(head.locator('[data-head-actions] [data-head-command]')).toContainText('/spec-implement 002');
      await expect(head.locator('[data-head-actions] [data-notes-pill]')).toHaveAttribute('href', '/w/harbor/s/002/notes');
      await expect(head.locator('[data-meta]')).toContainText(/updated .* ago/u);
    });
  });

  test.describe('at 390', () => {
    test.use(atWidth(WIDTHS.phone));

    // Spec 003 (ISC-105, T39) brings the breadcrumb back at compact in its short form; since spec 019 (ISC-140.1) it leads
    // with the workspace at every tier and still names no area. Design
    // 002's 240 px budget was set for a head without a breadcrumb; the crumb row (20 px plus the 8 px row gap at a fine
    // pointer) sits on top of it, so the head is measured without that row against the budget and as a whole against
    // the budget plus the row.
    test('short breadcrumb, full-width command chip, at most 240 px tall beside the breadcrumb row', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const head = page.locator(HEAD);
      await expect(head.locator('[data-head-command]')).toBeVisible();
      // spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
      await expect(head.locator('[data-breadcrumb] [data-crumb="spec"]')).toHaveText('Spec 002');
      await expect(head.locator('[data-breadcrumb] [data-crumb]').first()).toHaveAttribute('data-crumb', 'workspace');
      await expect(head.locator('[data-breadcrumb] [data-crumb="area"]')).toHaveAttribute('aria-current', 'page');
      await expect(head.locator('[data-description]')).toBeVisible();
      const box = await head.boundingBox();
      const crumbs = await head.locator('[data-breadcrumb]').boundingBox();
      const crumbRow = (crumbs?.height ?? 0) + 8;
      // spec 024: prototype value (principal: the prototype wins; ISC-105 adjusted to the prototype) — the prototype's
      // `.gate-btn` carries its 11 px `.gate-hint` line under the button (2 px gap, at most one 16 px line), measured like
      // the crumb row on top of the 240 px budget.
      const hint = await head.locator('[data-gate-hint]').boundingBox();
      expect(hint?.height ?? 0).toBeLessThanOrEqual(16);
      const hintRow = hint === null ? 0 : hint.height + 2;
      expect(crumbs?.height ?? Infinity).toBeLessThanOrEqual(44);
      expect((box?.height ?? Infinity) - crumbRow - hintRow).toBeLessThanOrEqual(240);
    });
  });
});
