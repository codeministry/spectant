/**
 * ISC-73 (T35 structure, T40 fills it): every route renders inside one shell with one header and its controls, the
 * shell reports its container tier, and the tab bar sits in the header at compact and in main above.
 * `bun run e2e -- shell` (`-g header` for the claim's probe). Against the stub API: a known spec renders its tab's view and
 * an unknown one the not-found page, decided from the dashboard.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { workspaceRoutes } from '../../server/src/spec-routes.contract.ts';
import { atWidth, expect, headerControl, test } from './fixtures';
import { RESET_PATH, SESSION_HEADER } from './stub-api';

const ROUTES = ['/', '/w/harbor', '/w/harbor/s/002', '/w/harbor/s/002/status', '/w/harbor/s/999', '/settings'] as const;
// spec 024: PAGE select (principal 2026-10-13); spec 048 (ISC-280): Workspace · Page · Area · Spec, the Area select only on a spec route
const CONTROLS = ['brand', 'workspace', 'page', 'area', 'spec', 'palette', 'live', 'zen', 'settings'] as const;
/** Outside a workspace the page, spec and area pills are left out rather than showing `0` (spec 019, ISC-140.2). */
const controlsOn = (route: string): readonly string[] =>
  route.includes('/s/')
    ? CONTROLS
    : route.startsWith('/w/')
      ? CONTROLS.filter((control) => control !== 'area')
      : CONTROLS.filter((control) => control !== 'page' && control !== 'spec' && control !== 'area');
// spec 024: one-row header on every width (principal 2026-10-13): below 1120 the area, zen and settings controls are entries of the overflow
// menu `⋯` (`data-tool="more"`), each carrying its `data-control`; `reveal` opens the menu first.
const OVERFLOW = new Set<string>(['area', 'zen', 'settings']);
const reveal = async (page: Page, width: number, name: string): Promise<void> => {
  if (width < 1120 && OVERFLOW.has(name)) await page.locator('header [data-tool="more"]').click();
};
/**
 * Spec 052 (T19): the header spec select lists only the workspace's favourites, so a test that picks from it stars
 * `folders` on harbor in its own stub session first; `RESET_PATH` under the same session drops them again.
 */
async function starOnHarbor(page: Page, request: APIRequestContext, session: string, folders: readonly string[]): Promise<void> {
  await page.context().setExtraHTTPHeaders({ [SESSION_HEADER]: session });
  await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
  for (const folder of folders) {
    expect((await request.put(workspaceRoutes.favorite('harbor', folder), { headers: { [SESSION_HEADER]: session } })).ok()).toBe(true);
  }
}
const TIERS = [
  // spec 024: prototype tab bar under the header on every width (principal 2026-10-12, design.md)
  { width: 390, tier: 'compact', tabBar: 'main' },
  { width: 820, tier: 'medium', tabBar: 'main' },
  { width: 1440, tier: 'wide', tabBar: 'main' },
] as const;

