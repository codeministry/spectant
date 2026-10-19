/**
 * T25 · ISC-232 (spec 015): every task with agent steps shows its timeline on the Tasks tab and in the live board's
 * card detail, and its board card names the latest step. `bun run e2e -- steps -g timeline` is the probe.
 *
 * The oracle is core's steps golden for harbor 002 (`core/fixtures/harbor.steps.golden.json`, tasks T4, T25, T26 and
 * T28, every step kind across them, claim releases on T4 and T25), which the stub serves on the live and tasks
 * answers. Each step must show its word (`steps.kind.*` of `en.json`), its clock with seconds and the span since the
 * previous step (the first reads `—`); the claim release must read differently from the run release of spec 040.
 *
 * The browser runs in UTC, so a step's clock is the golden's own `HH:MM:SS`. Each test takes a fresh stub session, so
 * no remembered board query (a past frame, the `step` density, both of which hide the card's step line) leaks in.
 *
 * T30 · ISC-233: a new step reaches an open page over the live stream within 2 s, without a reload. The stub's
 * `POST /api/__stub/step` stands in for a `probe` line appended to `.spectant/activity.jsonl`: it adds the step to the
 * session's live and tasks answers and pushes one `update` frame to the session's open streams before its 204.
 * `bun run e2e -- steps -g live` is the probe.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { TaskStep } from '../../core/src/files.ts';
import { atWidth, expect, test } from './fixtures';
import { RESET_PATH, SESSION_HEADER, STEP_PATH, STUB_NOW } from './stub-api';

const SPEC = 'specs/002-web-console';
const BOARD = '/w/harbor/s/002/board';
const TASKS = '/w/harbor/s/002/tasks';
/** The card detail lists the last eight steps; the Tasks tab holds them all (spec 015). */
const DETAIL_STEPS = 8;

const STEPS = (JSON.parse(readFileSync(new URL('../../core/fixtures/harbor.steps.golden.json', import.meta.url), 'utf8')) as Record<string, Record<string, TaskStep[]>>)[SPEC];
if (STEPS === undefined) throw new Error(`the steps golden holds no ${SPEC}`);
const TIMELINES: Readonly<Record<string, readonly TaskStep[]>> = STEPS;
const WITH_STEPS = Object.keys(TIMELINES);

interface En {
  readonly steps: { readonly kind: Readonly<Record<string, string>> };
  readonly itemState: { readonly release: { readonly released: string } };
}
const EN = JSON.parse(readFileSync(new URL('../src/i18n/en.json', import.meta.url), 'utf8')) as En;

/** The word key a step reads as: a probe follows its result. */
function wordKey(step: TaskStep): string {
  if (step.kind !== 'probe') return step.kind;
  if (step.result === 'red') return 'probeRed';
  if (step.result === 'green') return 'probeGreen';
  return 'probe';
}

function wordOf(step: TaskStep): string {
  const word = EN.steps.kind[wordKey(step)];
  if (word === undefined) throw new Error(`en.json names no step word for ${wordKey(step)}`);
  return word;
}

/** The span since the previous step at the precision its size needs: `+45 s`, `+2 min 5 s`, `+12 min`, `+1 h 12 min`. */
function deltaOf(steps: readonly TaskStep[], i: number): string {
  const previous = steps[i - 1];
  const step = steps[i];
  if (previous === undefined || step === undefined) return '—';
  const seconds = Math.max(0, Math.floor((Date.parse(step.ts) - Date.parse(previous.ts)) / 1000));
  const minutes = Math.floor(seconds / 60);
  const parts: Array<[number, string]> =
    seconds < 60
      ? [[seconds, 's']]
      : minutes < 10
        ? [[minutes, 'min'], [seconds % 60, 's']]
        : minutes < 60
          ? [[minutes, 'min']]
          : [[Math.floor(minutes / 60), 'h'], [minutes % 60, 'min']];
  return `+${parts
    .filter(([value], j) => j === 0 || value > 0)
    .map(([value, unit]) => `${value} ${unit}`)
    .join(' ')}`;
}

/** `HH:MM:SS` of a step in UTC, the browser's zone here. */
const clockSeconds = (ts: string): string => ts.slice(11, 19);
/** The card's short clock in the app language: `HH:MM`, English with its 12-hour form (`9:58 AM`), never seconds. */
function clock(ts: string): RegExp {
  const hour = Number(ts.slice(11, 13));
  const minute = ts.slice(14, 16);
  return new RegExp(`^(0?${String(hour)}|${String(hour % 12 || 12)}):${minute}(\\s*[AP]M)?$`);
}

