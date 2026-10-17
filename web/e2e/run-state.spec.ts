/**
 * The item states on every surface (spec 040, T54, T55; ISC-224, ISC-224.1), against the stub API's run fixture:
 * `bun run e2e -- run-state -g surfaces` and `bun run e2e -- run-state -g tasks-run`.
 *
 * `X-Spectant-Stub-Locks: runs` serves the fixture tree beacon, rebuilt by core from its files and its activity log
 * (`runVariant` in `stub-api.ts`); `X-Spectant-Stub-Run` picks the variant of beacon 003's `/spec-tasks 003` run. The
 * durations are the API's `elapsedMs` at `STUB_NOW`, so the browser clock is pinned there too.
 *
 * - surfaces: each of the five forms with its details on the board card, the status block, the idea card (board story
 *   card and the dashboard's ideas panel), the claim row and the task row, at the Mobile and the Desktop width. An idea
 *   is never `waiting` (a story carries no edges) and never `done` (an allocated story becomes a spec), so the idea
 *   card shows open and running only; beacon holds no aborted idea run.
 * - tasks-run: the board polls once per refresh tick while the run variant changes between two polls: 003 reads
 *   "Tasks · open" with `/spec-tasks 003`, then "Tasks · running" with the command, the actor and the duration, then the
 *   stage its files give once the run ended ("Review · open" with `/spec-review 003`).
 */
import type { Locator, Page } from '@playwright/test';

import { atWidth, expect, test, WIDTHS } from './fixtures';
import { LOCKS_HEADER, RUN_HEADER, STUB_NOW, STUB_RUN, type StubRunState } from './stub-api';

const WS = STUB_RUN.workspace.slug;

/** One form of the state line with the details ISC-224 asks of it; `line` is the head ("Tasks · running · since 8 min"). */
type Form =
  | { state: 'open'; line?: string; command: string }
  | { state: 'waiting'; line?: string; on: { link: string } | { text: string } }
  | { state: 'running'; line?: string; command: string; actor: string; since: string }
  | { state: 'aborted'; line?: string; command: string; actor: string; started: string }
  | { state: 'done'; line?: string; date: string; closedAs?: 'dropped' | 'struck' };

/** Asserts that `item` (a `ui-item-state`) shows `form`: its state, its head where given, and each of its details. */
async function expectForm(item: Locator, form: Form): Promise<void> {
  await expect(item).toBeVisible();
  await expect(item).toHaveAttribute('data-state', form.state);
  if (form.line !== undefined) await expect(item.locator('[data-item-line]')).toHaveText(form.line);
  const command = item.locator('ui-command-chip code');
  switch (form.state) {
    case 'open':
      await expect(command).toHaveText(form.command);
      await expect(item.locator('ui-command-chip .chip')).not.toHaveAttribute('data-locked', /.*/);
      break;
    case 'waiting':
      if ('link' in form.on) {
        await expect(item.locator('ui-waits-chip a').filter({ hasText: form.on.link })).toHaveAttribute('href', new RegExp(`/w/${WS}/s/${form.on.link}`));
      } else {
        await expect(item.locator('[data-waits-text]')).toHaveText(form.on.text);
      }
      await expect(command).toHaveCount(0);
      break;
    case 'running': {
      await expect(command).toHaveText(form.command);
      await expect(item.locator('ui-command-chip .chip')).toHaveAttribute('data-locked', '');
      const actor = item.locator('ui-actor-chip');
      await expect(actor).toHaveAttribute('title', form.actor);
      await expect(actor).toHaveAttribute('data-active', '');
      await expect(item).toContainText(`since ${form.since}`);
      break;
    }
    case 'aborted': {
      await expect(item.locator('[data-started]')).toHaveText(`started ${form.started}`);
      const actor = item.locator('ui-actor-chip');
      await expect(actor).toHaveAttribute('title', form.actor);
      await expect(actor).toHaveAttribute('data-stale', '');
      await expect(command).toHaveText(form.command);
      break;
    }
    case 'done':
      await expect(item.locator('[data-done]')).toHaveText(form.date);
      await expect(item.locator('[data-closed-as]')).toHaveText(form.closedAs === undefined ? [] : [form.closedAs]);
      break;
  }
}

/** The state line of a board card by its key (`spec:<folder>` or `idea:<slug>`), opened on the board. */
const cardState = (page: Page, key: string): Locator => page.locator(`app-board-card[data-key="${key}"] [data-card-state] ui-item-state`);