for (const { width, tier, tabBar } of TIERS) {
  test.describe(`shell at ${String(width)}`, () => {
    test.use(atWidth(width));

    for (const route of ROUTES) {
      test(`one header with every control on ${route}`, async ({ page }) => {
        await page.goto(route);
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);
        await expect(page.locator('header')).toHaveCount(1);
        for (const control of controlsOn(route).filter((name) => width >= 1120 || !OVERFLOW.has(name))) {
          await expect(page.locator(`header [data-control="${control}"]`), control).toBeVisible();
        }
        // spec 024: one-row header on every width (principal 2026-10-13)
        await reveal(page, width, 'zen');
        for (const control of controlsOn(route).filter((name) => OVERFLOW.has(name))) {
          await expect(page.locator(`header [data-control="${control}"]`), control).toBeVisible();
        }
      });
    }

    test(`tab bar in ${tabBar} on a spec tab`, async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      await expect(page.locator('app-tab-bar')).toHaveCount(1);
      await expect(page.locator(`${tabBar} app-tab-bar`)).toHaveCount(1);
      // spec 024: prototype tab bar under the header on every width (principal 2026-10-12, design.md)
      await expect(page.locator('header app-tab-bar')).toHaveCount(0);
      const band = page.locator('app-tab-bar-slot');
      await expect(band).toHaveCSS('position', 'sticky');
      await expect(band).toHaveCSS('top', '64px');
      await expect(page.locator('app-tab-bar a[aria-current="page"]')).toHaveAttribute('data-tab', 'status');
    });

    test('not-found page for a spec the dashboard does not list', async ({ page }) => {
      await page.goto('/w/harbor/s/999');
      await expect(page.locator('[data-page="not-found"]')).toBeVisible();
      await expect(page.locator('app-tab-bar')).toHaveCount(0);
    });

    test('header controls lead where they say: workspace, spec, area menu, live, settings', async ({ page }) => {
      const control = (name: string) => page.locator(`header [data-control="${name}"]`);

      // A plain click opens the picker; its entries are the links.
      await page.goto('/w/harbor/s/002');
      // The pickers open once the deferred menus have loaded (until then a plain click navigates, ShellNav);
      // `headerControl` waits for them.
      await (await headerControl(page, 'workspace')).click();
      await page.locator('[data-picker="workspace"] [data-workspace="harbor"]').click();
      await expect(page).toHaveURL(/\/w\/harbor$/);

      await control('spec').click();
      await page.locator('[data-picker="spec"] .picker-all').click();
      await expect(page).toHaveURL(/\/w\/harbor#specs$/);
      await expect(page.locator('#specs')).toBeFocused();

      await page.goto('/w/harbor/s/002/status');
      const area = control('area');
      // spec 024: one-row header on every width (principal 2026-10-13): the area menu returns focus to its trigger, `⋯` below 1120
      const areaTrigger = width < 1120 ? page.locator('header [data-tool="more"]') : area;
      await reveal(page, width, 'area');
      await area.click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();
      await expect(menu.locator('[data-area]')).toHaveCount(6);
      await expect(menu.locator('[data-area][aria-disabled="true"]')).toHaveCount(0);
      await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-area', 'status');
      await menu.locator('[data-area="data"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);
      await expect(menu).toBeHidden();
      await expect(areaTrigger).toBeFocused();

      await reveal(page, width, 'area');
      await area.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(areaTrigger).toBeFocused();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);

      // spec 024 T40: the indicator opens the live popover (prototype `pop-live`); its round-board entry leads there.
      await control('live').click();
      await page.locator('[data-live-board]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/board$/);

      // spec 024 T40/T52: settings opens the settings popover; its "Workspaces…" entry leads to /settings/workspaces
      await (await headerControl(page, 'settings')).click();
      await page.locator('[data-menu="settings"] [data-settings-link="workspaces"]').click();
      await expect(page).toHaveURL(/\/settings\/workspaces$/);
      await expect(page.locator('[data-page="settings-workspaces"] h1')).toBeVisible();
      await expect(page.locator('header')).toHaveCount(1);
    });

    test('header pickers open real lists: choose a workspace, then a spec (T36)', async ({ page, request }, info) => {
      const session = `shell-pickers-${info.testId}`;
      await starOnHarbor(page, request, session, ['002-web-console', '003-config-loader']);
      const control = (name: string) => page.locator(`header [data-control="${name}"]`);
      await page.goto('/w/harbor/s/002');

      const workspace = await headerControl(page, 'workspace');
      await workspace.click();
      await expect(workspace).toHaveAttribute('aria-expanded', 'true');
      const workspaces = page.locator('[data-picker="workspace"]');
      await expect(workspaces).toBeVisible();
      await expect(workspaces.locator('[data-workspace]')).toHaveCount(2);
      await expect(workspaces.locator('[aria-current="true"]')).toHaveAttribute('data-workspace', 'harbor');
      await expect(workspaces.locator('[aria-current="true"]')).toBeFocused();
      await expect(workspaces.locator('[data-picker-footer]')).toHaveAttribute('href', '/settings');
      await workspaces.locator('[data-workspace="lantern"]').click();
      await expect(page).toHaveURL(/\/w\/lantern$/);
      await expect(workspaces).toBeHidden();

      await page.goto('/w/harbor/s/002');
      const spec = control('spec');
      await spec.click();
      const specs = page.locator('[data-picker="spec"]');
      await expect(specs).toBeVisible();
      await expect(specs.locator('[aria-current="true"]')).toHaveAttribute('data-spec', '002');
      await expect(specs.locator('[aria-current="true"]')).toBeFocused();
      const other = specs.locator('[data-spec]:not([aria-current])').first();
      const otherId = await other.getAttribute('data-spec');
      await expect(other.locator('ui-chip')).toBeVisible();
      await other.click();
      await expect(page).toHaveURL(new RegExp(`/w/harbor/s/${otherId ?? ''}$`));
      await expect(specs).toBeHidden();
      await request.post(RESET_PATH, { headers: { [SESSION_HEADER]: session } });
    });

    test('a modified click on a picker leaves the picker shut and keeps the href (T36)', async ({ page }) => {
      await page.goto('/w/harbor/s/002');
      const workspace = await headerControl(page, 'workspace');
      await expect(workspace).toHaveAttribute('href', '/w/harbor');
      await workspace.click({ button: 'middle' });
      await expect(workspace).toHaveAttribute('aria-expanded', 'false');
    });

    test('one header row on every width, every element 40 px tall; the rail hugs its 40 px segments (T36, spec 024)', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const header = page.locator('header');
      await expect(header).toHaveCount(1);
      const box = async (selector: string) => (await page.locator(selector).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      const head = await box('header');
      const brand = await box('header [data-control="brand"]');
      const area = await box('header [data-control="area"]');
      const pickers = await box('header .pickers');
      // spec 024: one-row header on every width (principal 2026-10-13)
      expect(head.height).toBeGreaterThanOrEqual(64);
      // spec 024: one-row header on every width (principal 2026-10-13)
      expect(head.height).toBeLessThanOrEqual(65);
      expect(pickers.height).toBeLessThanOrEqual(42);
      if (width >= 1120) expect(Math.abs(area.y - brand.y)).toBeLessThan(12);
      // spec 024: one-row header on every width (principal 2026-10-13): every element of the row is 40 px tall and on its centre line
      const tools = width >= 1120 ? ['[data-control="zen"]', '[data-tool="assistant"]', '[data-control="settings"]', '[data-tool="help"]'] : ['[data-tool="more"]'];
      for (const selector of ['.rail-field', '[data-control="palette"]', 'app-shell-live .group', ...tools]) {
        const part = await box(`header ${selector}`);
        expect(Math.round(part.height), selector).toBe(40);
        expect(Math.abs(part.y + part.height / 2 - (head.y + 32)), selector).toBeLessThan(1.5);
      }
      const palette = await box('header [data-control="palette"]');
      // spec 024: prototype palette rule (principal 2026-10-12): a spec page keeps the 40 px icon below 1560
      expect(Math.round(palette.width)).toBe(40);
      // spec 024: prototype palette rule (principal 2026-10-12)
      await expect(page.locator('header .palette-key')).toBeHidden();
    });

    test('a known spec tab renders its own view, never the placeholder or not-found', async ({ page }) => {
      // Every tab has its view since the Matrix tab landed (T87); the last one built stands in for all of them.
      await page.goto('/w/harbor/s/002/matrix');
      await expect(page.locator('[data-page="matrix"]')).toBeVisible();
      await expect(page.locator('[data-page="placeholder"]')).toHaveCount(0);
      await expect(page.locator('[data-page="not-found"]')).toHaveCount(0);
    });
  });
}

