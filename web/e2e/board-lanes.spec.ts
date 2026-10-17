/**
 * The workspace board's feature bands (spec 037, T36, ISC-197) against the stub API: the bands stand by milestone, then
 * rank, "No feature" last; a band moves within its milestone by Alt+↑/↓ on its grip, by the grip's "Move" menu and by a
 * drag of the grip, each through the backlog route (spec 036) with the planning's `backlogHash`; a card drag on the same
 * board is still one stage transition and nothing else.
 *
 * `bun run e2e -- board-lanes.spec`. On harbor no feature has a `Milestone:` line, so the route ranks all features in
 * one group, while the board groups the bands under the milestones their specs name (`web/CLAUDE.md` § Driving the
 * backlog writes from an e2e spec). Refusals are T43's (`-g refused`), not this file's.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { APIRequestContext, Locator, Page, Request } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';
import { backlogUiBody } from './backlog-ui-sequence';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const EN = JSON.parse(readFileSync(fileURLToPath(new URL('../src/i18n/en.json', import.meta.url)), 'utf8')) as {
  backlog: { reorder: { readonly down: string }; board: { readonly otherMilestone: string } };
};

const BOARD = '/w/harbor/board?group=feature';
const PLANNING_PATH = '/api/workspaces/harbor/planning';
const BACKLOG_PATH = /^\/api\/workspaces\/harbor\/backlog$/u;
const TRANSITION_PATH = /^\/api\/workspaces\/harbor\/specs\/[^/]+\/transition$/u;
/** Every band head in board order; `data-band` is the feature id, '' for the band without a feature. */
const HEADS = 'app-board-page .band-list > .band-head';

