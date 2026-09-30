/**
 * ISC-2 (T104): with no AI feature switched on, starting the app, browsing every page and performing every write
 * the app offers makes no outbound network request. `bun run e2e -- offline` is the claim's probe.
 *
 * One scripted session per theme (light, dark), each at 1440 in its own stub session (reset first), under the stub's
 * default outcomes (`two-workspaces`, `activity` locks, `ok` writes):
 *
 * - every route: `/`, `/w/harbor`, `/settings`, harbor 002's dashboard and each tab of `TAB_IDS` (status, timeline,
 *   board, matrix, claims, tasks, evidence, plan, design, decisions, constitution, notes, notes/:id), and an unknown path;
 * - the chrome: the area menu, the workspace and spec pickers, the shortcut sheet (`?`) and the palette trigger;
 * - every write: the gate confirm (on 003, the harbor spec whose gate is `ready`; 002's is already `done`), a task tick
 *   and untick, a note create, edit and delete, the notes import-notice dismissal, rail collapse and expand, and a
 *   theme change (see `changeTheme`).
 *
 * A `context.route('**')` handler lets loopback http(s) through and aborts everything else, recording it; a request
 * listener records every request of the context. The session then asserts: no request left loopback, no request
 * used a scheme other than http(s), every font, script and stylesheet came from the app's own origin, and every page
 * rendered inside `app-shell` with content and without the not-found page (except on the unknown path).
 */
import type { BrowserContext, Page, Request } from '@playwright/test';
import { TAB_IDS } from '../src/app/layout/shell/areas';
import { atWidth, expect, test } from './fixtures';
import { STUB_NOTES } from './stub-api';

const SESSION = 'X-Spectant-Stub-Session';
const SPEC = '/w/harbor/s/002';
const UNKNOWN = '/no/such/path';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const OWN_ORIGIN_TYPES = new Set(['font', 'script', 'stylesheet']);
const HARBOR_002_NOTE = STUB_NOTES.find((note) => note.workspace === 'harbor' && note.anchor?.spec === '002');
if (!HARBOR_002_NOTE) throw new Error('STUB_NOTES holds no harbor 002 note');

/** Every page of the app, in visiting order; `tab` is the tab bar's current tab on a spec route. */
const PAGES: ReadonlyArray<{ readonly path: string; readonly tab?: string }> = [
  { path: '/' },
  { path: '/w/harbor' },
  { path: '/settings' },
  { path: SPEC },
  ...TAB_IDS.map((tab) => ({ path: `${SPEC}/${tab}`, tab })),
  { path: `${SPEC}/notes/${HARBOR_002_NOTE.id}`, tab: 'notes' },
];

