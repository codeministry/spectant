/**
 * The Data area's tabs against the stub API (ISC-81, ISC-82, ISC-83.1). `bun run e2e -- data -g claims` is ISC-81's
 * probe: the Claims tab renders every claim of the harbor 002 golden, its filter chip counts equal the golden's
 * `counts`, and a state chip narrows the cards to that count. `bun run e2e -- data -g tasks` is ISC-82's probe: the Tasks
 * tab's rows, lane chips, lane filter and probe mapping equal the golden `TasksTab` of harbor 002. Each tab keeps its
 * tests in its own `describe` block.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext } from '@playwright/test';
import type { ClaimViewModel, EvidenceFile, EvidenceListing } from '../../core/src/files.ts';
import { type SpecRouteResponses, specRoutes } from '../../server/src/spec-routes.contract.ts';
import { atWidth, expect, test } from './fixtures';

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

type TasksBody = NonNullable<SpecRouteResponses['tasks']>;

const TASKS_GOLDEN = JSON.parse(
  readFileSync(new URL('../../core/fixtures/harbor.tasks.golden.json', import.meta.url), 'utf8'),
) as Record<string, TasksBody | null>;
const HARBOR_002_TASKS = TASKS_GOLDEN['specs/002-web-console'];

test.describe('tasks', () => {
  const golden = HARBOR_002_TASKS;
  if (!golden) throw new Error('harbor 002 has no tasks golden');
  const laneCount = (lane: string) => golden.counts.byLane.find((c) => c.name === lane)?.count;

  for (const width of [1440, 820, 390]) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('tasks: renders counts.rows rows and the probe mapping', async ({ page }) => {
        await page.goto('/w/harbor/s/002/tasks');
        await expect(page.locator('[data-task-row]')).toHaveCount(golden.counts.rows);
        await expect(page.locator('[data-mapping-row]')).toHaveCount(golden.probeMapping.length);
        await expect(page.locator('[data-tasks-landed]')).toContainText(
          `${String(golden.counts.boxes.landed)}/${String(golden.counts.boxes.total)}`,
        );
      });
    });
  }

  test('tasks: lane chips carry the golden counts and a lane narrows to byLane', async ({ page }) => {
    await page.goto('/w/harbor/s/002/tasks');
    const chips = page.locator('[data-filter="lane"] button');
    await expect(chips).toHaveCount(golden.counts.byLane.length + 1);
    for (const [index, lane] of golden.counts.byLane.entries()) {
      await expect(chips.nth(index + 1)).toHaveText(new RegExp(`^\\s*${lane.name}\\s+${String(lane.count)}\\s*$`));
    }

    await chips.filter({ hasText: /^\s*web\s/ }).click();
    await expect(page).toHaveURL(/[?&]lane=web\b/);
    await expect(page.locator('[data-task-row]')).toHaveCount(laneCount('web') ?? -1);
    await expect(page.locator('[data-task-row]:not([data-lane-name="web"])')).toHaveCount(0);

    await page.reload();
    await expect(page.locator('[data-task-row]')).toHaveCount(laneCount('web') ?? -1);
  });

  test('tasks: status filter and hide done come from the URL', async ({ page }) => {
    const held = golden.counts.byStatus.find((c) => c.name === 'held')?.count ?? -1;
    await page.goto('/w/harbor/s/002/tasks?status=held');
    await expect(page.locator('[data-task-row]')).toHaveCount(held);

    const open = golden.tasks.filter((t) => t.state !== 'done').length;
    await page.goto('/w/harbor/s/002/tasks?hideDone=1');
    await expect(page.locator('[data-task-row]')).toHaveCount(open);
    await expect(page.locator('[data-done-hidden]')).toBeVisible();
  });

  test('tasks: checkboxes render their state, disabled until writes land', async ({ page }) => {
    await page.goto('/w/harbor/s/002/tasks');
    const boxes = page.locator('[data-task-row] input[type="checkbox"]');
    await expect(boxes).toHaveCount(golden.counts.boxes.total);
    await expect(page.locator('[data-task-row] input[type="checkbox"]:checked')).toHaveCount(golden.counts.boxes.landed);
    await expect(page.locator('[data-task-row] input[type="checkbox"]:enabled')).toHaveCount(0);
  });

  test('tasks: an edge link scrolls to and focuses the task it names', async ({ page }) => {
    const withEdge = golden.tasks.find((t) => t.edges.length > 0);
    const edge = withEdge?.edges[0];
    if (!withEdge || edge === undefined) throw new Error('the golden holds no task with an edge');
    await page.goto('/w/harbor/s/002/tasks');
    await page.locator(`#task-${withEdge.id} a[data-edge]`).first().click();
    await expect(page).toHaveURL(new RegExp(`#task-${edge}$`));
    const row = page.locator(`#task-${edge}`);
    await expect(row).toBeFocused();
    await expect(row).toHaveClass(/is-target/);
  });
});

/**
 * ISC-83.1's probe (`bun run e2e -- data -g evidence`): every file the stub lists (core's `listEvidence` over harbor's
 * real `artifacts/` and `.evidence/`) is a row under its claim group; an image and a markdown file open the preview
 * dialog; a path the stub refuses (403) is an error row, never a preview (ISC-83).
 */
