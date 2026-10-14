/**
 * Who works a task on the live board and the tasks tab (T149, ISC-131.1), against the stub API:
 * `bun run e2e -- live -g subagents`.
 *
 * Every case reads harbor 002's live frame as the stub serves it under one lock fixture (`X-Spectant-Stub-Locks`,
 * `web/e2e/stub-api.ts` `lockFixtures`), with the browser clock pinned to the stub's `STUB_NOW` (the live goldens'
 * `ts`), so a lock is stale exactly when core's `LIVE_STALE_MS` (45 minutes) says so:
 *
 * - `activity` (the golden): T27 is worked by the agent `a:claude:sess-2`, no sub-agent, held since 14:06, so the agent
 *   chip carries the lock state: stale, "no release · 54 minutes ago".
 * - `frontier`: T28 is worked by the stub's frontier agent, held 20 minutes, so its chip carries the active dot.
 * - `claims`: harbor's activity claim lines without their releases (as `core/tests/live.test.ts`): T4 is worked by the
 *   sub-agent `a:claude:sess-2/T4` under its parent; both chips show, the sub-agent's with its task suffix and the lock
 *   state (stale since 2026-03-06 09:12, "2 days ago"), the agent's with none.
 * - `person`: the golden lock held by the person `u:3f9c0a7d`: T27 is in flight, and no agent chip shows.
 */
import type { Locator, Page } from '@playwright/test';

import { atWidth, expect, test } from './fixtures';
import { LOCKS_HEADER, STUB_NOW, STUB_PERSON, syntheticSession } from './stub-api';

const BOARD = '/w/harbor/s/002/board';
const TASKS = '/w/harbor/s/002/tasks';
const AGENT = 'a:claude:sess-2';
const FRONTIER_AGENT = syntheticSession('002', 'ISC-75');

/** The two places a task's workers show: under its card in flight or in the round (spec 027) on the board, and in its row on the tasks tab. */
const SURFACES = [
  { name: 'board', url: BOARD, actors: (page: Page, task: string): Locator => page.locator(`:is([data-section="inFlight"], [data-section="inRound"]) app-task-actors[data-task-actors="${task}"]`) },
  { name: 'tasks tab', url: TASKS, actors: (page: Page, task: string): Locator => page.locator(`#task-${task} app-task-actors[data-task-actors="${task}"]`) },
] as const;

/** Opens `url` and resolves once the live frame (`…/live`) has answered. */
async function openLive(page: Page, url: string): Promise<void> {
  const live = page.waitForResponse((res) => /\/live(\?|$)/.test(res.url()) && res.status() === 200);
  await page.goto(url);
  await live;
}

/**
 * An agent or sub-agent chip: its kind, the raw ref as its title, the agent session as its label (a sub-agent's is its
 * parent's) and, for a sub-agent only, the task suffix.
 */
async function expectChip(chip: Locator, raw: string): Promise<void> {
  const [session, task] = raw.split('/');
  await expect(chip).toHaveAttribute('data-kind', task === undefined ? 'agent' : 'subagent');
  await expect(chip).toHaveAttribute('title', raw);
  await expect(chip.locator('.label')).toHaveText(session ?? raw);
  await expect(chip.locator('.task')).toHaveText(task === undefined ? [] : [task]);
}

/** The lock state on a chip: stale with the label and its age, active with the dot, or none at all. */
async function expectLockState(chip: Locator, state: { stale: string } | 'active' | 'none'): Promise<void> {
  if (state === 'active') {
    await expect(chip).toHaveAttribute('data-active', '');
    await expect(chip).not.toHaveAttribute('data-stale', /.*/);
    await expect(chip.locator('.dot')).toHaveCount(1);
    await expect(chip.locator('.stale')).toHaveCount(0);
    await expect(chip).toContainText('lock active');
  } else if (state === 'none') {
    await expect(chip).not.toHaveAttribute('data-active', /.*/);
    await expect(chip).not.toHaveAttribute('data-stale', /.*/);
    await expect(chip.locator('.dot, .stale')).toHaveCount(0);
  } else {
    await expect(chip).toHaveAttribute('data-stale', '');
    await expect(chip).not.toHaveAttribute('data-active', /.*/);
    await expect(chip).toHaveAttribute('data-tone', 'warning');
    await expect(chip.locator('.stale')).toHaveText(`no release · ${state.stale}`);
  }
}

