/**
 * Spec 065 (live refresh in place) against the stub API, at 1440 px. Every page that renders live data takes a change
 * where it stands: through the live stream (`/api/events`) within 2 s, and through the fallback poll while the stream
 * is refused, without a reload, without falling back to its loading state and without swapping its main block.
 *
 * - `bun run e2e -- live-in-place -g "overview live"` (ISC-514): `/` open, the stream connected; a stub lock on harbor
 *   003 (`POST /api/__stub/lock`) puts the 003 tile into the "In progress" block of harbor's column within 2 s.
 * - `bun run e2e -- live-in-place -g "pages live"` (ISC-515): the same on `/w/harbor` (the "In progress" tile), on
 *   `/w/harbor/specs` (003's agent dot) and on the spec page (a red probe step on 002 T26 in the tasks tab).
 * - `bun run e2e -- live-in-place -g "no reload"` (ISC-513): on each of the four pages, once through the stream and
 *   once through the fallback poll (Playwright's clock, past one 60 s period), no skeleton, `aria-busy` block or
 *   loading note is added after the first render, and the main block is the same DOM node before and after.
 *
 * Every case proves "no reload" with a marker on `window` and no `document` request after the first load.
 */
import type { Locator, Page } from '@playwright/test';

import { atWidth, expect, test } from './fixtures';
import { LOCK_PATH, RESET_PATH, SESSION_HEADER, STEP_PATH } from './stub-api';

/** ISC-514, ISC-515: a change reaches an open page within 2 s. */
const LIVE_BUDGET_MS = 2_000;
/** One fallback poll period (`FALLBACK_POLL_MS`, 60 s) and a second to spare. */
const PAST_ONE_POLL_MS = 61_000;
const EVENTS = '/api/events';
/** The workspace list (`WORKSPACES_URL`). */
const WORKSPACES = '/api/workspaces';
/** The claim the lock cases take: 003 is the only harbor spec with open claims outside the lock fixture. */
const LOCK = { spec: '003', claim: 'ISC-81', session: 'a:claude:stub-live' } as const;
/** The task the step case appends to (the one `agent-steps.spec.ts` uses). */
const STEP_TASK = 'T26';

/** What a page shows, how a change arrives on it, and where it shows. */
interface LivePage {
  readonly name: string;
  readonly path: string;
  /** The block that must stay the same node. */
  readonly main: (page: Page) => Locator;
  /** Makes the change in the stub, under the test's session. */
  readonly change: (page: Page, headers: Record<string, string>) => Promise<void>;
  /** The change, visible. */
  readonly changed: (page: Page) => Locator;
  /** Serve the workspace list with new counts on every read, as a closed claim or a new spec changes it. */
  readonly listMoves?: boolean;
}

const lock = async (page: Page, headers: Record<string, string>): Promise<void> => {
  expect((await page.request.post(`${LOCK_PATH}?ws=harbor`, { headers, data: LOCK })).status()).toBe(204);
};
const step = async (page: Page, headers: Record<string, string>): Promise<void> => {
  const query = `ws=harbor&spec=002&task=${STEP_TASK}&kind=probe&result=red`;
  expect((await page.request.post(`${STEP_PATH}?${query}`, { headers })).status()).toBe(204);
};

const OVERVIEW: LivePage = {
  name: 'overview',
  path: '/',
  main: (page) => page.locator('[data-ui="workspace-column"][data-ws="harbor"]'),
  change: lock,
  listMoves: true,
  changed: (page) => page.locator('[data-ui="workspace-column"][data-ws="harbor"] ui-working-block ui-flat-tile [data-id]', { hasText: LOCK.spec }),
};
const PAGES: readonly LivePage[] = [
  {
    name: 'dashboard',
    path: '/w/harbor',
    main: (page) => page.locator('[data-lists]'),
    change: lock,
    changed: (page) => page.locator('ui-working-block ui-flat-tile [data-id]', { hasText: LOCK.spec }),
  },
  {
    name: 'specs list',
    path: '/w/harbor/specs',
    main: (page) => page.locator('app-spec-table'),
    change: lock,
    changed: (page) => page.locator(`app-spec-row:has(a[data-spec-row="${LOCK.spec}"]) [data-cell="agent"] ui-agent-dot`),
  },
  {
    name: 'spec page',
    path: `/w/harbor/s/002/tasks?steps=${STEP_TASK}`,
    main: (page) => page.locator(`#task-${STEP_TASK}[data-task-row]`),
    change: step,
    changed: (page) => page.locator(`#task-${STEP_TASK}[data-task-row] [data-steps-toggle] [data-step-latest][data-step-kind="probe"][data-step-result="red"]`),
  },
];

/**
 * Answers every read of the workspace list with new counts on each workspace: on disk a closed claim, a new spec or a
 * run line changes them, and no such list may send the overview's columns back to loading.
 */
async function moveList(page: Page): Promise<void> {
  let reads = 0;
  await page.route(
    (url) => url.pathname === WORKSPACES,
    async (route) => {
      const headers = { ...route.request().headers() };
      delete headers['if-none-match'];
      const res = await route.fetch({ headers });
      const list = (await res.json()) as Array<Record<string, unknown>>;
      reads += 1;
      const moved = list.map((entry) => ({ ...entry, counts: { ...(entry['counts'] as object), read: reads } }));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(moved) });
    },
  );
}

