/**
 * Spec 067 · T34 · ISC-535 (`bun run e2e -- sidebar -g "task check"`): the detail sidebar of a spec lists its open
 * tasks, the sidebar of a claim the open tasks anchored on it, each with a checkbox. At most five rows show; more open
 * tasks add "+N more" to the spec's Tasks tab. A tick goes through write path 2, exactly one
 * `POST …/specs/002/tasks/<T>/check`, and the box shows ticked without a reload (no document request, one marker on
 * `window` survives).
 *
 * Fixtures (web/CLAUDE.md § "Driving the detail sidebar"): harbor 002's T28 (ISC-75) is open and no lock holds its
 * claim; T27 (ISC-74) is held by `a:claude:sess-2` under the default locks, which the planning tree names as the claim's
 * lock holder. The stub answers a tick 423 only under `X-Spectant-Stub-Write: locked`. One stub session per test, reset
 * before and after (ticks live per session).
 */
import type { Locator, Page, Request } from '@playwright/test';
import { atWidth, expect, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const WS = 'harbor';
const SPEC = '002';
const CAP = 5;
const MARKER = '__sidebarTasksNoReload';
const CHECK = new RegExp(`/api/workspaces/${WS}/specs/${SPEC}/tasks/(T\\d+)/check$`, 'u');

let session = '';

const sidebar = (page: Page): Locator => page.locator('app-detail-sidebar[data-presentation]');
const section = (page: Page): Locator => sidebar(page).locator('section[data-section="tasks"]');
const row = (page: Page, task: string): Locator => section(page).locator(`[data-task="${task}"]`);
const box = (page: Page, task: string): Locator => row(page, task).locator('input[data-task-check]');

/** Every tick the page sends, by task id, and a check that no document was requested since the first navigation. */
interface Watch {
  readonly ticks: (task: string) => number;
  readonly noReload: () => Promise<void>;
}

/** Opens `url` and from then on records every tick POST, document request and `load` event. */
async function watch(page: Page, url: string): Promise<Watch> {
  const posts: string[] = [];
  const documents: string[] = [];
  let loads = 0;
  await page.goto(url);
  await page.evaluate((key) => Object.assign(window, { [key]: true }), MARKER);
  page.on('request', (req: Request) => {
    if (req.resourceType() === 'document') documents.push(req.url());
    const hit = req.method() === 'POST' ? CHECK.exec(new URL(req.url()).pathname) : null;
    if (hit?.[1]) posts.push(hit[1]);
  });
  page.on('load', () => {
    loads += 1;
  });
  return {
    ticks: (task) => posts.filter((id) => id === task).length,
    noReload: async () => {
      expect(documents).toEqual([]);
      expect(loads).toBe(0);
      expect(await page.evaluate((key) => (window as unknown as Record<string, unknown>)[key], MARKER)).toBe(true);
    },
  };
}

/** One task of the tasks route, the fields this suite reads. */
interface TaskRow {
  readonly id: string;
  readonly claim: string;
  readonly state: string;
}
type OpenTask = Omit<TaskRow, 'state'>;

/** The open tasks of harbor 002 as the tasks route reads them for this session, in file order. */
async function openTasks(page: Page): Promise<readonly OpenTask[]> {
  const res = await page.request.get(`/api/workspaces/${WS}/specs/${SPEC}/tasks`, { headers: { [SESSION_HEADER]: session } });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { tasks: readonly TaskRow[] };
  return body.tasks.filter((t) => t.state === 'open').map(({ id, claim }) => ({ id, claim }));
}

/** Ticks `task` and waits for the tick's answer; the box then shows ticked in place. */
async function tick(page: Page, task: string): Promise<number> {
  const answer = page.waitForResponse((res) => res.request().method() === 'POST' && CHECK.exec(new URL(res.url()).pathname)?.[1] === task);
  await box(page, task).click();
  return (await answer).status();
}

/** Waits until the sheet's slide-in has finished, so a measured row is not caught mid-transform. */
async function settle(page: Page): Promise<void> {
  await page.evaluate(() => Promise.allSettled(document.getAnimations().map((animation) => animation.finished)));
}

/** One frame after the last input, so a write the page would still send has been sent. */
async function nextFrame(page: Page): Promise<void> {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function chooseSpec(page: Page, presentation: string): Promise<void> {
  await page.locator(`a.row-link[data-ref="spec:${SPEC}"]`).click();
  await expect.poll(() => new URL(page.url()).searchParams.get('sel')).toBe(`spec:${SPEC}`);
  await expect(sidebar(page)).toHaveAttribute('data-presentation', presentation);
  await expect(section(page)).toBeVisible();
}

test.beforeEach(async ({ page, request }, info) => {
  session = `sidebar-tasks-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

test.describe(`sidebar task check at ${String(WIDTHS.desktop)}`, () => {
  test.use(atWidth(WIDTHS.desktop));

  test('sidebar task check: a spec lists its open tasks, five at most, and a tick writes one line and shows without a reload (T34, ISC-535)', async ({ page }) => {
    const open = await openTasks(page);
    expect(open.map((t) => t.id)).toContain('T28');
    const seen = await watch(page, `/w/${WS}/specs`);
    await chooseSpec(page, 'docked');

    const rows = section(page).locator('[data-task]');
    await expect(rows).toHaveCount(Math.min(open.length, CAP));
    expect(await rows.evaluateAll((els) => els.map((el) => el.getAttribute('data-task')))).toEqual(open.slice(0, CAP).map((t) => t.id));
    for (const id of open.slice(0, CAP).map((t) => t.id)) await expect(box(page, id)).not.toBeChecked();
    const more = section(page).locator('a[data-tasks-more]');
    if (open.length > CAP) await expect(more).toHaveAttribute('href', `/w/${WS}/s/${SPEC}/tasks`);
    else await expect(more).toHaveCount(0);

    expect(await tick(page, 'T28')).toBe(200);
    await expect(box(page, 'T28')).toBeChecked();
    await expect(row(page, 'T28')).toHaveAttribute('data-check', 'written');
    await nextFrame(page);
    expect(seen.ticks('T28')).toBe(1);
    await seen.noReload();
  });

  test('sidebar task check: a claim lists the open tasks anchored on it and a tick writes one line and shows without a reload (T34, ISC-535)', async ({ page }) => {
    const anchored = (await openTasks(page)).filter((t) => t.claim === 'ISC-75').map((t) => t.id);
    expect(anchored).toEqual(['T28']);
    const seen = await watch(page, `/w/${WS}/planning/tree?sel=claim:ISC-75`);
    await expect(sidebar(page)).toHaveAttribute('data-presentation', 'docked');
    await expect(section(page)).toBeVisible();
    await expect(section(page).locator('[data-task]')).toHaveCount(anchored.length);
    await expect(box(page, 'T28')).not.toBeChecked();

    expect(await tick(page, 'T28')).toBe(200);
    await expect(box(page, 'T28')).toBeChecked();
    await nextFrame(page);
    expect(seen.ticks('T28')).toBe(1);
    await seen.noReload();
  });

  test('sidebar task check: a held claim locks its task box and a click writes nothing (T34, ISC-535)', async ({ page }) => {
    const seen = await watch(page, `/w/${WS}/planning/tree?sel=claim:ISC-74`);
    await expect(section(page)).toBeVisible();
    await expect(section(page).locator('[data-task]')).toHaveCount(1);
    await expect(box(page, 'T27')).toBeDisabled();
    await expect(row(page, 'T27').locator('[data-check-locked]')).toContainText('sess-2');

    await box(page, 'T27').click({ force: true });
    await nextFrame(page);
    await expect(box(page, 'T27')).not.toBeChecked();
    expect(seen.ticks('T27')).toBe(0);
    await seen.noReload();
  });

  test('sidebar task check: a tick the server refuses as locked shows the lock inline, unticked, after one write (T34, ISC-535)', async ({ page }) => {
    await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session, 'X-Spectant-Stub-Write': 'locked' });
    const seen = await watch(page, `/w/${WS}/specs`);
    await chooseSpec(page, 'docked');

    expect(await tick(page, 'T27')).toBe(423);
    await expect(row(page, 'T27').locator('[data-check-locked]')).toContainText('sess-2');
    await expect(box(page, 'T27')).not.toBeChecked();
    await nextFrame(page);
    expect(seen.ticks('T27')).toBe(1);
    await seen.noReload();
  });
});

test.describe(`sidebar task check at ${String(WIDTHS.phone)}`, () => {
  test.use(atWidth(WIDTHS.phone));

  test('sidebar task check: the sheet lists the open tasks in rows of 44 px and a tick writes one line (T34, ISC-535)', async ({ page }) => {
    const seen = await watch(page, `/w/${WS}/specs`);
    await chooseSpec(page, 'sheet');

    const hits = section(page).locator('[data-task] label');
    await expect(hits.first()).toBeVisible();
    await settle(page);
    const heights = await hits.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) expect(Math.round(height)).toBeGreaterThanOrEqual(44);

    await row(page, 'T28').scrollIntoViewIfNeeded();
    expect(await tick(page, 'T28')).toBe(200);
    await expect(box(page, 'T28')).toBeChecked();
    await nextFrame(page);
    expect(seen.ticks('T28')).toBe(1);
    await seen.noReload();
  });
});