/** The steps a timeline lists: kind, result, word, clock, delta, latest mark and question, in order. */
async function expectTimeline(timeline: Locator, steps: readonly TaskStep[], all: readonly TaskStep[]): Promise<void> {
  const rows = timeline.locator(':scope > li[data-step-kind]');
  await expect(rows).toHaveCount(steps.length);
  const offset = all.length - steps.length;
  for (const [i, step] of steps.entries()) {
    const row = rows.nth(i);
    await expect(row).toHaveAttribute('data-step-kind', step.kind);
    if (step.result === undefined) await expect(row).not.toHaveAttribute('data-step-result', /.*/);
    else await expect(row).toHaveAttribute('data-step-result', step.result);
    if (i === steps.length - 1) await expect(row).toHaveAttribute('data-step-latest', '');
    else await expect(row).not.toHaveAttribute('data-step-latest', /.*/);
    await expect(row.locator('[data-step-word]')).toHaveText(wordOf(step));
    await expect(row.locator('[data-step-time]')).toHaveText(clockSeconds(step.ts));
    await expect(row.locator('[data-step-time] time')).toHaveAttribute('datetime', step.ts);
    await expect(row.locator('[data-step-delta]')).toHaveText(i === 0 ? '—' : deltaOf(all, offset + i));
    if (step.text === undefined) await expect(row.locator('[data-step-question]')).toHaveCount(0);
    else await expect(row.locator('[data-step-question]')).toHaveText(step.text);
  }
}

/** The two release words differ, and every claim release on screen reads the claim's word, never the run's. */
async function expectReleasesApart(page: Page): Promise<void> {
  expect(EN.steps.kind['release']).toBeDefined();
  expect(EN.steps.kind['release']).not.toBe(EN.itemState.release.released);
  const releases = page.locator('[data-step-timeline] > li[data-step-kind="release"] [data-step-word]');
  expect(await releases.count()).toBeGreaterThan(0);
  for (const word of await releases.all()) {
    await expect(word).toHaveText(EN.steps.kind['release'] ?? '');
    await expect(word).not.toHaveText(EN.itemState.release.released);
  }
}