/**
 * ISC-73 (T40): the claim's probe, `bun run e2e -- shell -g header`. Exactly one `<header>` and one `app-shell` on
 * every route, a spec tab and an unknown path included, with the seven named controls (brand is the eighth slot); the
 * spec picker shows the name at wide and the mono id at compact while a spec is open, the count otherwise; the palette
 * is the field at wide and an icon button at compact; the settings control names help and leads to it. Where each
 * control leads is "header controls lead where they say" above and is not repeated here.
 */
test.describe('header', () => {
  const HEADER_ROUTES = ['/', '/w/harbor', '/w/harbor/s/002', '/w/harbor/s/002/claims', '/no/such/path'] as const;
  const SPEC_OPEN = new Set<string>(['/w/harbor/s/002', '/w/harbor/s/002/claims']);

  for (const width of [390, 1440] as const) {
    test.describe(`at ${String(width)}`, () => {
      test.use(atWidth(width));
      const wide = width === 1440;

      for (const route of HEADER_ROUTES) {
        test(`one header with workspace, spec, area, palette, live, zen and settings on ${route} at ${String(width)}`, async ({ page }) => {
          await page.goto(route);
          const shell = page.locator('app-shell');
          await expect(shell).toHaveAttribute('data-tier', wide ? 'wide' : 'compact');
          await expect(shell).toHaveCount(1);
          await expect(page.locator('app-shell app-shell')).toHaveCount(0);
          await expect(page.locator('header')).toHaveCount(1);
          await expect(page.locator('[role="banner"]')).toHaveCount(1);
          const header = page.locator('header');
          for (const control of controlsOn(route)) {
            await expect(header.locator(`[data-control="${control}"]`), control).toHaveCount(1);
            if (wide || !OVERFLOW.has(control)) await expect(header.locator(`[data-control="${control}"]`), control).toBeVisible();
          }

          const spec = header.locator('[data-control="spec"]');
          if (SPEC_OPEN.has(route)) {
            const id = spec.locator('.pick-id');
            await expect(id).toHaveText('002');
            await expect(id).toBeVisible();
            await expect(id).toHaveCSS('font-family', /mono/i);
            // spec 024: one-row header on every width (principal 2026-10-13): id and short name on every width, the name ellipsizing
            await expect(spec.locator('.spec-title')).toBeVisible();
            // The name comes from the dashboard row (`ShellData.currentRow`), not from the spec head's title.
            await expect(spec.locator('.spec-title')).toHaveText(/^(?!002$)\S.*\S$/);
            await expect(spec).toHaveAttribute('aria-label', /002/);
          } else if (!route.startsWith('/w/')) {
            await expect(spec).toHaveCount(0);
          } else {
            await expect(spec.locator('.pick-id')).toHaveCount(0);
            await expect(spec.locator('.pick-text')).toHaveText(/^\d+$/);
            await expect(spec.locator('.pick-text')).toBeVisible();
          }

          const palette = header.locator('[data-control="palette"]');
          await expect(palette).toHaveAttribute('aria-label', /\S/);
          await expect(palette.locator('ui-icon')).toBeVisible();
          // spec 024: prototype palette rule (principal 2026-10-12): the field at wide off spec pages, the icon on spec pages below 1560
          const field = wide && !SPEC_OPEN.has(route);
          await expect(palette.locator('.palette-text')).toBeVisible({ visible: field });
          // spec 024: prototype palette rule (principal 2026-10-12)
          await expect(palette.locator('.palette-key')).toBeVisible({ visible: field });

          await expect(header.locator('[data-control="settings"]')).toHaveAttribute('aria-label', /help/i);
        });
      }

      test(`header settings control reaches help at ${String(width)}`, async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        // spec 024 T40/T52: the settings popover holds Help & guide (→ /help) and Workspaces… (→ /settings/workspaces);
        // the settings page itself, with its shortcuts action, is then opened at /settings.
        // The settings panel lives in the deferred menus; before they mount the button leads to /settings (its fallback),
        // so `headerControl` waits for them.
        await (await headerControl(page, 'settings')).click();
        // An href alone does not prove the panel opened (spec 057, ISC-385): it must be visible and hold the focus.
        const panel = page.locator('[data-menu="settings"]');
        await expect(panel).toBeVisible();
        await expect.poll(() => panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
        await expect(panel.locator('[data-settings-link="help"]')).toBeVisible();
        await expect(panel.locator('[data-settings-link="help"]')).toHaveAttribute('href', '/help');
        await page.locator('[data-menu="settings"] [data-settings-link="workspaces"]').click();
        await expect(page).toHaveURL(/\/settings\/workspaces$/);
        await page.goto('/settings');
        const help = page.locator('[data-page="settings"] [data-action="shortcuts"]');
        await expect(help).toBeVisible();
        await help.click();
        const sheet = page.locator('app-shortcut-sheet dialog');
        await expect(sheet).toBeVisible();
        await expect(sheet.locator('[data-binding]').first()).toBeVisible();
        // The sheet's own title bar is a `<header>` inside the modal dialog (`ui-sheet`), not a second shell header.
        await expect(page.locator('header:not(dialog header)')).toHaveCount(1);
        await expect(page.locator('[role="banner"]')).toHaveCount(1);
      });
    });
  }
});

