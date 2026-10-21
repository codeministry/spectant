/**
 * Group `navigation` (ISC-150.1, T56): the app's menus, palette, settings links and keys reach every page. Hooks it
 * reads:
 *
 *   - `nav[aria-label="Pages"]`         the page menu, opened from the PAGE select `header [data-control="page"]`
 *                                        (spec 024 T80, ISC-150.2), second after the workspace on every width;
 *   - `nav[aria-label="Areas"]`         the spec area menu, opened from `header [data-control="area"]` on a spec page
 *                                        (`headerControl`); both a `ui-popover` from 640 px, a `ui-sheet` below.
 *   - `[data-menu-head]`                 the menu's eyebrow head, naming the scope.
 *   - `[data-page="<id>"]`               one entry per workspace page, in registry order, with `ui-icon[data-icon]`,
 *                                        `.entry-name` and the summary `.sub`; `[data-area="<id>"]` per spec area.
 *   - palette `[data-entry]`             `harbor` (the dashboard), `page/harbor/dashboard` and `page/harbor/specs`
 *                                        (spec 058 T23, the Pages group), `action/open-board`, `feature-F0`, `milestone-harbor-0-9`,
 *                                        `action/open-library`, `action/settings-workspaces` (spec 017 T43, ISC-157.1:
 *                                        no Tech entry any more, Tech went into the Library).
 *   - shortcut sheet `[data-binding]`    `go-board`, `go-features`, `go-milestones` in the workspace context.
 */
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import { workspaceRoutes } from '../../server/src/contracts/spec-routes.contract.ts';
import { atWidth, expect, headerControl, test } from './fixtures';
import { follow, viaPage, viaSettings } from './harbor-fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const MENU_PAGES = [
  // Spec 058 (ISC-394): the dashboard is the workspace root and first in the menu; the spec list is Specs, second.
  { id: 'dashboard', icon: 'layout-dashboard', name: 'Dashboard', lands: (path: string) => path === '/w/harbor' },
  { id: 'specs', icon: 'file-text', name: 'Specs', lands: (path: string) => path === '/w/harbor/specs' },
  { id: 'board', icon: 'square-kanban', name: 'Board', lands: (path: string) => path === '/w/harbor/board' },
  // spec 026 (T15, ISC-167): one Planning entry replaces Features and Milestones and lands on the tree lens.
  { id: 'planning', icon: 'list-tree', name: 'Planning', lands: (path: string) => path === '/w/harbor/planning/gantt' },
  // spec 017 (T41, ISC-157.1): Tech went into the Library, which stands where Tech stood.
  { id: 'library', icon: 'book', name: 'Library', lands: (path: string) => path === '/w/harbor/library' },
] as const;

const SPEC_MENU_AREAS = [
  { id: 'dashboard', path: '/w/harbor/s/002' },
  { id: 'status', path: '/w/harbor/s/002/status' },
  { id: 'live', path: '/w/harbor/s/002/board' },
  { id: 'data', path: '/w/harbor/s/002/claims' },
  // Spec 017 (T45, ISC-158): the Library where Docs stood, its one tab at …/library.
  { id: 'library', path: '/w/harbor/s/002/library' },
  { id: 'notes', path: '/w/harbor/s/002/notes' },
] as const;

const PALETTE_PLACES = [
  { entry: 'harbor', query: 'harbor', lands: (path: string) => path === '/w/harbor' },
  { entry: 'page/harbor/dashboard', query: 'dashboard', lands: (path: string) => path === '/w/harbor' },
  { entry: 'page/harbor/specs', query: 'specs', lands: (path: string) => path === '/w/harbor/specs' },
  { entry: 'action/open-board', query: 'board', lands: (path: string) => path === '/w/harbor/board' },
  { entry: 'feature-F0', query: 'F0', lands: (path: string) => path === '/w/harbor/planning/tree' },
  { entry: 'milestone-harbor-0-9', query: 'harbor-0-9', lands: (path: string) => path === '/w/harbor/planning/tree' },
  { entry: 'action/open-library', query: 'library', lands: (path: string) => path === '/w/harbor/library' },
  { entry: 'action/settings-workspaces', query: 'settings', lands: (path: string) => path === '/settings/workspaces' },
] as const;