test.beforeEach(async ({ page, request }, info) => {
  const session = `agent-steps-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  expect((await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } })).status()).toBe(204);
});

test.afterEach(async ({ request }, info) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: `agent-steps-${info.testId}` } });
});

for (const width of [1440, 390] as const) {
  test.describe(`agent steps at ${width}`, () => {
    test.use({ ...atWidth(width), timezoneId: 'UTC', clockAt: STUB_NOW });

    test(`timeline: the tasks tab shows every step kind with its time and the span since the previous step (${width})`, async ({ page }) => {
      expect(WITH_STEPS.length).toBeGreaterThan(0);
      await page.goto(`${TASKS}?steps=T26`);

      // Every row with steps has a toggle naming its latest step; only the row ?steps= names is open.
      for (const task of WITH_STEPS) {
        const steps = TIMELINES[task] ?? [];
        const latest = steps.at(-1);
        if (latest === undefined) continue;
        const toggle = page.locator(`#task-${task}[data-task-row] [data-steps-toggle]`);
        await expect(toggle).toHaveAttribute('aria-expanded', task === 'T26' ? 'true' : 'false');
        await expect(toggle.locator('[data-step-latest]')).toHaveAttribute('data-step-kind', latest.kind);
        await expect(toggle.locator('[data-step-latest]')).toHaveText(wordOf(latest));
        await expect(toggle.locator('time')).toHaveText(clockSeconds(latest.ts));
        await expect(toggle.locator('[data-steps-count]')).toHaveText(steps.length === 1 ? '1 step' : `${steps.length} steps`);
      }
      await expect(page.locator('[data-steps]')).toHaveCount(1);
      await expect(page.locator('[data-steps]#task-T26-steps')).toBeVisible();

      // The other rows open on their own toggle; then every task's whole timeline is on screen.
      for (const task of WITH_STEPS.filter((t) => t !== 'T26')) {
        const toggle = page.locator(`#task-${task}[data-task-row] [data-steps-toggle]`);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      }
      for (const task of WITH_STEPS) {
        const panel = page.locator(`[data-steps]#task-${task}-steps`);
        await expect(panel).toBeVisible();
        const steps = TIMELINES[task] ?? [];
        await expectTimeline(panel.locator('[data-step-timeline]'), steps, steps);
      }

      // Every kind harbor's steps hold is on screen, a probe both red and green.
      const kinds = new Set(Object.values(TIMELINES).flatMap((steps) => steps.map(wordKey)));
      for (const key of ['dispatch', 'build', 'probeRed', 'probeGreen', 'question', 'patch', 'apply', 'release']) expect(kinds).toContain(key);
      const shown = await page.locator('[data-step-timeline] > li[data-step-kind]').evaluateAll((lis) =>
        lis.map((li) => `${li.getAttribute('data-step-kind') ?? ''}:${li.getAttribute('data-step-result') ?? ''}`),
      );
      expect(new Set(shown)).toEqual(new Set(Object.values(TIMELINES).flatMap((steps) => steps.map((s) => `${s.kind}:${s.result ?? ''}`))));
      await expectReleasesApart(page);
    });

    test(`timeline: the live board card names its latest step and its detail shows the timeline (${width})`, async ({ page }) => {
      await page.goto(BOARD);
      await expect(page.locator('app-board-tab article[data-card]').first()).toBeAttached();

      const onBoard: string[] = [];
      for (const task of WITH_STEPS) {
        const card = page.locator(`app-board-tab article[data-card="${task}"]`);
        if ((await card.count()) === 0) continue;
        onBoard.push(task);
        const latest = (TIMELINES[task] ?? []).at(-1);
        if (latest === undefined) continue;
        const line = card.locator('[data-card-latest-step]');
        await expect(line).toHaveCount(1);
        await expect(line).toHaveAttribute('data-step-kind', latest.kind);
        if (latest.result === undefined) await expect(line).not.toHaveAttribute('data-step-result', /.*/);
        else await expect(line).toHaveAttribute('data-step-result', latest.result);
        await expect(line.locator('[data-step-word]')).toHaveText(wordOf(latest));
        await expect(line.locator('[data-step-time]')).toHaveText(clock(latest.ts));
        await expect(line.locator('[data-step-time] time')).toHaveAttribute('datetime', latest.ts);
      }
      // T26 holds every kind but the release; T25 holds a claim release.
      expect(onBoard).toEqual(expect.arrayContaining(['T26', 'T25']));
      // A card without steps names none.
      await expect(page.locator('app-board-tab article[data-card] [data-card-latest-step]')).toHaveCount(onBoard.length);

      for (const task of ['T26', 'T25']) {
        const all = TIMELINES[task] ?? [];
        const id = page.locator(`app-board-tab article[data-card="${task}"] button.id`);
        if (!(await id.isVisible())) {
          const lane = await page.locator(`app-board-tab [data-lane]:has(article[data-card="${task}"])`).first().getAttribute('data-lane');
          await page.locator(`app-board-tab [data-lane="${lane ?? ''}"] [data-show-all]`).click();
        }
        await id.click();
        const detail = page.locator(`dialog[open] [data-card-detail][data-task="${task}"]`);
        await expect(detail).toBeVisible();
        if (width === 390) await expect(page.locator('ui-dialog[data-fullscreen]:has([data-card-detail])')).toHaveCount(1);
        const section = detail.locator('[data-detail-steps]');
        await expect(section.locator('[data-detail-steps-count]')).toHaveText(String(all.length));
        await expect(section.locator('a[data-detail-steps-more]')).toHaveCount(all.length > DETAIL_STEPS ? 1 : 0);
        await expectTimeline(section.locator('[data-step-timeline]'), all.slice(-DETAIL_STEPS), all);
        if (task === 'T25') await expectReleasesApart(page);
        await page.keyboard.press('Escape');
        await expect(page.locator('dialog[open] [data-card-detail]')).toHaveCount(0);
      }
    });
  });
}

/** ISC-233: the claim's bound from the moment the line is appended (the stub's POST) to the step on screen. */
const LIVE_BOUND_MS = 2000;
/** The task the live tests append to: on the board at 1440, its latest golden step an `apply`, not a red probe. */
const LIVE_TASK = 'T26';
const RED_PROBE: TaskStep = { kind: 'probe', result: 'red', ts: '', actor: '' };

/**
 * Opens `path` with the live stream connected and a marker on `window` that a reload would wipe, and counts every
 * document request after the first load; the returned check proves the page was neither reloaded nor navigated away.
 */