const isLoopback = (url: URL): boolean => (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK.has(url.hostname);

interface Traffic {
  /** Requests the route handler aborted: not loopback http(s). */
  readonly blocked: string[];
  /** Every request the context issued, with its resource type. */
  readonly seen: Array<{ readonly url: string; readonly type: string }>;
}

async function guard(context: BrowserContext): Promise<Traffic> {
  const traffic: Traffic = { blocked: [], seen: [] };
  await context.route('**', async (route) => {
    const url = new URL(route.request().url());
    if (isLoopback(url)) return route.continue();
    traffic.blocked.push(url.href);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/u, (ws) => {
    const url = new URL(ws.url());
    if (!LOOPBACK.has(url.hostname)) {
      traffic.blocked.push(url.href);
      return ws.close();
    }
    return ws.connectToServer();
  });
  context.on('request', (req: Request) => traffic.seen.push({ url: req.url(), type: req.resourceType() }));
  return traffic;
}

/** The page rendered: one `app-shell` with text in `main`, and no not-found page. */
async function rendered(page: Page, path: string, tab?: string): Promise<void> {
  await expect(page.locator('app-shell'), path).toHaveCount(1);
  await expect(page.locator('main'), path).toHaveText(/\S/u);
  await expect(page.locator('app-not-found, [data-page="not-found"]'), path).toHaveCount(0);
  if (tab === 'notes') {
    // Notes is an area of one tab: no tab bar, the notes view itself.
    await expect(page.locator('app-notes-area'), path).toBeVisible();
  } else if (tab !== undefined) {
    await expect(page.locator('app-tab-bar a[aria-current="page"]'), path).toHaveAttribute('data-tab', tab);
    await expect(page.locator('[data-page="placeholder"]'), path).toHaveCount(0);
  }
}

const answered = (page: Page, method: string, path: RegExp) =>
  page.waitForResponse((res) => res.request().method() === method && path.test(new URL(res.url()).pathname));

/**
 * The theme change. The settings page is still the placeholder (the theme control arrives with T40/T41), so there is
 * no button yet: the page itself sends the PUT the control will send (`SettingsService.update({theme})`), and a reload
 * shows the app applying the stored mode over the system one.
 */
async function changeTheme(page: Page, to: 'light' | 'dark'): Promise<void> {
  const status = await page.evaluate(async (theme) => {
    const res = await fetch('/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme }) });
    return res.status;
  }, to);
  expect(status).toBe(200);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${to}`);
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`offline in ${theme}`, () => {
    const session = `offline-${theme}`;
    test.use({ ...atWidth(1440), colorScheme: theme, extraHTTPHeaders: { [SESSION]: session } });
    test.beforeEach(async ({ request }) => {
      await request.post('/api/__stub/reset', { headers: { [SESSION]: session } });
    });

    test(`offline: every route, the chrome and every write stay on loopback in ${theme}`, async ({ page, context, baseURL }) => {
      test.setTimeout(60_000);
      const origin = new URL(baseURL ?? '').origin;
      const traffic = await guard(context);

      await test.step('every route renders', async () => {
        for (const { path, tab } of PAGES) {
          await test.step(path, async () => {
            await page.goto(path);
            await expect(page.locator('html')).toHaveAttribute('data-theme', `spec-${theme}`);
            await rendered(page, path, tab);
          });
        }
        await expect(page.locator(`[data-note-title]`)).toHaveValue(HARBOR_002_NOTE.title);
        // The plan's mermaid fence is drawn client-side from the lazy chunk on the app's origin.
        await page.goto(`${SPEC}/plan`);
        await expect(page.locator('figure.mermaid-figure[data-rendered] .mermaid-svg svg').first()).toBeVisible();

        await page.goto(UNKNOWN);
        await expect(page.locator('app-shell')).toHaveCount(1);
        await expect(page.locator('[data-page="not-found"]')).toBeVisible();
      });

      await test.step('the chrome: area menu, pickers, shortcut sheet, palette trigger', async () => {
        await page.goto(`${SPEC}/status`);
        await rendered(page, `${SPEC}/status`, 'status');
        const control = (name: string) => page.locator(`header [data-control="${name}"]`);

        await control('area').click();
        const menu = page.getByRole('navigation', { name: 'Areas' });
        await expect(menu.locator('[data-area]')).toHaveCount(6);
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        for (const picker of ['workspace', 'spec'] as const) {
          await control(picker).click();
          await expect(page.locator(`[data-picker="${picker}"]`)).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(control(picker)).toHaveAttribute('aria-expanded', 'false');
        }

        await page.keyboard.press('?');
        const sheet = page.locator('app-shortcut-sheet dialog');
        await expect(sheet.locator('[data-binding]').first()).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(sheet).toBeHidden();

        // The palette trigger opens the command palette (spec 001 T66); Esc closes it and the page stays where it is.
        await expect(control('palette')).not.toHaveAttribute('aria-disabled');
        await control('palette').click();
        const palette = page.locator('app-command-palette dialog');
        await expect(palette).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(palette).toBeHidden();
        await expect(page).toHaveURL(new RegExp(`${SPEC}/status$`, 'u'));
      });

      await test.step('write: gate confirm', async () => {
        await page.goto('/w/harbor/s/003');
        await page.locator('app-spec-head [data-gate-action]').click();
        const dialog = page.locator('app-spec-head [data-gate-dialog]');
        const reviewed = answered(page, 'POST', /\/gate\/reviewed$/u);
        await dialog.locator('[data-confirm]').click();
        expect((await reviewed).status()).toBe(200);
        await expect(page.locator('app-spec-head [data-gate-written]')).toBeVisible();
      });

      await test.step('write: task tick and untick', async () => {
        await page.goto(`${SPEC}/tasks`);
        const open = page.locator('[data-task-row]').filter({ has: page.locator('input[data-task-check]:not(:checked):enabled') }).first();
        const id = await open.getAttribute('id');
        expect(id).toBeTruthy();
        const box = page.locator(`[id="${id ?? ''}"] input[data-task-check]`);
        for (const checked of [true, false]) {
          const written = answered(page, 'POST', /\/tasks\/[^/]+\/check$/u);
          await box.click();
          expect((await written).status()).toBe(200);
          await expect(box).toBeChecked({ checked });
          await expect(box).toBeEnabled();
        }
      });

      await test.step('write: note create, edit, delete and the import notice', async () => {
        await page.goto(`${SPEC}/notes`);
        const area = page.locator('app-notes-area');

        const dismissed = answered(page, 'PUT', /^\/api\/settings$/u);
        await area.locator('[data-notes-import]').getByRole('button', { name: 'Dismiss' }).click();
        expect((await dismissed).status()).toBe(200);
        await expect(area.locator('[data-notes-import]')).toHaveCount(0);

        await area.locator('[data-notes-new]').click();
        const created = answered(page, 'POST', /^\/api\/workspaces\/harbor\/notes$/u);
        await area.locator('[data-note-body]').fill('Offline probe');
        expect((await created).status()).toBe(201);
        await expect(area.locator('[data-save-state]')).toHaveText(/^saved/u);

        const edited = answered(page, 'PUT', /^\/api\/workspaces\/harbor\/notes\/[^/]+$/u);
        await area.locator('[data-note-title]').fill('Offline probe, edited');
        expect((await edited).status()).toBe(200);
        await expect(area.locator('[data-save-state]')).toHaveText(/^saved/u);

        await area.locator('[data-note-delete]').click();
        const removed = answered(page, 'DELETE', /^\/api\/workspaces\/harbor\/notes\/[^/]+$/u);
        await page.locator('[data-note-confirm] dialog [data-note-delete-confirm]').click();
        expect((await removed).status()).toBe(204);
        await expect(page).toHaveURL(new RegExp(`${SPEC}/notes$`, 'u'));
      });

      await test.step('write: rail collapse and expand', async () => {
        await page.goto(`${SPEC}/status`);
        const collapsed = answered(page, 'PUT', /^\/api\/settings$/u);
        await page.locator('aside.shell-rail [data-control="rail-collapse"]').click();
        expect((await collapsed).status()).toBe(200);
        await expect(page.locator('app-shell')).toHaveAttribute('data-rail-collapsed', '');
        const expanded = answered(page, 'PUT', /^\/api\/settings$/u);
        await page.locator('aside.shell-rail [data-control="rail-expand"]').click();
        expect((await expanded).status()).toBe(200);
        await expect(page.locator('app-shell')).not.toHaveAttribute('data-rail-collapsed');
      });

      await test.step('write: theme change', async () => {
        await changeTheme(page, theme === 'light' ? 'dark' : 'light');
        await rendered(page, `${SPEC}/status`, 'status');      });

      const schemes = traffic.seen.filter(({ url }) => !isLoopback(new URL(url))).map(({ url }) => url);
      const foreign = traffic.seen.filter(({ url, type }) => OWN_ORIGIN_TYPES.has(type) && new URL(url).origin !== origin);
      const count = (type: string) => traffic.seen.filter((r) => r.type === type).length;
      test.info().annotations.push({
        type: 'traffic',
        description: `${String(traffic.seen.length)} requests: ${String(count('document'))} document, ${String(count('script'))} script, ${String(count('stylesheet'))} stylesheet, ${String(count('font'))} font, ${String(count('fetch') + count('xhr'))} fetch/xhr; ${String(traffic.blocked.length)} blocked`,
      });

      expect(traffic.blocked, `requests to a non-loopback host:\n${traffic.blocked.join('\n')}`).toEqual([]);
      expect(schemes, `requests not over http(s) to loopback:\n${schemes.join('\n')}`).toEqual([]);
      expect(
        foreign.map(({ url, type }) => `${type} ${url}`),
        `fonts, scripts and stylesheets not from ${origin}`,
      ).toEqual([]);
      expect(count('script'), 'the app loaded its scripts').toBeGreaterThan(0);
      expect(count('stylesheet'), 'the app loaded its stylesheet').toBeGreaterThan(0);
    });
  });
}