/**
 * ISC-75 (T38): zen hides the header tools, the spec head and the rail, keeps the sticky tab bar and shows the footer
 * status bar; the rail's collapsed state is `railCollapsed` in `/api/settings` and survives a reload.
 * `bun run e2e -- shell -g zen`. Each block names its own stub session and resets it first, so a stored
 * `railCollapsed` never leaks into another case, worker or retry.
 */
test.describe('zen', () => {
  const TOOLS = ['palette', 'live', 'settings'] as const;
  const session = (id: string): void => {
    test.use({ extraHTTPHeaders: { 'X-Spectant-Stub-Session': id } });
    test.beforeEach(async ({ request }) => {
      await request.post('/api/__stub/reset', { headers: { 'X-Spectant-Stub-Session': id } });
    });
  };

  test.describe('at 1440', () => {
    test.use(atWidth(1440));
    session('zen-wide');

    test('zen hides the three tools, the spec head and the rail, keeps the tab bar, shows the footer bar; again restores', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const zen = page.locator('header [data-control="zen"]');
      const head = page.locator('app-spec-page .spec-head');
      const rail = page.locator('aside.shell-rail');
      const footer = page.locator('[data-zen-footer]');
      await expect(head).toBeVisible();
      await expect(rail).toBeVisible();
      await expect(footer).toHaveCount(0);

      await zen.click();
      await expect(zen).toHaveAttribute('aria-pressed', 'true');
      for (const tool of TOOLS) await expect(page.locator(`header [data-control="${tool}"]`), tool).toBeHidden();
      for (const kept of ['brand', 'workspace', 'page', 'spec', 'area']) {
        await expect(page.locator(`header [data-control="${kept}"]`), kept).toBeVisible();
      }
      await expect(head).toBeHidden();
      await expect(rail).toBeHidden();
      await expect(page.locator('main app-tab-bar')).toBeVisible();
      await expect(footer).toBeVisible();
      await expect(footer.locator('[data-zen-part="id"]')).toHaveText('002');
      await expect(footer.locator('[data-zen-part="title"]')).toHaveText('Web console');
      await expect(footer.locator('[data-zen-part="claims"]')).toContainText('25/30');
      await expect(footer.locator('ui-command-chip')).toContainText('/spec implement 002');
      // The bar slides in from 8 px below (prototype `zen-statusbar`); measure it once its entry has finished.
      await footer.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
      const box = await footer.boundingBox();
      // spec 024: prototype value (principal: the prototype wins) — the prototype `zen-statusbar` is 36 px.
      expect(box?.height).toBe(36);
      expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBe(900);
      // The main column takes the full width once the rail is gone (1440 - 2 × 32).
      expect((await page.locator('main').boundingBox())?.width).toBe(1376);

      await zen.click();
      await expect(zen).toHaveAttribute('aria-pressed', 'false');
      for (const tool of TOOLS) await expect(page.locator(`header [data-control="${tool}"]`), tool).toBeVisible();
      await expect(head).toBeVisible();
      await expect(rail).toBeVisible();
      await expect(footer).toHaveCount(0);
    });
  });

  test.describe('rail at 1440', () => {
    test.use(atWidth(1440));
    session('zen-rail');

    test('zen spec: the rail collapse toggle stores railCollapsed through /api/settings and a reload keeps the strip', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const shell = page.locator('app-shell');
      const collapse = page.locator('aside.shell-rail [data-control="rail-collapse"]');
      await expect(collapse).toHaveAttribute('aria-expanded', 'true');
      // spec 024: prototype rail fold with the app's counts (principal 2026-10-13): the `›` sits just outside the
      // rail's top-left edge (prototype `.rail-tools`), not above the rail's content.
      const [tool, rail] = await Promise.all([collapse.boundingBox(), page.locator('aside.shell-rail').boundingBox()]);
      expect((tool?.x ?? 0) + (tool?.width ?? 0)).toBeLessThanOrEqual(rail?.x ?? 0);
      expect(tool?.y ?? 0).toBeCloseTo(rail?.y ?? 0, 0);

      const stored = page.waitForResponse((res) => res.url().endsWith('/api/settings') && res.request().method() === 'PUT');
      await collapse.click();
      const answer = await stored;
      expect(((await answer.json()) as { railCollapsed?: boolean }).railCollapsed).toBe(true);
      await expect(shell).toHaveAttribute('data-rail-collapsed', '');
      const strip = page.locator('aside.shell-rail[data-rail-strip]');
      await expect(strip).toBeVisible();
      await expect(page.locator('app-rail-slot')).toHaveCount(0);
      // spec 024: prototype rail fold with the app's counts (principal 2026-10-13): focus moves to the `‹` tab.
      await expect(page.locator('aside.shell-rail [data-control="rail-expand"]')).toBeFocused();
      // spec 024: prototype rail fold with the app's counts (principal 2026-10-13): the column eases over 240 ms
      // (`--dur-sheet`); poll until it settles at the prototype's 32 px track (`--rail-space`).
      await expect.poll(async () => (await strip.boundingBox())?.width).toBe(32);

      await page.reload();
      await expect(shell).toHaveAttribute('data-rail-collapsed', '');
      const expand = page.locator('aside.shell-rail [data-control="rail-expand"]');
      await expect(expand).toHaveAttribute('aria-expanded', 'false');

      await expand.click();
      await expect(shell).not.toHaveAttribute('data-rail-collapsed');
      // spec 024: prototype rail fold with the app's counts (principal 2026-10-13): focus moves back to the `›`.
      await expect(collapse).toBeFocused();
      await expect(page.locator('app-rail-slot')).toBeVisible();
      await page.reload();
      await expect(page.locator('app-rail-slot')).toBeVisible();
    });
  });

  test.describe('at 390', () => {
    test.use(atWidth(390));
    session('zen-compact');

    test('zen at compact: the footer bar replaces the spec head, the header row stays', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const zen = page.locator('header [data-control="zen"]');
      // spec 024: one-row header on every width (principal 2026-10-13): zen is an entry of the overflow menu
      await reveal(page, 390, 'zen');
      await zen.click();
      await expect(page.locator('app-spec-page .spec-head')).toBeHidden();
      for (const tool of TOOLS) await expect(page.locator(`header [data-control="${tool}"]`), tool).toBeHidden();
      // spec 024: prototype tab bar under the header on every width (principal 2026-10-12, design.md)
      await expect(page.locator('main app-tab-bar')).toBeVisible();
      const footer = page.locator('[data-zen-footer]');
      await expect(footer).toBeVisible();
      await expect(footer.locator('[data-zen-part="id"]')).toHaveText('002');
      await expect(footer.locator('[data-zen-part="claims"]')).toContainText('25/30');
      await expect(footer.locator('ui-command-chip')).toBeVisible();
      await expect(footer.locator('[data-zen-part="title"]')).toBeHidden();
      expect((await footer.boundingBox())?.width).toBe(390);

      await reveal(page, 390, 'zen');
      await zen.click();
      await expect(page.locator('app-spec-page .spec-head')).toBeVisible();
      await expect(footer).toHaveCount(0);
    });
  });
});