async function openAreaMenu(page: Page): Promise<Locator> {
  await (await headerControl(page, 'area')).click();
  const menu = page.getByRole('navigation', { name: 'Areas' });
  await expect(menu).toBeVisible();
  return menu;
}

// spec 024: PAGE select (principal 2026-10-13): the workspace pages are the PAGE select's menu, no longer the area menu's.
async function openPageMenu(page: Page): Promise<Locator> {
  await (await headerControl(page, 'page')).click();
  const menu = page.getByRole('navigation', { name: 'Pages' });
  await expect(menu).toBeVisible();
  return menu;
}

const ids = (list: Locator, attr: string): Promise<Array<string | null>> =>
  list.evaluateAll((els, name) => els.map((el) => el.getAttribute(name)), attr);

test.describe('navigation', () => {
  for (const width of [390, 820, 1440] as const) {
    test.describe(`area menu and palette at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('the PAGE menu lists every WORKSPACE_PAGES page with icon, name and summary, Library included', async ({ page }) => {
        await page.goto('/w/harbor');
        // spec 024: PAGE select (principal 2026-10-13)
        const menu = await openPageMenu(page);
        await expect(menu.locator(`xpath=ancestor::${width < 640 ? 'ui-sheet' : 'ui-popover'}`)).toHaveCount(1);
        await expect(menu.locator('[data-menu-head]')).toBeVisible();
        const entries = menu.locator('[data-page]');
        await expect(entries).toHaveCount(MENU_PAGES.length);
        expect(await ids(entries, 'data-page')).toEqual(MENU_PAGES.map((entry) => entry.id));
        for (const entry of MENU_PAGES) {
          const row = menu.locator(`[data-page="${entry.id}"]`);
          await expect(row.locator('ui-icon'), entry.id).toHaveAttribute('data-icon', entry.icon);
          await expect(row.locator('.entry-name'), entry.id).toHaveText(entry.name);
          await expect(row.locator('.sub'), entry.id).toHaveText(/\S/u);
        }
        await expect(menu.locator('[aria-current="page"]')).toHaveCount(1);
        // Spec 058 (ISC-394): `/w/harbor` is the dashboard.
        await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-page', 'dashboard');
      });

      test('each workspace page entry navigates, and the menu then marks that page current', async ({ page }) => {
        for (const entry of MENU_PAGES) {
          await page.goto('/w/harbor');
          // spec 024: PAGE select (principal 2026-10-13): the PAGE select names the page and stays in the row on every width
          await (await openPageMenu(page)).locator(`[data-page="${entry.id}"]`).click();
          await expect(page, entry.id).toHaveURL((url) => entry.lands(url.pathname));
          const trigger = await headerControl(page, 'page');
          await expect(trigger, entry.id).toContainText(entry.name);
          await expect(page.locator('header [data-control="area"]'), entry.id).toHaveCount(0);
          await trigger.click();
          const menu = page.getByRole('navigation', { name: 'Pages' });
          await expect(menu, entry.id).toBeVisible();
          await expect(menu.locator('[aria-current="page"]'), entry.id).toHaveCount(1);
          await expect(menu.locator('[aria-current="page"]'), entry.id).toHaveAttribute('data-page', entry.id);
        }
      });

      test('a workspace without milestones lists Planning and keeps Library', async ({ page }) => {
        await page.goto('/w/lantern');
        // spec 024: PAGE select (principal 2026-10-13); spec 026: Planning in place of Features and Milestones
        const menu = await openPageMenu(page);
        expect(await ids(menu.locator('[data-page]'), 'data-page')).toEqual(['dashboard', 'specs', 'board', 'planning', 'library']);
      });

      test('the spec area menu lists the six spec areas, each navigating', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const menu = await openAreaMenu(page);
        await expect(menu.locator('[data-menu-head]')).toBeVisible();
        expect(await ids(menu.locator('[data-area]'), 'data-area')).toEqual(SPEC_MENU_AREAS.map((area) => area.id));
        await expect(menu.locator('[data-page]')).toHaveCount(0);
        // spec 024: PAGE select (principal 2026-10-13): on a spec page the PAGE select names Specs, its menu marks Specs current
        await page.keyboard.press('Escape');
        const pageSelect = await headerControl(page, 'page');
        await expect(pageSelect).toContainText('Specs');
        await expect(pageSelect).toHaveAccessibleName('Page: Specs');
        const pages = await openPageMenu(page);
        await expect(pages.locator('[aria-current="page"]')).toHaveAttribute('data-page', 'specs');
        await expect(pages.locator('[data-area]')).toHaveCount(0);
        for (const area of SPEC_MENU_AREAS) {
          await page.goto('/w/harbor/s/002');
          await (await openAreaMenu(page)).locator(`[data-area="${area.id}"]`).click();
          await expect(page, area.id).toHaveURL((url) => url.pathname === area.path);
        }
      });

      test('the palette lists every workspace page and every new route, each navigating', async ({ page }) => {
        for (const place of PALETTE_PLACES) {
          await page.goto('/w/harbor');
          await expect(page.locator('header [data-control="palette"]')).toBeVisible();
          await page.keyboard.press('Meta+k');
          const palette = page.locator('app-command-palette dialog');
          await expect(palette).toBeVisible();
          // Filtered first, as a user finds it: the full list re-renders as its groups load.
          await palette.getByRole('combobox').fill(place.query);
          const option = palette.locator(`[role="option"][data-entry="${place.entry}"]`);
          await expect(option, place.entry).toHaveCount(1);
          await option.click();
          await expect(page, place.entry).toHaveURL((url) => place.lands(url.pathname));
        }
      });
    });
  }

  test.describe('settings and keys at 1440', () => {
    test.use(atWidth(1440));

    test('Settings · Workspaces is reached from the gear and from the Settings card', async ({ page }) => {
      await page.goto('/w/harbor');
      await viaSettings('workspaces')(page);
      await expect(page).toHaveURL((url) => url.pathname === '/settings/workspaces');
      await page.goto('/settings');
      await follow('main a[href="/settings/workspaces"]')(page);
      await expect(page).toHaveURL((url) => url.pathname === '/settings/workspaces');
    });

    // spec 024: PAGE select (principal 2026-10-13): the rail link gave way to the PAGE select, second in the row
    test('the PAGE select reaches the Library from the workspace page; no rail link is left', async ({ page }) => {
      await page.goto('/w/harbor');
      await expect(page.locator('header [data-control="page"]')).toBeVisible();
      await expect(page.locator('a[data-library-link]')).toHaveCount(0);
      await viaPage('library')(page);
      await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/library');
      await expect(page.locator('a[data-library-link]')).toHaveCount(0);
    });

    // Spec 048 (ISC-280, refines ISC-150.2): from 1120 px the Area select stands before the Spec select, in DOM, tab
    // and screen order.
    test('the header selects run Workspace · Page · Area · Spec, the Area select only on a spec page', async ({ page }) => {
      const order = (): Promise<Array<string | null>> =>
        page.locator('app-shell-nav [data-control]').evaluateAll((els) => els.map((el) => el.getAttribute('data-control')));
      await page.goto('/w/harbor/s/002');
      await expect(page.locator('header [data-control="area"]')).toBeVisible();
      expect(await order()).toEqual(['workspace', 'page', 'area', 'spec']);
      const labels = page.locator('app-shell-nav [data-control] [data-pill-label]');
      await expect(labels).toHaveText([/^workspace$/iu, /^page$/iu, /^area$/iu, /^spec$/iu]);
      const xs: number[] = [];
      for (const name of ['workspace', 'page', 'area', 'spec']) xs.push((await page.locator(`app-shell-nav [data-control="${name}"]`).boundingBox())?.x ?? -1);
      expect(xs).toEqual([...xs].sort((a, b) => a - b));
      await page.goto('/w/harbor');
      await expect(page.locator('header [data-control="page"]')).toBeVisible();
      expect(await order()).toEqual(['workspace', 'page', 'spec']);
      // spec 024: PAGE select without trigger icon (principal 2026-10-13): eyebrow, name and chevron only
      await expect(page.locator('header [data-control="page"] ui-icon')).toHaveCount(1);
      await expect(page.locator('header [data-control="page"] ui-icon')).toHaveAttribute('data-icon', 'chevron-down');
    });

    // Spec 048 (ISC-281): below 1120 px the Area stays an entry of the ⋯ menu; the row keeps the Spec select.
    test('the header selects at 820 keep Area in the ⋯ menu and the Spec select in the row', async ({ page }) => {
      await page.setViewportSize({ width: 820, height: 900 });
      await page.goto('/w/harbor/s/002');
      await expect(page.locator('app-shell-nav [data-control="spec"]')).toBeVisible();
      // The row only: the ⋯ menu's entries (area, zen, settings) carry data-control too.
      const row = await page
        .locator('app-shell-nav [data-control]')
        .evaluateAll((els) => els.filter((el) => el.closest('[data-menu]') === null).map((el) => el.getAttribute('data-control')));
      expect(row).toEqual(['workspace', 'page', 'spec']);
      await expect(page.locator('header [data-menu="more"] [data-control="area"]')).toHaveCount(1);
    });

    // Spec 058 (ISC-394): the workspace has two pages, the dashboard at its root and the spec list at `/specs`; the
    // workspace keys work from both, each once the page has rendered.
    const WORKSPACE_PAGES_READY = [
      { from: '/w/harbor', ready: 'app-dashboard-page [data-next-up]' },
      { from: '/w/harbor/specs', ready: '[data-panel="specs"] [data-spec-row]' },
    ] as const;
    for (const { from, ready } of WORKSPACE_PAGES_READY) {
      for (const [key, path] of [
        ['b', '/w/harbor/board'],
        ['f', '/w/harbor/planning/gantt'],
        ['m', '/w/harbor/planning/gantt'],
      ] as const) {
        test(`g ${key} navigates to ${path} from ${from}`, async ({ page }) => {
          await page.goto(from);
          await expect(page.locator(ready).first()).toBeVisible();
          await page.keyboard.press('g');
          await page.keyboard.press(key);
          await expect(page).toHaveURL((url) => url.pathname === path);
        });
      }
    }

    test('the shortcut sheet lists g b, g f and g m in the workspace context', async ({ page }) => {
      await page.goto('/w/harbor');
      await expect(page.locator('app-dashboard-page [data-next-up]').first()).toBeVisible();
      await page.keyboard.press('?');
      const workspace = page.locator('app-shortcut-sheet dialog [data-context="workspace"]');
      await expect(workspace).toBeVisible();
      for (const [id, key] of [
        ['go-board', 'b'],
        ['go-features', 'f'],
        ['go-milestones', 'm'],
      ] as const) {
        await expect(workspace.locator(`[data-binding="${id}"] kbd`), id).toHaveText(['g', key]);
      }
    });
  });

  /**
   * Spec 052 (T19): the Spec select lists only the workspace's favourites, so each switch test stars the spec it leaves
   * and the one it picks on harbor in its own stub session; `RESET_PATH` under the same session drops them again.
   */
  const starOnHarbor = async (page: Page, request: APIRequestContext, session: string, folders: readonly string[]): Promise<void> => {
    await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
    await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
    for (const folder of folders) {
      expect((await request.put(workspaceRoutes.favorite('harbor', folder), { headers: { [SESSION_HEADER]: session } })).ok()).toBe(true);
    }
  };

  // Spec 051 (ISC-294): the header's Spec select keeps the open area and tab, in the popover at 1440 and the bottom
  // sheet at 390; the new address survives a reload.
  for (const width of [1440, 390] as const) {
    test.describe(`spec switch at ${String(width)}`, () => {
      test.use(atWidth(width));

      test(`spec select keeps tab at ${String(width)}`, async ({ page, request }, info) => {
        const session = `navigation-switch-${info.testId}`;
        await starOnHarbor(page, request, session, ['002-web-console', '003-config-loader']);
        const timeline = async (): Promise<void> => {
          await expect(page.locator('app-tab-bar a[data-tab="timeline"]')).toHaveAttribute('aria-current', 'page');
          await expect(page.locator('app-tab-bar a[data-tab="timeline"]')).toBeVisible();
          await expect(page.locator('app-timeline-tab')).toBeVisible();
        };
        await page.goto('/w/harbor/s/002/timeline');
        await timeline();
        await (await headerControl(page, 'spec')).click();
        const picker = page.locator('nav[data-picker="spec"]');
        await expect(picker).toBeVisible();
        await expect(picker.locator(`xpath=ancestor::${width < 640 ? 'ui-sheet' : 'ui-popover'}`)).toHaveCount(1);
        await picker.locator('[data-spec="003"]').click();
        await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/s/003/timeline');
        await timeline();
        await page.reload();
        await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/s/003/timeline');
        await timeline();
        await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
      });
    });
  }
});
