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
 *   card shows open, running and aborted, one beacon story each.
 * - tasks-run: the board polls once per refresh tick while the run variant changes between two polls: 003 reads
 *   "Tasks · open" with `/spec-tasks 003`, then "Tasks · running" with the command, the actor and the duration, then the
 *   stage its files give once the run ended ("Review · open" with `/spec-review 003`).
 * - locked (T60, ISC-225.1): `bun run e2e -- run-state -g locked`, the running 003 locks its copy chip and its card.
 */
import type { Locator, Page } from '@playwright/test';

import { atWidth, expect, test, WIDTHS } from './fixtures';
import { LOCKS_HEADER, RESET_PATH, RUN_HEADER, SESSION_HEADER, STUB_NOW, STUB_RUN, type StubRunState } from './stub-api';

const WS = STUB_RUN.workspace.slug;

/** One form of the state line with the details ISC-224 asks of it; `line` is the head ("Tasks · running · since 8 min"). */
type Form =
  | { state: 'open'; line?: string; command: string }
  | { state: 'waiting'; line?: string; on: { link: string } | { text: string } }
  | { state: 'running'; line?: string; command: string; actor: string; since: string }
  | { state: 'aborted'; line?: string; command: string; actor: string; started: string }
  | { state: 'done'; line?: string; date: string; closedAs?: 'dropped' | 'struck' };

/**
 * Asserts that `item` (a `ui-item-state`) shows `form`: its state, its head where given, and each of its details.
 * `holder` is where the run's actor chip stands when the surface names the holder outside the state (a task row's
 * live holders); the item then carries no actor chip of its own, so the holder is named once.
 */
