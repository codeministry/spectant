/**
 * The re-cut on the Board tab against the stub API (T86, ISC-91). Every expectation is read from the harbor 002
 * goldens the stub serves (`core/fixtures/harbor.frames.golden.json`, `harbor.live.golden.json`), never restated here.
 *
 * - `bun run e2e -- board-recut`: the hatched marker before the re-cut's dispatch frame is visible with the label
 *   "re-cut" and the struck, changed and added counts of that frame's `recut` in its title and accessible name; the
 *   absent card of the live frame shows its strike note; a renumbered id's card detail lists only the frames of its
 *   own task, none from before the re-cut, when its id held another task's text.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Frame, LiveFrame } from '../../core/src/files.ts';
import { atWidth, expect, test } from './fixtures';

const SPEC = 'specs/002-web-console';
const read = (name: string): unknown => {
  const path = fileURLToPath(new URL(`../../core/fixtures/${name}`, import.meta.url));
  const value = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[SPEC];
  if (value === undefined) throw new Error(`${name} holds no ${SPEC}`);
  return value;
};
const FRAMES = read('harbor.frames.golden.json') as Frame[];
const LIVE = read('harbor.live.golden.json') as LiveFrame;
const EN = JSON.parse(readFileSync(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8')) as {
  board: { frame: { recut: string; recutTitle: string } };
};

const BOARD = '/w/harbor/s/002/board';
const CARDS = ':is(app-board-tab, app-rail-slot) article[data-card]';

/** The one frame of the golden that carries a re-cut, and the frame before it. */
const RECUT_FRAME = FRAMES.find((f) => f.recut !== undefined);
if (!RECUT_FRAME?.recut) throw new Error('the frames golden holds no re-cut');
const RECUT = RECUT_FRAME.recut;

test.use(atWidth(1440));

test('re-cut: the marker before the re-cut frame is visible with its label and the counts of the golden', async ({ page }) => {
  await page.goto(BOARD);
  const label = page.locator(`ui-scrubber [data-recut-label][data-recut-before="${String(RECUT_FRAME.index)}"]`);
  await expect(label).toBeVisible();
  await expect(label).toHaveText(EN.board.frame.recut);
  const title = EN.board.frame.recutTitle
    .replace('{{frame}}', RECUT_FRAME.label)
    .replace('{{struck}}', String(RECUT.struck.length))
    .replace('{{changed}}', String(RECUT.changed.length))
    .replace('{{added}}', String(RECUT.added.length));
  await expect(label).toHaveAttribute('title', title);
  await expect(label).toHaveAttribute('aria-label', title);
  await expect(page.locator('ui-scrubber .marker[data-kind="recut"]')).toHaveCount(FRAMES.filter((f) => f.recut).length);
});

test('re-cut: the absent card of the live frame renders with its strike note', async ({ page }) => {
  const absent = LIVE.cards.filter((c) => c.state === 'absent');
  expect(absent.length).toBeGreaterThan(0);
  await page.goto(BOARD);
  for (const c of absent) {
    const card = page.locator(`${CARDS}[data-card="${c.task}"]`);
    await expect(card).toHaveAttribute('data-state', 'absent');
    await expect(card.locator('[data-strike-note]')).toHaveText(c.note ?? '');
  }
  // the id the re-cut struck has no card at all
  for (const id of RECUT.struck) await expect(page.locator(`${CARDS}[data-card="${id}"]`)).toHaveCount(0);
});

test('re-cut: a renumbered id carries no history from before the re-cut', async ({ page }) => {
  const renumbered = LIVE.cards.find((c) => c.state !== 'absent' && c.lane !== 'operator' && RECUT.changed.includes(c.task));
  if (!renumbered) throw new Error('the live golden holds no renumbered card outside the operator lane');
  // what the golden says the history is: every frame with the same id and text, the live frame last
  const own = [...FRAMES, LIVE].flatMap((f) => {
    const hit = f.cards.find((c) => c.task === renumbered.task && c.text === renumbered.text);
    return hit === undefined ? [] : [{ frame: f.index, state: hit.state }];
  });
  const before = FRAMES.filter((f) => f.index < RECUT_FRAME.index && f.cards.some((c) => c.task === renumbered.task));
  expect(before.length).toBeGreaterThan(0);
  expect(own.every((step) => step.frame >= RECUT_FRAME.index)).toBe(true);

  await page.goto(BOARD);
  await page.locator(`${CARDS}[data-card="${renumbered.task}"] button.id`).click();
  const steps = page.locator('[data-history] li');
  await expect(steps).toHaveCount(own.length);
  expect(await steps.evaluateAll((items) => items.map((li) => [Number(li.getAttribute('data-history-frame')), li.getAttribute('data-history-state')]))).toEqual(
    own.map((s) => [s.frame, s.state]),
  );
  for (const f of before) await expect(page.locator(`[data-history] li[data-history-frame="${String(f.index)}"]`)).toHaveCount(0);
});
