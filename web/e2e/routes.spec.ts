/**
 * Group `routes` (ISC-150): every view of the app has a reachable route. A place is reachable when its route renders
 * inside the one shell, without the not-found page, and its hook is visible (after `open`, for a view that is an
 * overlay or a state of a page); where the app links the view, its in-app link leads there too.
 * `bun run e2e -- routes.spec.ts` is the probe. The assistant dot and the workspace identity images are no routes of
 * their own; their tests close the claim's second half. The tests run at 1440 unless a test names another width.
 *
 *   Hooks this group reads beyond the `app-*` hosts, `app-tab-bar a[data-tab]`, `[data-area-tile]`,
 *   `app-spec-head [data-gate-action]` and `[data-gate-dialog]`, `[data-frame-chip]`, `ui-segmented[data-control="view"]`,
 *   `[data-ui="command-palette"]` and `[data-settings-link]`:
 *   - `[data-page="settings-workspaces"]` Settings · Workspaces, reached from the settings popover's
 *                                        `[data-settings-link="workspaces"]` and the Settings page's card link
 *                                        `main a[href="/settings/workspaces"]`.
 *   - `header [data-tool="assistant"]`   the assistant trigger (an overflow-menu entry below 1120, see `headerControl`);
 *                                        `[data-assistant]` the panel (from 640) or full-screen sheet (below),
 *                                        `[data-assistant-close]` the `x` in its head; closing removes the panel.
 *   - `[data-ws-cover]`, `[data-ws-badge]` the screenshot or name pattern and the badge beside each workspace name on `/`.
 *   - `/__ui`                            the developer gallery with `[data-gallery="states"]` and
 *                                        `[data-gallery="board-states"]`.
 */
import type { Page } from '@playwright/test';
import { atWidth, expect, test } from './fixtures';
import { follow, openAssistant, viaPage, viaSettings } from './harbor-fixtures';
import { STUB_NOTES } from './stub-api';

const NOTE_002 = STUB_NOTES.find((note) => note.workspace === 'harbor' && note.anchor?.spec === '002');
if (!NOTE_002) throw new Error('STUB_NOTES holds no harbor 002 note');

/** One view of the app: its name in test titles, its route, the hook that proves it rendered. */
interface ViewPlace {
  readonly view: string;
  readonly route: string;
  readonly hook: string;
  readonly open?: (page: Page) => Promise<void>;
  /** The in-app way there: start page, the link to follow, the path it lands on. */
  readonly link?: { readonly from: string; readonly follow: (page: Page) => Promise<void>; readonly lands: string };
}

/** The spec table opens a row in two steps: the first click selects it for the sidebar (`?sel=spec:`), the second opens the spec. */
const openSpecRow =
  (id: string) =>
  async (page: Page): Promise<void> => {
    const row = page.locator(`[data-panel="specs"] [data-spec-row="${id}"]`);
    await row.click();
    await expect(page).toHaveURL((url) => url.searchParams.get('sel') === `spec:${id}`);
    await row.click();
  };
const tab = (id: string): ((page: Page) => Promise<void>) => follow(`app-tab-bar a[data-tab="${id}"]`);

