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