interface PlanningFeature {
  readonly id: string;
  readonly rank: number;
}
interface Planning {
  readonly backlogHash: string;
  readonly features: readonly PlanningFeature[];
  readonly milestones: ReadonlyArray<{ readonly slug: string; readonly features: ReadonlyArray<{ readonly id: string }> }>;
}

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `board-lanes-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  expect((await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } })).status()).toBe(204);
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.use(atWidth(1440));

async function planningOf(request: APIRequestContext): Promise<Planning> {
  const answer = await request.get(PLANNING_PATH, { headers: { [SESSION_HEADER]: session } });
  expect(answer.status()).toBe(200);
  return (await answer.json()) as Planning;
}

/**
 * The band groups the design names, read from the planning: each milestone in its order with its features by rank (a
 * feature counts under the first milestone that names it), then the features no milestone names, by rank.
 */
function groupsOf(planning: Planning): string[][] {
  const rank = new Map(planning.features.map((f) => [f.id, f.rank]));
  const byRank = (ids: Iterable<string>): string[] => [...ids].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  const seen = new Set<string>();
  const groups = planning.milestones.map((m) => byRank(m.features.map((f) => f.id).filter((id) => !seen.has(id) && rank.has(id))));
  for (const group of groups) for (const id of group) seen.add(id);
  groups.push(byRank(planning.features.map((f) => f.id).filter((id) => !seen.has(id))));
  return groups;
}

const shownBands = (page: Page): Promise<string[]> => page.locator(HEADS).evaluateAll((heads) => heads.map((h) => h.getAttribute('data-band') ?? '?'));
const gripOf = (page: Page, feature: string): Locator => page.locator(`[data-band-grip="${feature}"]`);
const backlogPost = (page: Page): Promise<Request> =>
  page.waitForRequest((r) => r.method() === 'POST' && BACKLOG_PATH.test(new URL(r.url()).pathname));

/** The shown bands' feature groups: the planning's groups cut to the bands the board shows, empty groups dropped. */
async function shownGroups(page: Page, planning: Planning): Promise<string[][]> {
  const shown = new Set(await shownBands(page));
  return groupsOf(planning)
    .map((group) => group.filter((id) => shown.has(id)))
    .filter((group) => group.length > 0);
}

/** The first shown group with at least two bands: the one a move happens in. */
async function movableGroup(page: Page, planning: Planning): Promise<string[]> {
  const group = (await shownGroups(page, planning)).find((g) => g.length >= 2);
  if (group === undefined) throw new Error('harbor shows no milestone with two feature bands');
  return group;
}

async function open(page: Page): Promise<void> {
  await page.goto(BOARD);
  await expect(page.locator(HEADS).first()).toBeVisible();
}

test('lanes order: feature bands stand by milestone, then rank, and "No feature" is last', async ({ page, request }) => {
  const planning = await planningOf(request);
  await open(page);
  const shown = await shownBands(page);
  const features = shown.filter((key) => key !== '');
  // "No feature" shows only with a card in it, and then last; the harbor golden gives every card a feature.
  expect(shown, 'the band without a feature is last').toEqual(shown.includes('') ? [...features, ''] : features);
  expect(features).toEqual((await shownGroups(page, planning)).flat());
  expect(features.length, 'harbor shows several feature bands').toBeGreaterThan(2);
  // Every feature band has a grip; "No feature" has none and is no drop target.
  await expect(page.locator(`${HEADS}[data-band=""] [data-band-grip]`)).toHaveCount(0);
  await expect(page.locator(`${HEADS} [data-band-grip]`)).toHaveCount(features.length);
});

test('lanes keys: Alt+↓ on a band grip sends one move with the backlog hash and the band steps down', async ({ page, request }) => {
  const planning = await planningOf(request);
  await open(page);
  const [first, second, third] = await movableGroup(page, planning);
  if (first === undefined || second === undefined) throw new Error('no two bands');

  const sent = backlogPost(page);
  const answered = page.waitForResponse((r) => r.request().method() === 'POST' && BACKLOG_PATH.test(new URL(r.url()).pathname));
  await gripOf(page, first).focus();
  await page.keyboard.press('Alt+ArrowDown');
  expect((await sent).postDataJSON()).toEqual({ ...backlogUiBody('board-alt'), hash: planning.backlogHash });
  expect(backlogUiBody('board-alt')).toEqual({ op: 'move', feature: first, before: third ?? null });
  expect((await answered).status()).toBe(200);

  await expect.poll(() => shownBands(page)).toEqual(expect.arrayContaining([second, first]));
  await expect.poll(async () => {
    const shown = await shownBands(page);
    return shown.indexOf(first) - shown.indexOf(second);
  }).toBe(1);
  // The grip keeps focus, and the polite line names the new place.
  await expect(gripOf(page, first)).toBeFocused();
  await expect(page.locator('[data-band-live]')).toContainText(first);
});

test('lanes keys: Alt+↑ on the first band of a group sends nothing', async ({ page, request }) => {
  const planning = await planningOf(request);
  await open(page);
  const groups = await shownGroups(page, planning);
  const before = await shownBands(page);
  const posts: string[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(new URL(r.url()).pathname);
  });
  for (const group of groups) {
    const first = group[0];
    if (first === undefined) continue;
    await gripOf(page, first).focus();
    await page.keyboard.press('Alt+ArrowUp');
  }
  // A write the page would send goes out at once; give it a beat to show up, then none must have.
  await page.waitForTimeout(300);
  expect(posts).toEqual([]);
  expect(await shownBands(page)).toEqual(before);
});

test('lanes menu: a grip click opens "Move", and "Move down" moves the band through the route', async ({ page, request }) => {
  const planning = await planningOf(request);
  await open(page);
  const [first, second, third] = await movableGroup(page, planning);
  if (first === undefined || second === undefined) throw new Error('no two bands');

  await gripOf(page, first).click();
  await expect(gripOf(page, first)).toHaveAttribute('aria-expanded', 'true');
  const sent = backlogPost(page);
  await page.getByRole('button', { name: EN.backlog.reorder.down, exact: true }).click();
  expect((await sent).postDataJSON()).toEqual({ ...backlogUiBody('board-menu'), hash: planning.backlogHash });
  expect(backlogUiBody('board-menu')).toEqual({ op: 'move', feature: first, before: third ?? null });
  await expect.poll(async () => {
    const shown = await shownBands(page);
    return shown.indexOf(first) - shown.indexOf(second);
  }).toBe(1);

  // The session's planning now carries the move: the next read ranks the band after its neighbour.
  const after = await planningOf(request);
  expect(after.backlogHash).not.toBe(planning.backlogHash);
  await page.reload();
  await expect(page.locator(HEADS).first()).toBeVisible();
  const shown = await shownBands(page);
  expect(shown.indexOf(first) - shown.indexOf(second)).toBe(1);
});

test('lanes drag: dragging a band grip below its neighbour sends one move; the band stands dashed, other milestones lock', async ({ page, request }) => {
  const planning = await planningOf(request);
  await open(page);
  // A group of three bands at least, so the gap after the neighbour lies between two heads of the group.
  const groups = await shownGroups(page, planning);
  const [first, second, third] = groups.find((g) => g.length >= 3) ?? [];
  if (first === undefined || second === undefined || third === undefined) throw new Error('harbor shows no milestone with three feature bands');
  const posts: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r);
  });

  const head = page.locator(`${HEADS}[data-band="${first}"]`);
  const group = (await head.getAttribute('data-move-group')) ?? '';
  // Head near the top but clear of the sticky page and column heads, so the third head is in view as well.
  await head.evaluate((h) => {
    let box = h.parentElement;
    while (box !== null && !(box.scrollHeight > box.clientHeight && /auto|scroll/u.test(getComputedStyle(box).overflowY))) box = box.parentElement;
    const scroller = box ?? document.scrollingElement;
    if (scroller === null) return;
    const offset = h.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTo({ top: scroller.scrollTop + offset - 40, behavior: 'instant' });
  });
  const from = await gripOf(page, first).boundingBox();
  // The gap after the neighbour: low in the neighbour's cells, above the third band's head and clear of the autoscroll edge.
  const to = await page.locator(`${HEADS}[data-band="${third}"]`).boundingBox();
  if (from === null || to === null) throw new Error('the grip or the target head is not rendered');
  const x0 = from.x + from.width / 2;
  const y0 = from.y + from.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0, y0 + 8, { steps: 4 });
  await page.mouse.move(x0, to.y - 48, { steps: 16 });
  await page.mouse.move(x0, to.y - 46, { steps: 2 });
  // While lifted: the band stays as a dashed placeholder, the line marks the gap, other groups' bands are locked.
  await expect(page.locator(`${HEADS}.cdk-drag-placeholder[data-band="${first}"]`)).toHaveCount(1);
  await expect(page.locator(`${HEADS}[data-drop-line]`)).toHaveAttribute('data-band', third);
  const others = page.locator(`${HEADS}:not([data-move-group="${group}"])`);
  expect(await others.count(), 'harbor shows bands of another milestone').toBeGreaterThan(0);
  for (const head of await others.all()) {
    await expect(head).toHaveAttribute('data-band-lock', '');
    await expect(head.locator('[data-band-lock-hint]')).toHaveText(EN.backlog.board.otherMilestone);
  }
  await expect(page.locator(`${HEADS}[data-move-group="${group}"][data-band-lock]`)).toHaveCount(0);
  const sent = backlogPost(page);
  await page.mouse.up();
  expect((await sent).postDataJSON()).toEqual({ ...backlogUiBody('board-drag'), hash: planning.backlogHash });
  expect(backlogUiBody('board-drag')).toEqual({ op: 'move', feature: first, before: third });
  await expect.poll(async () => {
    const shown = await shownBands(page);
    return shown.indexOf(first) - shown.indexOf(second);
  }).toBe(1);
  await expect(page.locator(`${HEADS}[data-band-lock]`)).toHaveCount(0);
  expect(posts.map((r) => new URL(r.url()).pathname)).toEqual(['/api/workspaces/harbor/backlog']);
});

test('lanes cards: a card drag on the feature board is still one stage transition and no backlog write', async ({ page }) => {
  await open(page);
  const posts: Request[] = [];
  page.on('request', (r) => {
    if (r.method() === 'POST') posts.push(r);
  });
  const card = page.locator('app-board-page .cell app-board-card[data-key^="spec:006-"]');
  await expect(card).toHaveCount(1);
  const grip = card.locator('[data-grip]');
  await grip.scrollIntoViewIfNeeded();
  const from = await grip.boundingBox();
  if (from === null) throw new Error('the card grip is not rendered');
  const x0 = from.x + from.width / 2;
  const y0 = from.y + from.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 8, y0 + 8, { steps: 4 });
  // While lifted, the columns carry their hints; the first allowed one is the target, in the card's own band row.
  const allowed = page.locator('app-board-page section[data-col][data-drop="allowed"]').first();
  await expect(allowed).toHaveCount(1);
  const to = (await allowed.getAttribute('data-col')) ?? '';
  const column = await allowed.boundingBox();
  if (column === null) throw new Error('the target column is not rendered');
  const answered = page.waitForResponse((r) => r.request().method() === 'POST' && TRANSITION_PATH.test(new URL(r.url()).pathname));
  await page.mouse.move(column.x + column.width / 2, y0, { steps: 16 });
  await page.mouse.move(column.x + column.width / 2 + 2, y0 + 2, { steps: 2 });
  // A card lifts no band: no band is locked and no drop line shows.
  await expect(page.locator(`${HEADS}[data-band-lock], ${HEADS}[data-drop-line]`)).toHaveCount(0);
  await page.mouse.up();
  const answer = await answered;
  expect(answer.status()).toBe(200);
  expect(answer.request().postDataJSON()).toMatchObject({ to });

  // The session's planning tree holds 006 in the target stage (a board reload would restore the remembered swimlane
  // query, which puts the card into a band cell, not straight into the column).
  const tree = (await (await page.request.get('/api/workspaces/harbor/planning')).json()) as { features: Array<{ holders: Array<{ id: string; stage: string }> }> };
  expect(new Set(tree.features.flatMap((f) => f.holders).filter((h) => h.id === '006').map((h) => h.stage))).toEqual(new Set([to]));
  expect(posts.map((r) => new URL(r.url()).pathname)).toEqual(['/api/workspaces/harbor/specs/006/transition']);
});
