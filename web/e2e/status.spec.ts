/**
 * T55 · ISC-80 · ISC-36: the Status area's Timeline tab against the stub API (`core/fixtures/harbor.timeline.golden.json`).
 * `bun run e2e -- status -g timeline`.
 */
import { readFileSync } from 'node:fs';
import { atWidth, expect, test, WIDTHS } from './fixtures';

type GoldenEntry = { readonly kind: string; readonly derived: boolean; readonly id?: string };
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const golden = JSON.parse(
  readFileSync(new URL('../../core/fixtures/harbor.timeline.golden.json', import.meta.url), 'utf8'),
) as Record<string, readonly GoldenEntry[]>;
const HARBOR_002 = golden['specs/002-web-console'] ?? [];

test.use(atWidth(WIDTHS.desktop));

test.describe('timeline', () => {
  test('renders one entry per golden entry', async ({ page }) => {
    await page.goto('/w/harbor/s/002/timeline');
    const entries = page.locator('app-timeline-tab [data-entry]');
    await expect(entries).toHaveCount(HARBOR_002.length);
  });

  test('the Round filter leaves the three rounds and survives a reload', async ({ page }) => {
    await page.goto('/w/harbor/s/002/timeline');
    const entries = page.locator('app-timeline-tab [data-entry]');
    await expect(entries).toHaveCount(HARBOR_002.length);

    const round = page.locator('app-timeline-tab [data-filter="round"]');
    await round.click();
    await expect(round).toHaveAttribute('aria-pressed', 'true');
    await expect(entries).toHaveCount(3);
    await expect(page).toHaveURL(/[?&]kinds=round(&|#|$)/);

    await page.reload();
    await expect(page.locator('app-timeline-tab [data-entry]')).toHaveCount(3);
  });

  test('derived stage entries carry the derived chip (ISC-36)', async ({ page }) => {
    await page.goto('/w/harbor/s/002/timeline');
    const derived = HARBOR_002.filter((entry) => entry.kind === 'stage' && entry.derived).length;
    await expect(page.locator('app-timeline-tab [data-kind="stage"] [data-derived-chip]')).toHaveCount(derived);
    await expect(page.locator('app-timeline-tab [data-kind="round"] [data-derived-chip]')).toHaveCount(0);
  });

  test('#t/round-3 highlights and opens round 3', async ({ page }) => {
    await page.goto('/w/harbor/s/002/timeline#t/round-3');
    const round3 = page.locator('app-timeline-tab [data-id="round-3"]');
    await expect(round3).toHaveAttribute('data-highlighted', '');
    await expect(round3.locator('ui-disclosure button[aria-expanded]')).toHaveAttribute('aria-expanded', 'true');
    await expect(round3.locator('a[data-open-board]')).toHaveAttribute('href', '/w/harbor/s/002/board');
    await expect(page.locator('app-timeline-tab [data-highlighted]')).toHaveCount(1);
  });
});

/**
 * T54 · ISC-79 · ISC-85: the Status tab against the stub API (`core/fixtures/harbor.spec.golden.json`), at compact,
 * where every section stacks. `bun run e2e -- status -g "status tab"`.
 */
type SpecGolden = {
  readonly head: { readonly stage: string };
  readonly next: { readonly command: string | null; readonly reasons: readonly string[] };
  readonly waitingOnYou: readonly unknown[];
  readonly gates: Readonly<Record<string, { readonly state: string; readonly files?: readonly string[] }>>;
};
const specGoldens = JSON.parse(
  readFileSync(new URL('../../core/fixtures/harbor.spec.golden.json', import.meta.url), 'utf8'),
) as Record<string, SpecGolden>;
const specGolden = (key: string): SpecGolden => {
  const found = specGoldens[key];
  if (!found) throw new Error(`harbor.spec.golden.json holds no ${key}`);
  return found;
};
const SPEC_002 = specGolden('specs/002-web-console');
const SPEC_006 = specGolden('specs/006-partial-push');
const SESSION = 'X-Spectant-Stub-Session';

test.describe('status tab', () => {
  test.use(atWidth(WIDTHS.phone));

  test('stage, next command, reasons and waiting rows equal the golden (ISC-79)', async ({ page }) => {
    await page.goto('/w/harbor/s/002/status');
    const tab = page.locator('app-status-tab');
    await expect(tab.locator('[data-stage]')).toHaveAttribute('data-value', SPEC_002.head.stage);
    await expect(tab.locator('[data-next-command]')).toContainText(SPEC_002.next.command ?? '');
    await expect(tab.locator('[data-reason]')).toHaveText([...SPEC_002.next.reasons]);
    await expect(tab.locator('[data-waiting-row]')).toHaveCount(SPEC_002.waitingOnYou.length);
    await expect(tab.locator('ui-stage-track li[aria-current="step"]')).toHaveCount(1);
    await expect(tab.locator('[data-claims-closed]')).toBeVisible();
  });

  test('gates render the golden states', async ({ page }) => {
    await page.goto('/w/harbor/s/002/status');
    await expect(page.locator('app-status-tab [data-gate]')).toHaveCount(Object.keys(SPEC_002.gates).length);
    for (const [name, gate] of Object.entries(SPEC_002.gates)) {
      await expect(page.locator(`app-status-tab [data-gate="${name}"]`)).toHaveAttribute('data-state', gate.state);
    }
  });

  test('the gate button shows ready, stale and done from the reviewed gate', async ({ page }) => {
    await page.goto('/w/harbor/s/003/status');
    await expect(page.locator('app-status-tab [data-gate-action]')).toHaveAttribute('data-state', 'ready');

    await page.goto('/w/harbor/s/006/status');
    await expect(page.locator('app-status-tab [data-gate-action]')).toHaveAttribute('data-state', 'stale');
    await expect(page.locator('app-status-tab [data-changed-files] li')).toHaveCount(SPEC_006.gates['reviewed']?.files?.length ?? 0);

    await page.goto('/w/harbor/s/002/status');
    await expect(page.locator('app-status-tab [data-gate-action]')).toHaveAttribute('data-state', 'done');
  });

  test('#waiting deep link focuses the heading', async ({ page }) => {
    await page.goto('/w/harbor/s/002/status#waiting');
    await expect(page.locator('app-status-tab #waiting')).toBeFocused();
  });

  test.describe('gate write', () => {
    test.use({ extraHTTPHeaders: { [SESSION]: 'status-t54-ok' } });

    test('Confirm lists the three hashed files and answers 200', async ({ page }) => {
      await page.request.post('/api/__stub/reset');
      await page.goto('/w/harbor/s/003/status');
      await page.locator('app-status-tab [data-gate-action][data-state="ready"]').click();
      const dialog = page.locator('app-status-tab [data-gate-dialog]');
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('[data-hashed-file]')).toHaveCount(3);
      await expect(dialog.locator('[data-no-agent-source]')).toBeVisible();
      await dialog.locator('[data-confirm]').click();
      await expect(page.locator('app-status-tab [data-gate-written]')).toBeVisible();
      await expect(dialog).toBeHidden();
      await expect(page.locator('app-status-tab [data-gate-action]')).toHaveAttribute('data-state', 'done');
    });
  });

  test.describe('gate write conflict', () => {
    test.use({ extraHTTPHeaders: { [SESSION]: 'status-t54-409', 'X-Spectant-Stub-Write': 'stale' } });

    test('a 409 shows the inline alert with Reload', async ({ page }) => {
      await page.goto('/w/harbor/s/003/status');
      await page.locator('app-status-tab [data-gate-action]').click();
      const dialog = page.locator('app-status-tab [data-gate-dialog]');
      await dialog.locator('[data-confirm]').click();
      const alert = dialog.locator('[data-write-conflict]');
      await expect(alert).toBeVisible();
      await expect(alert).toHaveAttribute('role', 'alert');
      await expect(alert.locator('[data-reload]')).toBeVisible();
      await expect(page.locator('app-status-tab [data-gate-written]')).toHaveCount(0);
    });
  });

  test.describe('gate write paused', () => {
    test.use({ extraHTTPHeaders: { [SESSION]: 'status-t54-lock', 'X-Spectant-Stub-Locks': 'frontier' } });

    test('under a frontier lock the button is paused and names the session', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const button = page.locator('app-status-tab [data-gate-action]');
      await expect(button).toHaveAttribute('data-state', 'paused');
      await expect(button).toBeDisabled();
      await expect(button).toContainText(/spec-002-ISC-\d+/u);
      await expect(page.locator('app-status-tab [data-writes-paused]')).toBeVisible();
    });
  });
});