test.describe('evidence', () => {
  const PREVIEW = 'app-evidence-tab dialog[data-preview]';

  async function listing(request: APIRequestContext): Promise<EvidenceListing> {
    const answer = await request.get(specRoutes.evidence('harbor', '002'));
    expect(answer.status()).toBe(200);
    return (await answer.json()) as EvidenceListing;
  }

  test('evidence tab lists every fixture file under its claim', async ({ page, request }) => {
    const body = await listing(request);
    const all = [...body.results, ...body.raw];
    expect(all.length).toBeGreaterThan(0);
    await page.goto('/w/harbor/s/002/evidence');
    await expect(page.locator('app-evidence-tab [data-file]')).toHaveCount(all.length);
    for (const [claim, files] of Object.entries(body.byClaim)) {
      for (const file of files) {
        await expect(page.locator(`app-evidence-tab [data-claim-group="${claim}"] [data-file="${file.path}"]`)).toHaveCount(1);
      }
    }
    for (const file of body.ungrouped) {
      await expect(page.locator(`app-evidence-tab [data-claim-group="none"] [data-file="${file.path}"]`)).toHaveCount(1);
    }
  });

  test('evidence image thumbnail opens the dialog with its path and image', async ({ page, request }) => {
    const image = [...(await listing(request)).raw].find((f) => f.mediaType.startsWith('image/'));
    if (!image) throw new Error('harbor 002 lists no image');
    await page.goto('/w/harbor/s/002/evidence');
    await page.locator(`app-evidence-tab [data-thumb][data-file="${image.path}"]`).click();
    const dialog = page.locator(PREVIEW);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-preview-path]')).toHaveText(image.path);
    const img = dialog.locator('img');
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await dialog.locator('[data-preview-close]').click();
    await expect(dialog).toBeHidden();
  });

  test('evidence markdown file opens the dialog with rendered content', async ({ page, request }) => {
    const markdown = (await listing(request)).results.find((f) => f.mediaType === 'text/markdown');
    if (!markdown) throw new Error('harbor 002 lists no markdown artifact');
    await page.goto('/w/harbor/s/002/evidence');
    await page.locator(`app-evidence-tab [data-file="${markdown.path}"]`).click();
    const dialog = page.locator(PREVIEW);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-preview-path]')).toHaveText(markdown.path);
    await expect(dialog.locator('[data-preview-body] :is(h1, h2, h3, p)').first()).toBeVisible();
  });

  test('evidence refused path renders an error row, never a preview', async ({ page, request }) => {
    const body = await listing(request);
    // A traversal path: core's `resolveEvidencePath` refuses it as `outside`, and the stub answers 403.
    const traversal: EvidenceFile = {
      group: 'artifacts',
      path: 'artifacts/../spec.md',
      name: 'spec.md',
      bytes: 10,
      mediaType: 'text/markdown',
      task: null,
      claim: null,
    };
    expect((await request.get(specRoutes.evidenceFile('harbor', '002', traversal.path))).status()).toBe(403);
    await page.route('**/specs/002/evidence', (route) =>
      route.fulfill({ json: { ...body, results: [...body.results, traversal], ungrouped: [...body.ungrouped, traversal] } }),
    );
    await page.goto('/w/harbor/s/002/evidence');
    const row = page.locator(`app-evidence-tab [data-file="${traversal.path}"]`);
    await row.click();
    await expect(row).toHaveAttribute('data-error', 'refused');
    await expect(page.locator(PREVIEW)).toBeHidden();
  });
});