test.describe('subagents', () => {
  test.use({ ...atWidth(1440), clockAt: STUB_NOW });

  for (const surface of SURFACES) {
    test.describe(`subagents on the ${surface.name}`, () => {
      test.describe('activity locks', () => {
        test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'activity' } });

        test(`subagents: the task an agent works shows the agent chip, stale with its age (${surface.name})`, async ({ page }) => {
          await openLive(page, surface.url);
          const actors = surface.actors(page, 'T27');
          await expect(actors.locator('ui-actor-chip')).toHaveCount(1);
          const agent = actors.locator('ui-actor-chip[data-task-agent]');
          await expectChip(agent, AGENT);
          // 14:06 to 15:00 is 54 minutes, past LIVE_STALE_MS (45): the agent, the only holder, carries the stale label.
          await expectLockState(agent, { stale: '54 minutes ago' });
        });
      });

      test.describe('frontier locks', () => {
        test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'frontier' } });

        test(`subagents: a fresh lock shows the active dot on the agent chip (${surface.name})`, async ({ page }) => {
          await openLive(page, surface.url);
          const agent = surface.actors(page, 'T28').locator('ui-actor-chip[data-task-agent]');
          await expectChip(agent, FRONTIER_AGENT);
          // Held 20 minutes at STUB_NOW, under LIVE_STALE_MS: active, no stale label.
          await expectLockState(agent, 'active');
        });
      });

      test.describe('claim lines without releases', () => {
        test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'claims' } });

        test(`subagents: the task a sub-agent works shows both chips, the lock state on the sub-agent's (${surface.name})`, async ({ page }) => {
          await openLive(page, surface.url);
          const actors = surface.actors(page, 'T4');
          await expect(actors.locator('ui-actor-chip')).toHaveCount(2);
          const agent = actors.locator('ui-actor-chip').nth(0);
          const sub = actors.locator('ui-actor-chip').nth(1);
          await expect(agent).toHaveAttribute('data-task-agent', '');
          await expectChip(agent, AGENT);
          await expectLockState(agent, 'none');
          await expect(sub).toHaveAttribute('data-task-subagent', '');
          await expectChip(sub, `${AGENT}/T4`);
          // Claimed 2026-03-06 09:12 and never released: two days and more at STUB_NOW.
          await expectLockState(sub, { stale: '2 days ago' });

          // The agent's own tasks of the same log keep a single agent chip.
          for (const task of ['T25', 'T27']) {
            await expect(surface.actors(page, task).locator('ui-actor-chip')).toHaveCount(1);
            await expectChip(surface.actors(page, task).locator('ui-actor-chip[data-task-agent]'), AGENT);
          }
        });
      });

      test.describe('a person holds the lock', () => {
        test.use({ extraHTTPHeaders: { [LOCKS_HEADER]: 'person' } });

        test(`subagents: a person's lock (u:) shows no agent chip (${surface.name})`, async ({ page }) => {
          await openLive(page, surface.url);
          if (surface.name === 'board') {
            // T27 is in flight under the person's lock: the lock chip names the session, but nobody is an agent.
            await expect(page.locator('[data-section="inFlight"] app-agent-chip[data-agent-of="T27"] [data-agent-session]')).toHaveText(STUB_PERSON);
          } else {
            await expect(page.locator('#task-T27 [data-check-locked]')).toContainText(STUB_PERSON);
            // The live answer is in; let one frame render before asserting an absence.
            await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          }
          await expect(surface.actors(page, 'T27')).toHaveCount(0);
          await expect(page.locator('app-task-actors')).toHaveCount(0);
          await expect(page.locator('ui-actor-chip:is([data-kind="agent"], [data-kind="subagent"])')).toHaveCount(0);
        });
      });
    });
  }
});
