/**
 * T153 · ISC-119.2: a person id resolves to its display name only through the actors mapping. Against the stub API's
 * in-memory `GET|PUT /api/actors`, one stub session per test. `bun run e2e -- actors`.
 *
 * - With an empty mapping the status block of harbor 006 and its board card show the raw `u:` id in mono.
 * - Settings → Actors: a display name entered for that id and saved (`PUT /api/actors`) shows on both surfaces.
 * - Resetting the stub's session drops the mapping, as a deleted data directory would; after a reload the id is raw again.
 * - An id outside the person grammar never leaves the form: a stored list that carries one (served through
 *   `page.route`, since the stub refuses to store it) is saved without it, and the stub refuses it when sent directly.
 *
 * The id comes from the harbor goldens (the assignee of every harbor spec); the display names are synthetic.
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page, Request as PwRequest } from '@playwright/test';

import { atWidth, expect, test, WIDTHS } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const read = (path: string): unknown => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const specs = read('../../core/fixtures/harbor.spec.golden.json') as Record<string, { head?: { assignee?: { kind: string; id: string } | null } }>;

const SPEC = '006';
const SPEC_KEY = 'specs/006-partial-push';
const ASSIGNEE = specs[SPEC_KEY]?.head?.assignee ?? null;
if (ASSIGNEE?.kind !== 'person') throw new Error(`harbor.spec.golden.json: ${SPEC_KEY} no longer has a person assignee`);
const ID = ASSIGNEE.id;
const NAME = 'Sample Reviewer';
/** Outside the person grammar `u:` + 8 lowercase hex: an agent session and a malformed person id. */
const NOT_PERSONS = ['a:claude:stub-actors', 'u:NOTHEX00'] as const;
const ACTORS = '/api/actors';

test.use(atWidth(WIDTHS.desktop));

let session = '';
test.beforeEach(async ({ page, request }, info) => {
  session = `actors-${info.testId}`;
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});
test.afterEach(async ({ request }) => {
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
});

const statusChip = (page: Page): Locator => page.locator('app-status-block [data-assignee] ui-actor-chip');
const boardChip = (page: Page): Locator => page.locator(`app-board-card[data-key^="spec:${SPEC}-"] ui-actor-chip`);

/** The chip shows the raw id in mono, or the mapped name as text; its title is the raw id either way. */
async function expectChip(chip: Locator, shown: { name: string } | 'raw'): Promise<void> {
  await expect(chip).toHaveAttribute('data-kind', 'person');
  await expect(chip).toHaveAttribute('title', ID);
  const label = chip.locator('.label');
  if (shown === 'raw') {
    await expect(label).toHaveText(ID);
    await expect(label).toHaveClass(/\bmono\b/u);
  } else {
    await expect(label).toHaveText(shown.name);
    await expect(label).not.toHaveClass(/\bmono\b/u);
  }
}

async function expectSurfaces(page: Page, shown: { name: string } | 'raw'): Promise<void> {
  await page.goto(`/w/harbor/s/${SPEC}/status`);
  await expectChip(statusChip(page), shown);
  await page.goto('/w/harbor/board');
  await expectChip(boardChip(page), shown);
}

const actorRow = (page: Page, id: string): Locator => page.locator(`app-actors-section [data-actor-row="${id}"]`);

/** Save the Actors section and return the body of the `PUT /api/actors` it sent. */
async function save(page: Page): Promise<unknown> {
  const sent = page.waitForRequest((req: PwRequest) => req.method() === 'PUT' && new URL(req.url()).pathname === ACTORS);
  const answered = page.waitForResponse((res) => res.request().method() === 'PUT' && new URL(res.url()).pathname === ACTORS);
  await page.locator('app-actors-section [data-actors-save]').click();
  const body = (await sent).postDataJSON() as unknown;
  expect((await answered).status()).toBe(200);
  await expect(page.locator('app-actors-section [data-actors-status]')).toHaveAttribute('data-state', 'saved');
  return body;
}

test.describe('actors', () => {
  test('an empty mapping shows the raw id; a saved name shows; a reset mapping shows the raw id again', async ({ page, request }) => {
    expect(await (await request.get(ACTORS, { headers: { [SESSION_HEADER]: session } })).json()).toEqual([]);
    await expectSurfaces(page, 'raw');

    await page.goto('/settings');
    const row = actorRow(page, ID);
    await expect(row).toBeVisible();
    await expectChip(row.locator('ui-actor-chip'), 'raw');
    await row.locator('[data-actor-name]').fill(NAME);
    expect(await save(page)).toEqual([{ id: ID, displayName: NAME, gitIdentities: [] }]);
    await expectChip(row.locator('ui-actor-chip'), { name: NAME });
    expect(await (await request.get(ACTORS, { headers: { [SESSION_HEADER]: session } })).json()).toEqual([
      { id: ID, displayName: NAME, gitIdentities: [] },
    ]);

    await expectSurfaces(page, { name: NAME });

    // The data directory deleted: the stub's session forgets its mapping; the app reads it again on a reload.
    expect((await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } })).status()).toBe(204);
    expect(await (await request.get(ACTORS, { headers: { [SESSION_HEADER]: session } })).json()).toEqual([]);
    await page.reload();
    await expectSurfaces(page, 'raw');
  });

  test('an id outside the person grammar is refused by the form and never sent', async ({ page, request }) => {
    // The stub (as the server) refuses to store a non-person, so the stored list that carries them is served here.
    for (const id of NOT_PERSONS) {
      const refused = await request.put(ACTORS, {
        data: [{ id, displayName: 'Not A Person', gitIdentities: [] }],
        headers: { [SESSION_HEADER]: session },
      });
      expect(refused.status(), id).toBe(400);
    }
    const stored = NOT_PERSONS.map((id) => ({ id, displayName: 'Not A Person', gitIdentities: [] }));
    await page.route(`**${ACTORS}`, (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ status: 200, contentType: 'application/json; charset=utf-8', body: JSON.stringify(stored) })
        : route.fallback(),
    );

    await page.goto('/settings');
    await expect(actorRow(page, ID)).toBeVisible();
    await actorRow(page, ID).locator('[data-actor-name]').fill(NAME);
    for (const id of NOT_PERSONS) await actorRow(page, id).locator('[data-actor-name]').fill('Still Not A Person');

    const body = (await save(page)) as Array<{ id: string }>;
    expect(body).toEqual([{ id: ID, displayName: NAME, gitIdentities: [] }]);
    expect(body.map((m) => m.id).filter((id) => (NOT_PERSONS as readonly string[]).includes(id))).toEqual([]);
    expect(await (await request.get(ACTORS, { headers: { [SESSION_HEADER]: session } })).json()).toEqual([
      { id: ID, displayName: NAME, gitIdentities: [] },
    ]);
  });
});
