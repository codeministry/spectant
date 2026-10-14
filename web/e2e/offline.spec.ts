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
 *   theme change (see `changeTheme`);
 * - the library (spec 017, T40, ISC-159.2): the list, the reader on a document with a mermaid figure and a relative
 *   image (`STUB_LIBRARY.reader`), an image document, and a prototype opened in a new tab from its card; that tab then
 *   loads the stub-only page `STUB_LIBRARY.prototype.offline`, which names an external stylesheet, an external script
 *   and an `@font-face` source on `.example` hosts. The prototype route's CSP must stop the browser before it asks:
 *   none of those URLs may appear among the context's requests, not even as one the route handler aborts, the face
 *   ends in `error`, and the tab's console reports a CSP refusal for each URL.
 *
 * A `context.route('**')` handler lets loopback http(s) through and aborts everything else, recording it; a request
 * listener records every request of the context. The session then asserts: no request left loopback, no request
 * used a scheme other than http(s), every font, script and stylesheet came from the app's own origin, and every page
 * rendered inside `app-shell` with content and without the not-found page (except on the unknown path).
 */
import type { BrowserContext, Page, Request } from '@playwright/test';
import { prototypeRoute } from '../../server/src/spec-routes.contract.ts';
import { LEGACY_TAB_IDS, TAB_IDS } from '../src/app/layout/shell/areas';
import { atWidth, expect, test } from './fixtures';
import { STUB_LIBRARY, STUB_NOTES } from './stub-api';

const SESSION = 'X-Spectant-Stub-Session';
const SPEC = '/w/harbor/s/002';
const UNKNOWN = '/no/such/path';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const OWN_ORIGIN_TYPES = new Set(['font', 'script', 'stylesheet']);
const HARBOR_002_NOTE = STUB_NOTES.find((note) => note.workspace === 'harbor' && note.anchor?.spec === '002');
if (!HARBOR_002_NOTE) throw new Error('STUB_NOTES holds no harbor 002 note');

const isLegacy = (tab: string): boolean => (LEGACY_TAB_IDS as readonly string[]).includes(tab);

/** Every page of the app, in visiting order; `tab` is the tab bar's current tab on a spec route. */
const PAGES: ReadonlyArray<{ readonly path: string; readonly tab?: string }> = [
  { path: '/' },
  { path: '/w/harbor' },
  { path: '/w/harbor/library' },
  { path: '/settings' },
  { path: '/settings/workspaces' },
  { path: SPEC },
  // The former Docs and Evidence tabs (spec 017) still answer until T48 redirects them, but no tab bar names them:
  // they are visited for the network check without a current tab.
  ...TAB_IDS.map((tab) => ({ path: `${SPEC}/${tab}`, ...(isLegacy(tab) ? {} : { tab }) })),
  { path: `${SPEC}/notes/${HARBOR_002_NOTE.id}`, tab: 'notes' },
];

const LIBRARY = '/w/harbor/library';
const READER = '[data-library-reader]';
const PROTOTYPE = STUB_LIBRARY.prototype;
/** The stub's prototype folder `004-retention-policies/.design/prototype/board` as the read route names it. */
const PROTOTYPE_SPEC = PROTOTYPE.path.slice(0, PROTOTYPE.path.indexOf('/'));
const PROTOTYPE_FOLDER = PROTOTYPE.path.slice(`${PROTOTYPE_SPEC}/.design/`.length);
const OFFLINE_PAGE = prototypeRoute('harbor', PROTOTYPE_SPEC, PROTOTYPE_FOLDER, PROTOTYPE.offline.file);
/** The offline page's external resources as `[resource type, url]`; the keys are Playwright's resource types. */
const EXTERNAL: ReadonlyArray<readonly [string, string]> = Object.entries(PROTOTYPE.offline.external);
/** Chromium's failure text for a request the page's CSP refused in the renderer: reported, never sent. */
const CSP_REFUSED = 'csp';