/** A board card's state line; at the compact tier the board shows one column, so `column` is picked in its switch first. */
async function boardCard(page: Page, key: string, column: string): Promise<Locator> {
  const pick = page.locator('.colswitch button').filter({ hasText: new RegExp(`^\\s*${column}\\s*\\d`) });
  if ((await pick.count()) > 0) await pick.click();
  const item = cardState(page, key);
  await item.scrollIntoViewIfNeeded();
  return item;
}

/** Opens `url` and resolves once a state line has rendered (the first read of a page carries one). */
async function open(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await page.locator('ui-item-state').first().waitFor({ state: 'attached', timeout: 15_000 });
}

/** The five forms of the spec item, one beacon spec each (core/fixtures/beacon.state.golden.json at `STUB_NOW`). */
const SPEC_FORMS: ReadonlyArray<{ folder: string; column: string; form: Form }> = [
  { folder: '002-status-page', column: 'Plan', form: { state: 'open', line: 'Plan · open', command: '/spec-plan 002' } },
  { folder: '011-maintenance-windows', column: 'Blocked', form: { state: 'waiting', line: 'Blocked · waiting', on: { link: '002' } } },
  { folder: '003-alert-rules', column: 'Tasks', form: { state: 'running', line: 'Tasks · running · since 8 min', command: STUB_RUN.command, actor: STUB_RUN.session, since: '8 min' } },
  { folder: '006-retry-backoff', column: 'Code review', form: { state: 'aborted', command: '/spec-code-review 006', actor: 'a:claude:sess-61', started: '03/08/2026, 12:40 PM' } },
  { folder: '001-check-scheduler', column: 'Done', form: { state: 'done', line: 'Done', date: '03/04/2026' } },
];

/** The two forms an idea can take, and beacon's story in each. */
const IDEA_FORMS: ReadonlyArray<{ slug: string; form: Form }> = [
  { slug: 'digest-emails', form: { state: 'open', line: 'Idea · open', command: '/spec new digest-emails' } },
  { slug: 'uptime-badges', form: { state: 'running', line: 'Idea · running · since 15 min', command: '/spec new uptime-badges', actor: 'a:claude:sess-71', since: '15 min' } },
];

