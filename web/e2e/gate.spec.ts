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
      // spec 045 (ISC-272): at 1440 the head's pill names the mark's short date and time, at 390 the icon keeps "Re-mark"
      // as its name; the full time stays in the `.gate-hint`, visually hidden in the head.
      // spec 006: the shared format in the test's zone (Europe/Berlin, en): `gates.reviewed.at` 2026-03-07T15:30:00Z.
      await expect(gate).toContainText(width === WIDTHS.desktop ? 'Reviewed 03/07, 4:30 PM' : /Re-mark/u);
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
        // Spec 045 (ISC-273): the head confirms the write with the app's toast, not a line under its gate.
        await expect(page.locator('ui-toast .alert')).toHaveText(/^Reviewed mark written \d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2} [AP]M\.$/u);
        await expect(page.locator(`${HEAD} [data-gate-written]`)).toHaveCount(0);
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
      await expect(head.locator('[data-head-actions] [data-head-command]')).toContainText('/spec implement 002');
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
    // Spec 021 (T67, T70, ISC-250): at compact the meta line, the command chip and Notes fold into "Details of NNN",
    // the gate is an icon button that keeps its label as its accessible name, and the collapsed head stays under 20 %
    // of the first screen.
    test('short breadcrumb, icon gate, the command chip in the Details fold, the collapsed head under 20 % of the screen', async ({ page }) => {
      // ISC-250 measures the first screen at 390 × 900 (`density-head.spec.ts`).
      await page.setViewportSize({ width: 390, height: 900 });
      await page.goto('/w/harbor/s/002/status');
      const head = page.locator(HEAD);
      // spec 024: breadcrumb Workspace / Spec · Area, milestone/feature/priority in the chip row (principal 2026-10-12, design.md)
      await expect(head.locator('[data-breadcrumb] [data-crumb="spec"]')).toHaveText('Spec 002');
      await expect(head.locator('[data-breadcrumb] [data-crumb]').first()).toHaveAttribute('data-crumb', 'workspace');
      await expect(head.locator('[data-breadcrumb] [data-crumb="area"]')).toHaveAttribute('aria-current', 'page');
      await expect(head.locator('[data-description]')).toBeVisible();
      const crumbs = await head.locator('[data-breadcrumb]').boundingBox();
      expect(crumbs?.height ?? Infinity).toBeLessThanOrEqual(44);

      // The gate: icon-only in the title row, its label (and hint) read but not shown.
      const gate = head.locator('[data-head-actions] app-gate-button[data-size="icon"] button').first();
      await expect(gate).toBeVisible();
      const label = ((await gate.locator('.gate-label').textContent()) ?? '').trim();
      expect(label).not.toBe('');
      await expect(gate).toHaveAccessibleName(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));
      const box = await gate.boundingBox();
      expect(box?.width ?? Infinity).toBeLessThanOrEqual(44);

      // The collapsed head: no command chip in sight, at most 20 % of the first screen.
      await expect(head.locator('[data-head-command]')).toBeHidden();
      const viewport = page.viewportSize();
      const collapsed = await head.boundingBox();
      expect(collapsed?.height ?? Infinity).toBeLessThanOrEqual((viewport?.height ?? 0) * 0.2);

      // "Details of 002" opens the meta line and the command chip.
      const details = head.locator('[data-head-details] button').first();
      await expect(details).toHaveAccessibleName(/002/u);
      await details.click();
      await expect(details).toHaveAttribute('aria-expanded', 'true');
      await expect(head.locator('[data-head-details-actions] [data-head-command]')).toBeVisible();
      await expect(head.locator('[data-head-details-actions] [data-head-command]')).toContainText('/spec implement 002');
    });
  });
});

// Spec 045 (ISC-271, ISC-273): at 1440 × 900 the head's command chip, gate pill and Notes pill stand in one row, each
// 28 px high, with one radius and centres at most 1 px apart, in all four gate states; nothing shows under the pill
// and the pill never wraps. `bun run e2e -- gate -g head-pill`.
test.describe('head-pill at 1440 × 900', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  const STATES = [
    { state: 'ready', path: '/w/harbor/s/003', locks: undefined },
    { state: 'stale', path: '/w/harbor/s/006', locks: undefined },
    { state: 'done', path: '/w/harbor/s/002', locks: undefined },
    { state: 'paused', path: '/w/harbor/s/002', locks: 'frontier' },
  ] as const;

  for (const { state, path, locks } of STATES) {
    test(`head-pill ${state}: one row, 28 px, one radius, no second line`, async ({ page }) => {
      if (locks) await page.setExtraHTTPHeaders({ [LOCKS]: locks });
      await page.goto(path);
      const actions = page.locator(`${HEAD} [data-head-actions]`);
      const gate = actions.locator('app-gate-button [data-gate-action]');
      await expect(gate).toHaveAttribute('data-state', state);
      const parts = [actions.locator('[data-head-command] .chip'), gate, actions.locator('[data-notes-pill]')];
      const boxes: Array<{ x: number; y: number; width: number; height: number }> = [];
      const radii: string[] = [];
      for (const part of parts) {
        await expect(part).toBeVisible();
        const box = await part.boundingBox();
        expect(box).not.toBeNull();
        boxes.push(box ?? { x: 0, y: 0, width: 0, height: 0 });
        radii.push(await part.evaluate((el) => getComputedStyle(el).borderTopLeftRadius));
      }
      // ISC-271: 28 ± 1 px each, one radius, centres within 1 px.
      for (const box of boxes) expect(Math.abs(box.height - 28)).toBeLessThanOrEqual(1);
      expect(new Set(radii).size).toBe(1);
      const centres = boxes.map((box) => box.y + box.height / 2);
      expect(Math.max(...centres) - Math.min(...centres)).toBeLessThanOrEqual(1);
      // ISC-273: the gate's whole host is the pill (no hint, time line or file list under it), and its label is one line.
      const hostBox = await actions.locator('app-gate-button').boundingBox();
      expect(hostBox?.height ?? Infinity).toBeLessThanOrEqual(29);
      expect(await gate.locator('.gate-label').evaluate((el) => el.getClientRects().length)).toBe(1);
      const labelBox = await gate.locator('.gate-label').boundingBox();
      expect(labelBox?.height ?? Infinity).toBeLessThanOrEqual(20);
    });
  }

  test.describe('after a write', () => {
    test.use({ extraHTTPHeaders: { [SESSION]: 'gate-045-written' } });

    test('head-pill after a write: the toast confirms it and nothing stands under the pill', async ({ page }) => {
      await page.request.post('/api/__stub/reset');
      await page.goto('/w/harbor/s/003');
      const actions = page.locator(`${HEAD} [data-head-actions]`);
      await actions.locator('[data-gate-action]').click();
      const dialog = page.locator(DIALOG);
      for (const box of await dialog.locator('[data-gate-check]').all()) await box.check();
      await dialog.locator('[data-confirm]').click();
      await expect(dialog).toBeHidden();
      await expect(actions.locator('[data-gate-action]')).toHaveAttribute('data-state', 'done');
      await expect(page.locator('ui-toast .alert')).toHaveText(/^Reviewed mark written \d{2}\/\d{2}\/\d{4}, \d{1,2}:\d{2} [AP]M\.$/u);
      await expect(page.locator(`${HEAD} [data-gate-written]`)).toHaveCount(0);
      const hostBox = await actions.locator('app-gate-button').boundingBox();
      expect(hostBox?.height ?? Infinity).toBeLessThanOrEqual(29);
    });
  });
});
