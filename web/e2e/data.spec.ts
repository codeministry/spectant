/**
 * The Data area's tabs against the stub API (ISC-81, ISC-82, ISC-83.1). `bun run e2e -- data -g claims` is ISC-81's
 * probe: the Claims tab renders every claim of the harbor 002 golden, its filter chip counts equal the golden's
 * `counts`, and a state chip narrows the cards to that count. Each tab keeps its tests in its own `describe` block.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ClaimViewModel } from '../../core/src/files.ts';
import { specRoutes } from '../../server/src/spec-routes.contract.ts';
import { expect, test } from './fixtures';

const GOLDEN = fileURLToPath(new URL('../../core/fixtures/harbor.claim-view.golden.json', import.meta.url));
const HARBOR_002 = (JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, ClaimViewModel>)['specs/002-web-console'];
if (!HARBOR_002) throw new Error('harbor.claim-view.golden.json holds no specs/002-web-console');
const CLAIMS = HARBOR_002;

/** The filter row order of `app-claims-tab`: state chips, then kind chips. */
const STATE_KEYS = ['all', 'open', 'takeable', 'taken', 'blocked', 'closed', 'dropped'] as const;
const KIND_KEYS = ['all', 'anti', 'antecedent'] as const;

test.describe('claims', () => {
  test('claims tab renders one card per claim of the golden', async ({ page }) => {
    await page.goto('/w/harbor/s/002/claims');
    await expect(page.locator('app-claims-tab [data-claim]')).toHaveCount(CLAIMS.claims.length);
    const ids = await page.locator('app-claims-tab [data-claim]').evaluateAll((cards) => cards.map((c) => c.getAttribute('data-claim')));
    expect(ids).toEqual(CLAIMS.claims.map((c) => c.id));
    for (const feature of CLAIMS.features) {
      await expect(page.locator(`app-claims-tab [data-feature="${feature.id}"] ui-section-header`)).toContainText(feature.title);
    }
  });

  test('claims filter chip counts equal the golden counts', async ({ page }) => {
    await page.goto('/w/harbor/s/002/claims');
    const states = page.locator('app-claims-tab [data-filter="state"] button .count');
    await expect(states).toHaveText(STATE_KEYS.map((key) => String(CLAIMS.counts[key])));
    const kinds = page.locator('app-claims-tab [data-filter="kind"] button .count');
    await expect(kinds).toHaveText(KIND_KEYS.map((key) => String(CLAIMS.counts[key])));
  });

  test('claims takeable chip narrows the cards to counts.takeable', async ({ page }) => {
    await page.goto('/w/harbor/s/002/claims');
    await page.locator('app-claims-tab [data-filter="state"] button').nth(STATE_KEYS.indexOf('takeable')).click();
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims\?state=takeable$/);
    await expect(page.locator('app-claims-tab [data-claim]')).toHaveCount(CLAIMS.counts.takeable);
    await expect(page.locator('app-claims-tab [data-claim]:not([data-state="takeable"])')).toHaveCount(0);
  });

  test('claims deep link scrolls to and focuses its card', async ({ page }) => {
    const blocked = CLAIMS.claims.find((c) => c.state === 'blocked') ?? CLAIMS.claims.at(-1);
    if (!blocked) throw new Error('the golden holds no claim');
    await page.goto(`/w/harbor/s/002/claims#claim-${blocked.id}`);
    const card = page.locator(`app-claims-tab [data-claim="${blocked.id}"]`);
    await expect(card).toBeFocused();
    await expect(card).toHaveClass(/is-target/);
    await expect(card).toBeInViewport();
  });

  test.describe('under the activity lock fixture', () => {
    test.use({ extraHTTPHeaders: { 'X-Spectant-Stub-Locks': 'activity' } });

    test('claims taken card shows its session', async ({ page, request }) => {
      const answer = await request.get(specRoutes.claims('harbor', '002'));
      expect(answer.status()).toBe(200);
      const payload = (await answer.json()) as ClaimViewModel;
      const taken = payload.claims.find((c) => c.state === 'taken' && c.lock !== null);
      // The stub serves the claim-view golden as it is, whatever the lock fixture; harbor 002 holds no taken claim
      // there yet. The test runs as soon as the stub (or the golden) carries one.
      test.skip(taken === undefined, 'the stub claims route holds no taken claim for harbor 002 under activity');
      if (!taken?.lock) return;
      await page.goto('/w/harbor/s/002/claims?state=taken');
      const card = page.locator(`app-claims-tab [data-claim="${taken.id}"]`);
      await expect(card.locator('[data-chip="lock"]')).toBeVisible();
      await expect(card.locator('[data-session]')).toContainText(taken.lock.session);
    });
  });
});