type Probe = Window & { spectantNoReload?: boolean; spectantMain?: Element | null; spectantLoading?: string[] };

/**
 * Gives the page its own stub session, opens `live.path`, waits for its main block, then arms the checks: a marker on
 * `window`, a count of document requests, the main block's node, and an observer that records every skeleton,
 * `aria-busy` block or loading note added from here on. The returned check runs them.
 */
async function open(page: Page, live: LivePage, session: string, stream: boolean): Promise<{ headers: Record<string, string>; check: () => Promise<void> }> {
  const headers = { [SESSION_HEADER]: session };
  await page.context().setExtraHTTPHeaders(headers);
  expect((await page.request.post(RESET_PATH, { headers })).status()).toBe(204);
  if (live.listMoves === true) await moveList(page);
  const connected = stream ? page.waitForResponse((res) => new URL(res.url()).pathname === EVENTS && res.status() === 200) : null;
  await page.goto(live.path);
  await connected;
  const main = live.main(page);
  await expect(main).toBeVisible();
  await expect(page.locator('ui-skeleton, [aria-busy="true"], .loading-note')).toHaveCount(0);
  await main.evaluate((el) => {
    const probe = window as Probe;
    probe.spectantNoReload = true;
    probe.spectantMain = el;
    probe.spectantLoading = [];
    const loading = 'ui-skeleton, [aria-busy="true"], .loading-note';
    new MutationObserver((records) => {
      for (const record of records) {
        const nodes = record.type === 'attributes' ? [record.target] : [...record.addedNodes];
        for (const node of nodes) {
          if (!(node instanceof Element)) continue;
          const hit = node.matches(loading) ? node : node.querySelector(loading);
          if (hit) probe.spectantLoading?.push(hit.outerHTML.slice(0, 120));
        }
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy'] });
  });
  const documents: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documents.push(req.url());
  });
  return {
    headers,
    check: async () => {
      expect(documents, 'no document request').toEqual([]);
      const state = await main.evaluate((el) => {
        const probe = window as Probe;
        return { marker: probe.spectantNoReload, same: probe.spectantMain === el, loading: probe.spectantLoading ?? [] };
      });
      expect(state.marker, 'the window marker survives').toBe(true);
      expect(state.loading, 'no loading state after the first render').toEqual([]);
      expect(state.same, 'the main block is the same node').toBe(true);
    },
  };
}

const session = (label: string): string => `live-in-place-${label}-${test.info().testId}-${String(test.info().retry)}`;

test.describe('live in place at 1440', () => {
  test.use({ ...atWidth(1440), clockAt: null });

  test.afterEach(async ({ request }, info) => {
    for (const label of ['stream', 'poll']) {
      await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: `live-in-place-${label}-${info.testId}-${String(info.retry)}` } });
    }
  });

  test(`overview live: a claim taken on harbor shows its tile in harbor's column within ${String(LIVE_BUDGET_MS)} ms, without reload`, async ({ page }) => {
    const { headers, check } = await open(page, OVERVIEW, session('stream'), true);
    await expect(OVERVIEW.changed(page)).toHaveCount(0);
    const sent = Date.now();
    await OVERVIEW.change(page, headers);
    await expect(OVERVIEW.changed(page)).toBeVisible({ timeout: LIVE_BUDGET_MS });
    expect(Date.now() - sent).toBeLessThanOrEqual(LIVE_BUDGET_MS);
    await check();
  });

  for (const live of PAGES) {
    test(`pages live: ${live.name} shows the change within ${String(LIVE_BUDGET_MS)} ms, without reload`, async ({ page }) => {
      const { headers, check } = await open(page, live, session('stream'), true);
      await expect(live.changed(page)).toHaveCount(0);
      const sent = Date.now();
      await live.change(page, headers);
      await expect(live.changed(page)).toBeVisible({ timeout: LIVE_BUDGET_MS });
      expect(Date.now() - sent).toBeLessThanOrEqual(LIVE_BUDGET_MS);
      await check();
    });
  }

  for (const live of [OVERVIEW, ...PAGES]) {
    test(`no reload: ${live.name} takes a streamed change in place, without a loading state`, async ({ page }) => {
      const { headers, check } = await open(page, live, session('stream'), true);
      await live.change(page, headers);
      await expect(live.changed(page)).toBeVisible({ timeout: LIVE_BUDGET_MS });
      await check();
    });

    test(`no reload: ${live.name} takes a polled change in place, without a loading state`, async ({ page }) => {
      // Refused before the first load, only the fallback poll can move the page (spec 053).
      await page.route(`**${EVENTS}`, (route) => route.fulfill({ status: 204 }));
      await page.clock.install();
      const { headers, check } = await open(page, live, session('poll'), false);
      await live.change(page, headers);
      await page.clock.fastForward(PAST_ONE_POLL_MS);
      await expect(live.changed(page)).toBeVisible();
      await check();
    });
  }
});