const isLoopback = (url: URL): boolean => (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK.has(url.hostname);

interface Traffic {
  /** Requests the route handler aborted: not loopback http(s). */
  readonly blocked: string[];
  /** Every request the context issued, with its resource type. */
  readonly seen: Array<{ readonly url: string; readonly type: string; readonly request: Request }>;
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
  context.on('request', (req: Request) => traffic.seen.push({ url: req.url(), type: req.resourceType(), request: req }));
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
      test.setTimeout(90_000);
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

      await test.step('the library: list, reader, image and a prototype tab with an external font, stylesheet and script', async () => {
        await page.goto(LIBRARY);
        await expect(page.locator('[data-library-entry]').first()).toBeVisible();

        // The reader: Docs prose with a drawn mermaid figure and a relative image through the library's file route.
        await page.goto(`${LIBRARY}#${STUB_LIBRARY.reader.path}`);
        await page.reload();
        const prose = page.locator(`${READER} [data-library-prose]`);
        await expect(prose.locator('figure.mermaid-figure[data-rendered] .mermaid-svg svg')).toBeVisible();
        const figureImg = prose.locator('figure.image-figure img');
        await figureImg.scrollIntoViewIfNeeded();
        await expect.poll(() => figureImg.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);

        // An image document: its preview, decoded.
        await page.goto(`${LIBRARY}#${PROTOTYPE.preview}`);
        await page.reload();
        const preview = page.locator(`${READER} [data-library-preview] img`);
        await expect.poll(() => preview.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0))).toBeGreaterThan(0);

        // The prototype: its entry page in a new tab from the card, then the stub-only page with external resources.
        await page.goto(`${LIBRARY}#${PROTOTYPE.path}`);
        await page.reload();
        const [tab] = await Promise.all([
          context.waitForEvent('page'),
          page.locator(`${READER} [data-library-prototype] [data-library-prototype-page="index.html"]`).click(),
        ]);
        await tab.waitForLoadState('load');
        await expect(tab.locator('h1')).toHaveText(/\S/u);

        const refusals: string[] = [];
        tab.on('console', (msg) => {
          if (msg.text().includes('Content Security Policy')) refusals.push(msg.text());
        });
        const answer = await tab.goto(OFFLINE_PAGE);
        expect(answer?.status()).toBe(200);
        expect(answer?.headers()['content-security-policy'] ?? '', 'the prototype answer carries a sandboxing CSP').toMatch(/(^|;)\s*sandbox\b/u);
        await expect(tab.locator('h1')).toHaveText('Offline probe');

        // Ask for the face explicitly, so the font's fetch is attempted before the traffic is read.
        const family = PROTOTYPE.offline.family;
        const status = await tab.evaluate(async (name) => {
          await document.fonts.load(`16px "${name}"`).catch(() => []);
          await document.fonts.ready;
          return [...document.fonts].find((face) => face.family.replace(/^["']|["']$/gu, '') === name)?.status ?? 'absent';
        }, family);
        expect(status, `the @font-face "${family}" from an external host`).toBe('error');

        // Not one external URL left the renderer: Chromium reports each as a request it refused for the CSP
        // (`failure().errorText === 'csp'`, never sent), and the guard, which sees every request bound for the
        // network, had nothing to abort. A weakened CSP lets them through to the guard, and this step fails.
        expect(traffic.seen.some(({ url, type }) => type === 'document' && new URL(url).pathname === OFFLINE_PAGE), 'the offline page was loaded').toBe(true);
        const external = (): string[] =>
          traffic.seen.filter(({ url }) => !isLoopback(new URL(url))).map(({ url, type, request }) => `${type} ${url}: ${request.failure()?.errorText ?? 'not refused'}`);
        await expect.poll(() => external().sort(), { message: 'external URLs, each refused by the CSP before it was sent' }).toEqual(
          EXTERNAL.map(([type, url]) => `${type} ${url}: ${CSP_REFUSED}`).sort(),
        );
        expect(traffic.blocked, 'requests that reached the guard for a host outside the loopback').toEqual([]);

        // Evidence: the tab's console names a CSP refusal for each external URL.
        for (const [, url] of EXTERNAL) {
          await expect.poll(() => refusals.some((text) => text.includes(url)), { message: `CSP refusal for ${url}` }).toBe(true);
        }
        test.info().annotations.push({ type: 'csp-refusals', description: `${String(refusals.length)} refusals in the prototype tab` });
        await tab.close();
      });

      await test.step('write: gate confirm', async () => {
        await page.goto('/w/harbor/s/003');
        await page.locator('app-spec-head [data-gate-action]').click();
        const dialog = page.locator('app-spec-head [data-gate-dialog]');
        const reviewed = answered(page, 'POST', /\/gate\/reviewed$/u);
        for (const box of await dialog.locator('[data-gate-check]').all()) await box.check();
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

      // A request the CSP refused in the renderer (the prototype tab's external resources) never left it.
      const sent = traffic.seen.filter(({ request }) => request.failure()?.errorText !== CSP_REFUSED);
      const schemes = sent.filter(({ url }) => !isLoopback(new URL(url))).map(({ url }) => url);
      const foreign = sent.filter(({ url, type }) => OWN_ORIGIN_TYPES.has(type) && new URL(url).origin !== origin);
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
