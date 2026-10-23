/**
 * Spec 067 · T31 · ISC-534 (`bun run e2e -- sidebar -g "release run"`): a spec or an idea with an open run offers its
 * release in the detail sidebar's action grid (write path 8: one appended `run-end` line with `outcome: released`),
 * behind the same confirmation as the status block, and the run leaves the sidebar after the next read.
 *
 * `X-Spectant-Stub-Locks: runs` serves beacon with 003 under the run `r-0308-1452` and its story `uptime-badges`
 * running (`STUB_RUN` in `stub-api.ts`); the clock is pinned to `STUB_NOW`, where the run is open, not aborted.
 *
 * - 1440: 003 chosen from its Specs row docks the sidebar: the run line reads running and "Release run" stands once,
 *   in the action grid. The press opens the confirmation with the focus on "Keep"; "Release" sends exactly one POST to
 *   the run's release route, and the run line and the button leave the sidebar without a reload.
 * - 1440: the story `uptime-badges` chosen from its idea row shows the same release action once.
 * - 390: the same release from the bottom sheet.
 *
 * One stub session per test, reset before and after (a release lives per session).
 */
import type { Locator, Page, Request } from '@playwright/test';

import { atWidth, expect, test, WIDTHS } from './fixtures';
import { LOCKS_HEADER, RESET_PATH, SESSION_HEADER, STUB_NOW, STUB_RUN } from './stub-api';

const WS = STUB_RUN.workspace.slug;
const SPEC = STUB_RUN.spec;
const IDEA = 'uptime-badges';
const RELEASE_PATH = `/${WS}/runs/${STUB_RUN.run}/release`;
const MARKER = '__sidebarReleaseNoReload';

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const runLine = (page: Page): Locator => sidebar(page).locator('[data-section="run"] ui-item-state');
const releaseButtons = (page: Page): Locator => sidebar(page).locator('[data-release]');
const gridRelease = (page: Page): Locator => sidebar(page).locator('[data-section="actions"] [data-release]');

/** Waits until every running transition and animation (the panel sliding in, the rail widening) has finished. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
}

/** Opens `url`, marks the window and counts every document request, `load` event and release POST from then on. */
async function watch(page: Page, url: string): Promise<{ releases: string[]; noReload: () => Promise<void> }> {
  const documents: string[] = [];
  const releases: string[] = [];
  let loads = 0;
  await page.goto(url);
  await page.evaluate((key) => Object.assign(window, { [key]: true }), MARKER);
  page.on('request', (req: Request) => {
    if (req.resourceType() === 'document') documents.push(req.url());
    if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith(RELEASE_PATH)) releases.push(req.url());
  });
  page.on('load', () => {
    loads += 1;
  });
  return {
    releases,
    noReload: async () => {
      expect(documents).toEqual([]);
      expect(loads).toBe(0);
      expect(await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], MARKER)).toBe(true);
    },
  };
}

/** Chooses `ref` through `link` and waits for the sidebar in `presentation`. */
async function choose(page: Page, link: Locator, ref: string, presentation: string): Promise<void> {
  await link.click();
  await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(ref);
  await expect(sidebar(page)).toHaveAttribute('data-presentation', presentation);
  await settle(page);
}

/** The open run: the run line reads running and "Release run" stands exactly once, in the action grid. */
async function expectOpenRun(page: Page): Promise<void> {
  await expect(runLine(page)).toHaveAttribute('data-state', 'running');
  await expect(gridRelease(page)).toHaveCount(1);
  await expect(gridRelease(page)).toHaveText(/Release run/);
  await expect(releaseButtons(page)).toHaveCount(1);
}

/** Releases the open run from the sidebar: confirmation with the focus on "Keep", then one POST, then the run is gone. */
async function releaseFromSidebar(page: Page, releases: string[]): Promise<void> {
  const button = gridRelease(page);
  expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  await button.click();
  const dialog = page.locator('[data-release-dialog]');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-release-keep]')).toBeFocused();
  const released = page.waitForResponse((r) => new URL(r.url()).pathname.endsWith(RELEASE_PATH) && r.request().method() === 'POST');
  await dialog.locator('[data-release-confirm]').click();
  expect((await released).status()).toBe(200);
  await expect(dialog).toBeHidden();
  await expect(runLine(page)).toHaveCount(0);
  await expect(releaseButtons(page)).toHaveCount(0);
  await expect(sidebar(page).locator('[data-part="title"]')).toBeVisible();
  expect(releases, 'exactly one release POST').toHaveLength(1);
}

let session = '';
test.use({ clockAt: STUB_NOW });
test.beforeEach(async ({ page, request }, info) => {
  session = `sidebar-release-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [LOCKS_HEADER]: 'runs', [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

test.describe(`sidebar release run at ${String(WIDTHS.desktop)}`, () => {
  test.use(atWidth(WIDTHS.desktop));

  test(`release run: the docked sidebar of the running ${SPEC} releases it from the action grid, one POST, the run leaves without a reload (T31, ISC-534)`, async ({ page }) => {
    const { releases, noReload } = await watch(page, `/w/${WS}/specs`);
    await choose(page, page.locator(`a.row-link[data-ref="spec:${SPEC}"]`), `spec:${SPEC}`, 'docked');
    await expectOpenRun(page);
    await releaseFromSidebar(page, releases);
    await noReload();
  });

  test(`release run: the docked sidebar of the running idea ${IDEA} offers the release in its action grid (T31, ISC-534)`, async ({ page }) => {
    await watch(page, `/w/${WS}/specs?stage=idea`);
    await choose(page, page.locator(`app-spec-table app-idea-row[data-idea="${IDEA}"] a.link`), `idea:${IDEA}`, 'docked');
    await expectOpenRun(page);
  });
});

test.describe(`sidebar release run at ${String(WIDTHS.phone)}`, () => {
  test.use(atWidth(WIDTHS.phone));

  test(`release run: the sheet of the running ${SPEC} releases it from the action grid, one POST, the run leaves without a reload (T31, ISC-534)`, async ({ page }) => {
    const { releases, noReload } = await watch(page, `/w/${WS}/specs`);
    await choose(page, page.locator(`a.row-link[data-ref="spec:${SPEC}"]`), `spec:${SPEC}`, 'sheet');
    await expectOpenRun(page);
    await releaseFromSidebar(page, releases);
    await noReload();
  });
});