const VIEWS: readonly ViewPlace[] = [
  { view: 'overview', route: '/', hook: 'app-overview-page h1', link: { from: '/w/harbor', follow: follow('header [data-control="brand"]'), lands: '/' } },
  { view: 'workspace dashboard', route: '/w/harbor', hook: 'app-dashboard-page h1', link: { from: '/', follow: follow('main a[href="/w/harbor"]'), lands: '/w/harbor' } },
  // Spec 058 (ISC-394): the spec table moved from the workspace root to the Specs page.
  { view: 'spec dashboard', route: '/w/harbor/s/002', hook: 'app-spec-dashboard', link: { from: '/w/harbor/specs', follow: openSpecRow('002'), lands: '/w/harbor/s/002' } },
  { view: 'status tab', route: '/w/harbor/s/002/status', hook: 'app-status-tab', link: { from: '/w/harbor/s/002', follow: follow('[data-area-tile="status"] a, a[data-area-tile="status"]'), lands: '/w/harbor/s/002/status' } },
  { view: 'gate dialog', route: '/w/harbor/s/003/status', open: follow('app-spec-head [data-gate-action]'), hook: 'app-spec-head [data-gate-dialog]' },
  { view: 'tasks tab', route: '/w/harbor/s/002/tasks', hook: 'app-tasks-tab', link: { from: '/w/harbor/s/002/claims', follow: tab('tasks'), lands: '/w/harbor/s/002/tasks' } },
  { view: 'timeline tab', route: '/w/harbor/s/002/timeline', hook: 'app-timeline-tab', link: { from: '/w/harbor/s/002/status', follow: tab('timeline'), lands: '/w/harbor/s/002/timeline' } },
  { view: 'spec board', route: '/w/harbor/s/002/board', hook: 'app-board-tab section.board', link: { from: '/w/harbor/s/002/matrix', follow: tab('board'), lands: '/w/harbor/s/002/board' } },
  { view: 'board lanes view', route: '/w/harbor/s/002/board', hook: 'app-board-tab section.board[data-view="lanes"]' },
  {
    view: 'board flow view',
    route: '/w/harbor/s/002/board?view=flow',
    hook: 'app-board-tab section.board[data-view="flow"] app-flow-view',
    link: { from: '/w/harbor/s/002/board', follow: follow('app-board-tab ui-segmented[data-control="view"] [role="radio"]:has-text("Flow")'), lands: '/w/harbor/s/002/board' },
  },
  { view: 'board history frame', route: '/w/harbor/s/002/board?frame=0', hook: 'app-board-tab [data-frame-chip="history"]' },
  { view: 'matrix tab', route: '/w/harbor/s/002/matrix', hook: 'app-matrix-tab', link: { from: '/w/harbor/s/002/board', follow: tab('matrix'), lands: '/w/harbor/s/002/matrix' } },
  { view: 'board states gallery', route: '/__ui', hook: '[data-gallery="board-states"]' },
  { view: 'states gallery', route: '/__ui', hook: '[data-gallery="states"]' },
  // spec 024: PAGE select (principal 2026-10-13): the Library is reached through the PAGE select's menu, the rail link is gone
  { view: 'Library', route: '/w/harbor/library', hook: '[data-page="library"] h1', link: { from: '/w/harbor', follow: viaPage('library'), lands: '/w/harbor/library' } },
  {
    view: 'notes editor',
    route: `/w/harbor/s/002/notes/${NOTE_002.id}`,
    hook: '[data-notes-editor]',
    link: { from: '/w/harbor/s/002/notes', follow: follow(`[data-notes-list] a[href$="/notes/${NOTE_002.id}"]`), lands: `/w/harbor/s/002/notes/${NOTE_002.id}` },
  },
  { view: 'Settings · Workspaces', route: '/settings/workspaces', hook: '[data-page="settings-workspaces"] h1', link: { from: '/w/harbor', follow: viaSettings('workspaces'), lands: '/settings/workspaces' } },
  { view: 'Help page', route: '/help', hook: 'app-help-page h1', link: { from: '/w/harbor', follow: viaSettings('help'), lands: '/help' } },
  { view: 'command palette', route: '/w/harbor', open: follow('header [data-control="palette"]'), hook: '[data-ui="command-palette"]' },
];

/** The route rendered inside the shell (the dev gallery has none) and is not the not-found page. */
async function reached(page: Page, place: ViewPlace): Promise<void> {
  if (!place.route.startsWith('/__ui')) await expect(page.locator('app-shell')).toHaveCount(1);
  await expect(page.locator('app-not-found, [data-page="not-found"]')).toHaveCount(0);
  if (place.open) await place.open(page);
  await expect(page.locator(place.hook).first()).toBeVisible();
}

test.describe('routes', () => {
  test.use(atWidth(1440));

  for (const place of VIEWS) {
    test(`${place.view} is reachable at ${place.route}`, async ({ page }) => {
      await page.goto(place.route);
      await reached(page, place);
    });

    const link = place.link;
    if (link) {
      test(`${place.view} is reachable by its in-app link from ${link.from}`, async ({ page }) => {
        await page.goto(link.from);
        await link.follow(page);
        await expect(page).toHaveURL((url) => url.pathname === link.lands);
        await reached(page, { ...place, open: undefined });
      });
    }
  }

  test('the Settings page links Settings · Workspaces', async ({ page }) => {
    await page.goto('/settings');
    await follow('main a[href="/settings/workspaces"]')(page);
    await expect(page).toHaveURL((url) => url.pathname === '/settings/workspaces');
  });

  for (const width of [1440, 390] as const) {
    test.describe(`assistant at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('the assistant dot opens from the header trigger and closes again', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        await openAssistant(page);
        const panel = page.locator('[data-assistant]');
        await expect(panel).toBeVisible();
        await panel.locator('[data-assistant-close]').click();
        await expect(panel).toHaveCount(0);
      });
    });
  }

  test('workspace identity: the overview shows a badge and an image beside each workspace name', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-overview-page h1')).toBeVisible();
    const covers = page.locator('[data-ws-cover]');
    const badges = page.locator('[data-ws-badge]');
    await expect(covers.first()).toBeVisible();
    await expect(badges.first()).toBeVisible();
    expect(await badges.count()).toBe(await covers.count());
  });
});