test.describe('run-state surfaces', () => {
  test.use({ clockAt: STUB_NOW, extraHTTPHeaders: { [LOCKS_HEADER]: 'runs' } });

  for (const [project, width] of [['Mobile', WIDTHS.phone], ['Desktop', WIDTHS.desktop]] as const) {
    test.describe(project, () => {
      test.use(atWidth(width));

      test(`surfaces: the board card shows each of the five forms with its details (${project})`, async ({ page }) => {
        await open(page, `/w/${WS}/board`);
        for (const { folder, column, form } of SPEC_FORMS) await expectForm(await boardCard(page, `spec:${folder}`, column), form);
        // The aborted run's state word is the warning chip in the head, set off from the line.
        await expect((await boardCard(page, 'spec:006-retry-backoff', 'Code review')).locator('[data-item-line] ui-state-chip')).toHaveText(/aborted/i);
      });

      for (const { folder, form } of SPEC_FORMS) {
        test(`surfaces: the status block of ${folder.slice(0, 3)} shows the ${form.state} form with its details (${project})`, async ({ page }) => {
          await open(page, `/w/${WS}/s/${folder.slice(0, 3)}/status`);
          const item = page.locator('app-status-block ui-item-state[data-block]');
          if (form.state === 'open') {
            // Beside the rail (wide tier) the page's one copy of the next command stands in the head and the rail's
            // "Next", not twice in the block; the block keeps the state line and the reason.
            await expect(item).toHaveAttribute('data-state', 'open');
            if (form.line !== undefined) await expect(item.locator('[data-item-line]')).toHaveText(form.line);
            await expect(page.locator('ui-command-chip code').filter({ hasText: form.command }).first()).toBeVisible();
          } else {
            await expectForm(item, form);
          }
          // The block's form adds a running run's start beside its duration (T49).
          if (form.state === 'running') await expect(item.locator('[data-started]')).toHaveText('started 03/08/2026, 3:52 PM');
        });
      }

      test(`surfaces: the idea card shows open and running with their details, on the board and in the ideas panel (${project})`, async ({ page }) => {
        await open(page, `/w/${WS}/board`);
        for (const { slug, form } of IDEA_FORMS) await expectForm(await boardCard(page, `idea:${slug}`, 'Idea'), form);
        await open(page, `/w/${WS}`);
        await page.locator('app-ideas-panel [data-ideas-title]').click();
        for (const { slug, form } of IDEA_FORMS) await expectForm(page.locator(`app-ideas-panel li[data-idea="${slug}"] ui-item-state`), form);
      });

      test(`surfaces: the claim row shows each of the five forms with its details (${project})`, async ({ page }) => {
        await open(page, `/w/${WS}/s/005/claims`);
        const claim = (id: string): Locator => page.locator(`article[data-claim="${id}"] ui-item-state`);
        await expectForm(claim('ISC-18'), { state: 'open', command: '/spec-implement 005' });
        await expectForm(claim('ISC-17'), { state: 'waiting', on: { text: 'waits on ISC-18' } });
        await expectForm(claim('ISC-15'), { state: 'running', command: '/spec-implement 005', actor: 'a:claude:sess-51/T3', since: '30 min' });
        await expectForm(claim('ISC-16'), { state: 'aborted', command: '/spec-implement 005', actor: 'a:claude:sess-50/T4', started: '03/08/2026, 2:40 PM' });
        await expectForm(claim('ISC-19'), { state: 'done', date: '03/07/2026', closedAs: 'dropped' });
      });

      test(`surfaces: the task row shows each of the five forms with its details (${project})`, async ({ page }) => {
        // The status cell names the state; the row's details line carries what the form asks for.
        const row = (id: string): { word: Locator; item: Locator } => ({
          word: page.locator(`#task-${id} .status[data-item-state]`),
          item: page.locator(`#task-${id} ui-item-state[data-details]`),
        });
        await open(page, `/w/${WS}/s/004/tasks`);
        await expect(row('T1').word).toHaveAttribute('data-item-state', 'open');
        await expectForm(row('T1').item, { state: 'open', command: '/spec-implement 004' });

        await open(page, `/w/${WS}/s/005/tasks`);
        const forms: ReadonlyArray<[string, Form, string]> = [
          ['T7', { state: 'waiting', on: { text: 'waits on ISC-18' } }, 'waiting'],
          ['T3', { state: 'running', command: '/spec-implement 005', actor: 'a:claude:sess-51/T3', since: '28 min' }, 'running · building'],
          ['T4', { state: 'aborted', command: '/spec-implement 005', actor: 'a:claude:sess-50/T4', started: '03/08/2026, 2:41 PM' }, 'aborted'],
          ['T1', { state: 'done', date: '03/08/2026' }, 'done'],
          ['T8', { state: 'done', date: '03/07/2026', closedAs: 'struck' }, 'done · struck'],
        ];
        for (const [id, form, word] of forms) {
          await expect(row(id).word).toHaveAttribute('data-item-state', form.state);
          await expect(row(id).word).toHaveText(word, { ignoreCase: true });
          await expectForm(row(id).item, form);
        }
      });
    });
  }
});

/** `DEFAULT_SETTINGS.refreshSeconds` in `src/app/core/settings.service.ts`, plus a second of slack (as refresh.spec.ts). */
const ONE_TICK_MS = 31_000;

test.describe('run-state tasks-run', () => {
  // The spec installs its own fake timers to fire the refresh tick, so the fixture's pinned clock is off.
  test.use({ ...atWidth(WIDTHS.desktop), clockAt: null });

  test('tasks-run: the card of 003 steps open → running with actor and duration → the stage its files give, each within one refresh tick', async ({ page }) => {
    const variant = (run: StubRunState): Promise<void> => page.setExtraHTTPHeaders({ [LOCKS_HEADER]: 'runs', [RUN_HEADER]: run });
    const card = page.locator(`app-board-card[data-key="spec:${STUB_RUN.folder}"]`);
    const item = card.locator('[data-card-state] ui-item-state');
    await page.clock.install({ time: new Date(STUB_NOW) });

    // No run-start line: 003 waits for its command.
    await variant('none');
    await open(page, `/w/${WS}/board`);
    await expect(card).toHaveAttribute('data-stage', 'tasks');
    await expectForm(item, { state: 'open', line: 'Tasks · open', command: STUB_RUN.command });

    // The run-start line appears: one tick later the card runs, with the command, its actor and the duration.
    await variant('running');
    await page.clock.fastForward(ONE_TICK_MS);
    await expectForm(item, { state: 'running', line: 'Tasks · running · since 8 min', command: STUB_RUN.command, actor: STUB_RUN.session, since: '8 min' });

    // The run-end line and the tasks.md it wrote: one tick later the card stands where its files put it.
    await variant('ended');
    await page.clock.fastForward(ONE_TICK_MS);
    await expect(card).toHaveAttribute('data-stage', 'review');
    await expectForm(item, { state: 'open', line: 'Review · open', command: '/spec-review 003' });
  });
});