/**
 * Spec 057 (ISC-382): holds the lazy chunk of the deferred header menus (the one script that carries the settings
 * panel) until `release` is called, so a test sees the header before the `@defer` block has mounted. `held` resolves
 * once the browser has asked for the chunk.
 */
async function holdMenusChunk(page: Page): Promise<{ held: Promise<void>; release: () => void }> {
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markHeld = (): void => undefined;
  const held = new Promise<void>((resolve) => {
    markHeld = resolve;
  });
  await page.route('**/*.js', async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    if (body.includes('settings-panel')) {
      markHeld();
      await released;
    }
    await route.fulfill({ response, body });
  });
  return { held, release };
}

test.describe('deferred header menus', () => {
  test.use(atWidth(1440));

  test('menus ready resolves only after the deferred menus have mounted', async ({ page }) => {
    const chunk = await holdMenusChunk(page);
    await page.goto('/w/harbor/s/002');
    await chunk.held;
    await expect(page.locator('header [data-control="settings"]')).toBeVisible();

    // `headerControl` waits through the fixtures' menus-ready helper before it hands out a control.
    let ready = false;
    const waiting = headerControl(page, 'settings').then((control) => {
      ready = true;
      return control;
    });
    // Two frames with the chunk still held: the block has not mounted, so the helper must still be waiting.
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('app-shell-menus')).toHaveCount(0);
    expect(ready).toBe(false);

    chunk.release();
    const settings = await waiting;
    // Resolved: the menus are mounted and the settings button opens their panel instead of its /settings fallback.
    expect(await page.locator('app-shell-menus').count()).toBe(1);
    await settings.click();
    await expect(page.locator('[data-menu="settings"]')).toBeVisible();
    await expect(page).toHaveURL(/\/w\/harbor\/s\/002$/);
  });

  // Spec 057 (ISC-386): before the deferred menus have mounted, the settings gear still leads somewhere: the
  // settings page, through the navigate fallback in `ShellNav.toggle`.
  test('settings fallback before mount', async ({ page }) => {
    const chunk = await holdMenusChunk(page);
    await page.goto('/w/harbor/s/002');
    await chunk.held;
    // Clicked directly, not through `headerControl`, which would wait for the mount the test holds back.
    const gear = page.locator('header [data-control="settings"]');
    await expect(gear).toBeVisible();
    await expect(page.locator('app-shell-menus')).toHaveCount(0);
    try {
      await gear.click();
      await expect(page).toHaveURL(/\/settings$/);
    } finally {
      chunk.release();
    }
  });
});