async function expectForm(item: Locator, form: Form, holder?: Locator): Promise<void> {
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
      const actor = holder ?? item.locator('ui-actor-chip');
      if (holder !== undefined) await expect(item.locator('ui-actor-chip')).toHaveCount(0);
      await expect(actor).toHaveAttribute('title', form.actor);
      await expect(actor).toHaveAttribute('data-active', '');
      await expect(item).toContainText(`since ${form.since}`);
      break;
    }
    case 'aborted': {
      await expect(item.locator('[data-started]')).toHaveText(`started ${form.started}`);
      const actor = holder ?? item.locator('ui-actor-chip');
      if (holder !== undefined) await expect(item.locator('ui-actor-chip')).toHaveCount(0);
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

/** The three forms an idea can take, and beacon's story in each. */
const IDEA_FORMS: ReadonlyArray<{ slug: string; form: Form }> = [
  { slug: 'digest-emails', form: { state: 'open', line: 'Idea · open', command: '/spec new digest-emails' } },
  { slug: 'uptime-badges', form: { state: 'running', line: 'Idea · running · since 15 min', command: '/spec new uptime-badges', actor: 'a:claude:sess-71', since: '15 min' } },
  { slug: 'cert-expiry', form: { state: 'aborted', command: '/spec new cert-expiry', actor: 'a:claude:sess-72', started: '03/08/2026, 12:50 PM' } },
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

      test(`surfaces: the idea card shows open, running and aborted with their details, on the board and in the ideas panel (${project})`, async ({ page }) => {
        await open(page, `/w/${WS}/board`);
        for (const { slug, form } of IDEA_FORMS) await expectForm(await boardCard(page, `idea:${slug}`, 'Idea'), form);
        // The aborted run's state word is the warning chip in the head, set off from the line, as on a spec card.
        await expect((await boardCard(page, 'idea:cert-expiry', 'Idea')).locator('[data-item-line] ui-state-chip')).toHaveText(/aborted/i);
        await open(page, `/w/${WS}`);
        await page.locator('app-ideas-panel [data-ideas-title]').click();
        for (const { slug, form } of IDEA_FORMS) await expectForm(page.locator(`app-ideas-panel li[data-idea="${slug}"] ui-item-state`), form);
        await expect(page.locator('app-ideas-panel li[data-idea="cert-expiry"] ui-item-state [data-item-line] ui-state-chip')).toHaveText(/aborted/i);
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
          // T3 and T4 are held in the live frame: the row names their holder once, in its live holders (ISC-131.1).
          const held = id === 'T3' || id === 'T4' ? page.locator(`#task-${id} app-task-actors ui-actor-chip`).last() : undefined;
          await expectForm(row(id).item, form, held);
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

// ─── A running run locks its item (T60, ISC-225.1) ───────────────────────────────────────────────────────────────────
//
// `bun run e2e -- run-state -g locked`: while 003's `/spec-tasks 003` runs, its copy chip (board card and status
// block) is locked and names the run, and its card does not move: a real mouse drag onto another column leaves it in
// Tasks with the run's refusal under it, as Shift+→ does; at 390 "Move to…" disables every entry under the same notice.
// Under `X-Spectant-Stub-Run: none` the same chip copies and the grip is the plain grip: the contrast that makes the
// locked assertions fail without the run.

const LOCKED_NAME = `Locked · ${STUB_RUN.command} is running · ${STUB_RUN.session} · since 8 min`;
const LOCKED_HINT = 'Running for 8 min · copyable once it ends';
const RUN_REFUSAL = `Not moved — ${STUB_RUN.spec} is running: ${STUB_RUN.command} · ${STUB_RUN.session} · since 8 min`;
const CARD_KEY = `spec:${STUB_RUN.folder}`;

const lockedColumn = (page: Page, stage: string): Locator => page.locator(`app-board-page section[data-col="${stage}"]`).first();
const runCard = (page: Page): Locator => page.locator(`app-board-page app-board-card[data-key="${CARD_KEY}"]`);
const runGrip = (page: Page): Locator => runCard(page).locator('[data-grip]');
/** The refusal notice in the card's own list item, right under the card. */
const runNotice = (page: Page): Locator => page.locator(`app-board-card[data-key="${CARD_KEY}"] + app-refusal-notice`);

/**
 * Clicks the chip's button over a cleared clipboard and returns what the clipboard then holds. A locked button is
 * `aria-disabled` but pressable (it opens the hint line), so Playwright's enabled check is skipped for it.
 */
async function clickChip(page: Page, chip: Locator, locked = false): Promise<string> {
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await chip.locator('button').click({ force: locked });
  return page.evaluate(() => navigator.clipboard.readText());
}

/** `chip` is locked: lock glyph, `aria-disabled`, the run in its name; a press copies nothing and opens the hint line. */
async function expectLockedChip(page: Page, chip: Locator): Promise<void> {
  await expect(chip.locator('code')).toHaveText(STUB_RUN.command);
  await expect(chip.locator('.chip')).toHaveAttribute('data-locked', '');
  const button = chip.locator('button');
  await expect(button).toHaveAttribute('aria-disabled', 'true');
  await expect(button).toHaveAccessibleName(LOCKED_NAME);
  await expect(button.locator('ui-icon')).toHaveAttribute('data-icon', 'lock');
  await expect(chip.locator('[data-locked-hint]')).toHaveCount(0);
  expect(await clickChip(page, chip, true), 'a locked chip copies nothing').toBe('');
  await expect(button).not.toHaveAttribute('data-copied', /.*/);
  await expect(chip.locator('[data-locked-hint]')).toHaveText(LOCKED_HINT);
}

/** The card stands in Tasks, its grip locked with the lock glyph, and its drag item disabled. */
async function expectLockedCard(page: Page): Promise<void> {
  await expect(lockedColumn(page, 'tasks').locator(`app-board-card[data-key="${CARD_KEY}"]`)).toHaveCount(1);
  await expect(runCard(page)).toHaveClass(/cdk-drag-disabled/);
  await expect(runGrip(page)).toHaveAttribute('data-locked', '');
  await expect(runGrip(page).locator('ui-icon[data-icon="lock"]')).toHaveCount(1);
}

/** `notice` is the run's refusal, in the one line that names the spec, the command, the actor and the duration. */
async function expectRunRefusal(notice: Locator): Promise<void> {
  await expect(notice).toHaveAttribute('data-refusal', 'run-locked');
  await expect(notice.locator('[data-head][data-run-refusal]')).toHaveText(RUN_REFUSAL);
}

test.describe('run-state locked', () => {
  test.use({ clockAt: STUB_NOW, permissions: ['clipboard-read', 'clipboard-write'], extraHTTPHeaders: { [LOCKS_HEADER]: 'runs' } });

  test.describe('Desktop', () => {
    test.use(atWidth(WIDTHS.desktop));

    test('locked: the copy chip of the running 003 is locked and names the run, on the board card and in the status block', async ({ page }) => {
      await open(page, `/w/${WS}/board`);
      await expectLockedChip(page, runCard(page).locator('[data-card-state] ui-command-chip'));
      await open(page, `/w/${WS}/s/${STUB_RUN.spec}/status`);
      await expectLockedChip(page, page.locator('app-status-block ui-item-state[data-block] ui-command-chip'));
    });

    test('locked: a mouse drag of the running card onto another column leaves it in Tasks and shows the run’s refusal; Shift+→ shows the same', async ({ page }) => {
      const posts: string[] = [];
      page.on('request', (req) => {
        if (req.method() === 'POST') posts.push(new URL(req.url()).pathname);
      });
      await open(page, `/w/${WS}/board`);
      await expectLockedCard(page);
      await expect(runNotice(page)).toHaveCount(0);

      // A press on the grip, a few moves past the CDK's threshold, over the Review column, released there.
      const grip = runGrip(page);
      await grip.scrollIntoViewIfNeeded();
      const from = await grip.boundingBox();
      const to = await lockedColumn(page, 'review').boundingBox();
      if (from === null || to === null) throw new Error('the grip or the Review column is not rendered');
      const [x0, y0] = [from.x + from.width / 2, from.y + from.height / 2];
      const [x1, y1] = [to.x + to.width / 2, to.y + Math.min(to.height / 2, 96)];
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 + 8, y0 + 8, { steps: 4 });
      await page.mouse.move(x1, y1, { steps: 16 });
      // The card never lifts: no column shows a drop hint.
      await expect(page.locator('app-board-page section[data-col][data-drop]')).toHaveCount(0);
      await page.mouse.up();

      await expectLockedCard(page);
      await expect(lockedColumn(page, 'review').locator(`app-board-card[data-key="${CARD_KEY}"]`)).toHaveCount(0);
      await expectRunRefusal(runNotice(page));
      expect(posts, 'nothing is sent for a held card').toEqual([]);

      // ✕ dismisses it; Shift+→ on the focused card brings the same refusal back, and the card stays.
      await runNotice(page).locator('[data-dismiss]').click();
      await expect(runNotice(page)).toHaveCount(0);
      await runCard(page).locator('a.title').focus();
      await page.keyboard.press('Shift+ArrowRight');
      await expectRunRefusal(runNotice(page));
      await expectLockedCard(page);
      expect(posts).toEqual([]);
    });

    test('locked: without the run (Stub-Run none) the same chip copies and the grip is the plain grip', async ({ page }) => {
      await page.setExtraHTTPHeaders({ [LOCKS_HEADER]: 'runs', [RUN_HEADER]: 'none' });
      await open(page, `/w/${WS}/board`);
      const chip = runCard(page).locator('[data-card-state] ui-command-chip');
      await expect(chip.locator('code')).toHaveText(STUB_RUN.command);
      await expect(chip.locator('.chip')).not.toHaveAttribute('data-locked', /.*/);
      await expect(chip.locator('button')).not.toHaveAttribute('aria-disabled', /.*/);
      expect(await clickChip(page, chip)).toBe(STUB_RUN.command);
      await expect(runCard(page)).not.toHaveClass(/cdk-drag-disabled/);
      await expect(runGrip(page)).not.toHaveAttribute('data-locked', /.*/);
      await expect(runGrip(page).locator('ui-icon[data-icon="grip-vertical"]')).toHaveCount(1);
    });

    // T62 · ISC-226: "Release run" in the status block appends the release for this stub session only; the refresh
    // after the 200 reads 003 open with its command again, and the board card is draggable.
    test('release: Release run on the running 003 confirms, ends the run, and 003 reads Tasks · open with /spec-tasks 003', async ({ page, request }) => {
      const session = `run-release-${Date.now()}`;
      await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
      await page.setExtraHTTPHeaders({ [LOCKS_HEADER]: 'runs', [SESSION_HEADER]: session });
      try {
        await open(page, `/w/${WS}/s/${STUB_RUN.spec}/status`);
        const block = page.locator('app-status-block ui-item-state[data-block]');
        await expect(block).toHaveAttribute('data-state', 'running');
        const button = block.locator('app-run-release [data-release]');
        await expect(button).toHaveText(/Release run/);
        expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await button.click();
        const dialog = page.locator('[data-release-dialog]');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('[data-release-keep]')).toBeFocused();
        const released = page.waitForResponse((r) => r.url().endsWith(`/release`) && r.request().method() === 'POST');
        await dialog.locator('[data-release-confirm]').click();
        expect((await released).status()).toBe(200);
        await expect(block).toHaveAttribute('data-state', 'open');
        await expect(block.locator('[data-item-line]')).toHaveText(/Tasks\s*·\s*open/);
        await expect(page.locator('app-run-release [data-release]')).toHaveCount(0);

        await open(page, `/w/${WS}/board`);
        const state = cardState(page, CARD_KEY);
        await expect(state).toHaveAttribute('data-state', 'open');
        await expect(state.locator('[data-item-line]')).toHaveText(/Tasks\s*·\s*open/);
        await expect(state.locator('ui-command-chip code')).toHaveText(STUB_RUN.command);
        await expect(runCard(page)).not.toHaveClass(/cdk-drag-disabled/);
        await expect(runGrip(page)).not.toHaveAttribute('data-locked', /.*/);
        await expect(runCard(page).locator('[data-release]')).toHaveCount(0);
      } finally {
        await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
      }
    });
  });

  test.describe('Mobile', () => {
    test.use(atWidth(WIDTHS.phone));

    test('locked: at 390 “Move to…” of the running card disables every entry under the run’s refusal', async ({ page }) => {
      await open(page, `/w/${WS}/board?col=tasks`);
      await expect(page.locator('app-board-page')).toHaveAttribute('data-tier', 'compact');
      await expectLockedChip(page, runCard(page).locator('[data-card-state] ui-command-chip'));
      await runGrip(page).click();
      const menu = page.locator('[data-move-menu]');
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('data-surface', 'sheet');
      await expectRunRefusal(page.locator('app-refusal-notice[data-move-run]'));
      await expect(page.locator('app-refusal-notice[data-move-run] [data-dismiss]')).toHaveCount(0);
      const entries = menu.locator('[data-move-to]');
      expect(await entries.count()).toBeGreaterThan(1);
      for (const entry of await entries.all()) await expect(entry).toHaveAttribute('aria-disabled', 'true');
      await expect(runNotice(page)).toHaveCount(0);
    });
  });
});