async function openLive(page: Page, path: string): Promise<() => Promise<void>> {
  const stream = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/events' && res.status() === 200);
  await page.goto(path);
  await stream;
  await page.evaluate(() => Object.assign(window, { spectantNoReload: true }));
  const documents: string[] = [];
  page.on('request', (req) => {
    if (req.resourceType() === 'document') documents.push(req.url());
  });
  return async () => {
    expect(documents).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { spectantNoReload?: boolean }).spectantNoReload)).toBe(true);
  };
}

/** Appends a red probe on `LIVE_TASK` through the stub, as an agent's activity line would; returns when it was sent. */
async function appendRedProbe(page: Page): Promise<number> {
  const session = `agent-steps-${test.info().testId}`;
  const sent = Date.now();
  const res = await page.request.post(`${STEP_PATH}?ws=harbor&spec=002&task=${LIVE_TASK}&kind=probe&result=red`, { headers: { [SESSION_HEADER]: session } });
  expect(res.status()).toBe(204);
  return sent;
}

test.describe('agent steps live at 1440', () => {
  test.use({ ...atWidth(1440), timezoneId: 'UTC', clockAt: STUB_NOW });

  test(`live: a new probe step appears in the tasks tab within ${LIVE_BOUND_MS} ms without reload`, async ({ page }) => {
    const before = TIMELINES[LIVE_TASK] ?? [];
    expect(before.at(-1)?.kind).not.toBe('probe');
    const noReload = await openLive(page, `${TASKS}?steps=${LIVE_TASK}`);
    const toggle = page.locator(`#task-${LIVE_TASK}[data-task-row] [data-steps-toggle]`);
    const rows = page.locator(`[data-steps]#task-${LIVE_TASK}-steps [data-step-timeline] > li[data-step-kind]`);
    await expect(rows).toHaveCount(before.length);
    await expect(toggle.locator('[data-step-latest]')).toHaveAttribute('data-step-kind', before.at(-1)?.kind ?? '');

    const sent = await appendRedProbe(page);
    const latest = toggle.locator('[data-step-latest][data-step-kind="probe"][data-step-result="red"]');
    await expect(latest).toBeVisible({ timeout: LIVE_BOUND_MS });
    const elapsed = Date.now() - sent;
    await expect(latest).toHaveText(wordOf(RED_PROBE));
    await expect(toggle.locator('[data-steps-count]')).toHaveText(`${before.length + 1} steps`);
    await expect(rows).toHaveCount(before.length + 1);
    await expect(rows.last()).toHaveAttribute('data-step-kind', 'probe');
    await expect(rows.last()).toHaveAttribute('data-step-result', 'red');
    await expect(rows.last()).toHaveAttribute('data-step-latest', '');
    await expect(rows.last().locator('[data-step-word]')).toHaveText(wordOf(RED_PROBE));
    expect(elapsed).toBeLessThanOrEqual(LIVE_BOUND_MS);
    test.info().annotations.push({ type: 'elapsed-ms', description: String(elapsed) });
    await noReload();
  });

  test(`live: a new probe step appears on the live board card within ${LIVE_BOUND_MS} ms without reload`, async ({ page }) => {
    const before = TIMELINES[LIVE_TASK] ?? [];
    const noReload = await openLive(page, BOARD);
    const line = page.locator(`app-board-tab article[data-card="${LIVE_TASK}"] [data-card-latest-step]`);
    await expect(line).toBeAttached();
    if (!(await line.isVisible())) {
      // The card sits below its lane's cut; "show all" brings it on screen, as the timeline test does.
      const lane = await page.locator(`app-board-tab [data-lane]:has(article[data-card="${LIVE_TASK}"])`).first().getAttribute('data-lane');
      await page.locator(`app-board-tab [data-lane="${lane ?? ''}"] [data-show-all]`).click();
    }
    await expect(line).toBeVisible();
    await expect(line).toHaveAttribute('data-step-kind', before.at(-1)?.kind ?? '');

    const sent = await appendRedProbe(page);
    const latest = page.locator(`app-board-tab article[data-card="${LIVE_TASK}"] [data-card-latest-step][data-step-kind="probe"][data-step-result="red"]`);
    await expect(latest).toBeVisible({ timeout: LIVE_BOUND_MS });
    const elapsed = Date.now() - sent;
    await expect(latest.locator('[data-step-word]')).toHaveText(wordOf(RED_PROBE));
    await expect(line).toHaveCount(1);
    expect(elapsed).toBeLessThanOrEqual(LIVE_BOUND_MS);
    test.info().annotations.push({ type: 'elapsed-ms', description: String(elapsed) });
    await noReload();
  });
});
