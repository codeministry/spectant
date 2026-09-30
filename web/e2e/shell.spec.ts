/**
 * ISC-73 (T35 structure, T40 fills it): every route renders inside one shell with one header and its controls, the
 * shell reports its container tier, and the tab bar sits in the header at compact and in main above.
 * `bun run e2e -- shell` (`-g header` for the claim's probe). Against the stub API: a known spec renders its tab's view and
 * an unknown one the not-found page, decided from the dashboard.
 */
import { atWidth, expect, test } from './fixtures';

const ROUTES = ['/', '/w/harbor', '/w/harbor/s/002', '/w/harbor/s/002/status', '/w/harbor/s/999', '/settings'] as const;
const CONTROLS = ['brand', 'workspace', 'spec', 'area', 'palette', 'live', 'zen', 'settings'] as const;
const TIERS = [
  { width: 390, tier: 'compact', tabBar: 'header' },
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
        for (const control of CONTROLS) {
          await expect(page.locator(`header [data-control="${control}"]`), control).toBeVisible();
        }
      });
    }

    test(`tab bar in ${tabBar} on a spec tab`, async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      await expect(page.locator('app-tab-bar')).toHaveCount(1);
      await expect(page.locator(`${tabBar} app-tab-bar`)).toHaveCount(1);
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
      await control('workspace').click();
      await page.locator('[data-picker="workspace"] [data-workspace="harbor"]').click();
      await expect(page).toHaveURL(/\/w\/harbor$/);

      await control('spec').click();
      await page.locator('[data-picker="spec"] .picker-all').click();
      await expect(page).toHaveURL(/\/w\/harbor#specs$/);
      await expect(page.locator('#specs')).toBeFocused();

      await page.goto('/w/harbor/s/002/status');
      const area = control('area');
      await area.click();
      const menu = page.getByRole('navigation', { name: 'Areas' });
      await expect(menu).toBeVisible();
      await expect(menu.locator('[data-area]')).toHaveCount(6);
      await expect(menu.locator('[data-area][aria-disabled="true"]')).toHaveCount(0);
      await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-area', 'status');
      await menu.locator('[data-area="data"]').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);
      await expect(menu).toBeHidden();
      await expect(area).toBeFocused();

      await area.click();
      await expect(menu).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(area).toBeFocused();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/claims$/);

      await control('live').click();
      await expect(page).toHaveURL(/\/w\/harbor\/s\/002\/board$/);

      await control('settings').click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.locator('[data-page="settings"] h1')).toBeVisible();
      await expect(page.locator('header')).toHaveCount(1);
    });

    test('header pickers open real lists: choose a workspace, then a spec (T36)', async ({ page }) => {
      const control = (name: string) => page.locator(`header [data-control="${name}"]`);
      await page.goto('/w/harbor/s/002');

      const workspace = control('workspace');
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
    });

    test('a modified click on a picker leaves the picker shut and keeps the href (T36)', async ({ page }) => {
      await page.goto('/w/harbor/s/002');
      const workspace = page.locator('header [data-control="workspace"]');
      await expect(workspace).toHaveAttribute('href', '/w/harbor');
      await page.locator('[data-picker="workspace"]').first().waitFor({ state: 'attached' });
      await workspace.click({ button: 'middle' });
      await expect(workspace).toHaveAttribute('aria-expanded', 'false');
    });

    test('one header row at medium and wide, two at compact; the pill hugs its 40 px segments (T36)', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const header = page.locator('header');
      await expect(header).toHaveCount(1);
      const box = async (selector: string) => (await page.locator(selector).first().boundingBox()) ?? { x: 0, y: 0, width: 0, height: 0 };
      const head = await box('header');
      const brand = await box('header [data-control="brand"]');
      const area = await box('header [data-control="area"]');
      const pickers = await box('header .pickers');
      if (width < 640) {
        expect(head.height).toBeGreaterThanOrEqual(92);
        expect(head.height).toBeLessThanOrEqual(93);
        expect(area.y).toBeGreaterThanOrEqual(brand.y + brand.height - 1);
        expect(pickers.height).toBeLessThanOrEqual(42);
      } else {
        expect(head.height).toBeGreaterThanOrEqual(64);
        expect(head.height).toBeLessThanOrEqual(65);
        expect(Math.abs(area.y - brand.y)).toBeLessThan(12);
      }
      const palette = await box('header [data-control="palette"]');
      expect(Math.round(palette.width)).toBe(width >= 1280 ? 240 : 40);
      await expect(page.locator('header .palette-key')).toBeVisible({ visible: width >= 1280 });
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
          for (const control of CONTROLS) {
            await expect(header.locator(`[data-control="${control}"]`), control).toHaveCount(1);
            await expect(header.locator(`[data-control="${control}"]`), control).toBeVisible();
          }

          const spec = header.locator('[data-control="spec"]');
          if (SPEC_OPEN.has(route)) {
            const id = spec.locator('.pick-id');
            await expect(id).toHaveText('002');
            await expect(id).toBeVisible();
            await expect(id).toHaveCSS('font-family', /mono/i);
            await expect(spec.locator('.spec-title')).toBeVisible({ visible: wide });
            // The name comes from the dashboard row (`ShellData.currentRow`), not from the spec head's title.
            if (wide) await expect(spec.locator('.spec-title')).toHaveText(/^(?!002$)\S.*\S$/);
            await expect(spec).toHaveAttribute('aria-label', /002/);
          } else {
            await expect(spec.locator('.pick-id')).toHaveCount(0);
            await expect(spec.locator('.pick-text')).toHaveText(/^\d+$/);
            await expect(spec.locator('.pick-text')).toBeVisible();
          }

          const palette = header.locator('[data-control="palette"]');
          await expect(palette).toHaveAttribute('aria-label', /\S/);
          await expect(palette.locator('ui-icon')).toBeVisible();
          await expect(palette.locator('.palette-text')).toBeVisible({ visible: wide });
          await expect(palette.locator('.palette-key')).toBeVisible({ visible: wide });

          await expect(header.locator('[data-control="settings"]')).toHaveAttribute('aria-label', /help/i);
        });
      }

      test(`header settings control reaches help at ${String(width)}`, async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        await page.locator('header [data-control="settings"]').click();
        await expect(page).toHaveURL(/\/settings$/);
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
      for (const kept of ['brand', 'workspace', 'spec', 'area']) {
        await expect(page.locator(`header [data-control="${kept}"]`), kept).toBeVisible();
      }
      await expect(head).toBeHidden();
      await expect(rail).toBeHidden();
      await expect(page.locator('main app-tab-bar')).toBeVisible();
      await expect(footer).toBeVisible();
      await expect(footer.locator('[data-zen-part="id"]')).toHaveText('002');
      await expect(footer.locator('[data-zen-part="title"]')).toHaveText('Web console');
      await expect(footer.locator('[data-zen-part="claims"]')).toContainText('25/30');
      await expect(footer.locator('ui-command-chip')).toContainText('/spec-implement 002');
      const box = await footer.boundingBox();
      expect(box?.height).toBe(40);
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

      const stored = page.waitForResponse((res) => res.url().endsWith('/api/settings') && res.request().method() === 'PUT');
      await collapse.click();
      const answer = await stored;
      expect(((await answer.json()) as { railCollapsed?: boolean }).railCollapsed).toBe(true);
      await expect(shell).toHaveAttribute('data-rail-collapsed', '');
      const strip = page.locator('aside.shell-rail[data-rail-strip]');
      await expect(strip).toBeVisible();
      await expect(page.locator('app-rail-slot')).toHaveCount(0);
      // The column eases over 240 ms (`--motion-duration-base`); poll until it settles at the strip's 48 px.
      await expect.poll(async () => (await strip.boundingBox())?.width).toBe(48);

      await page.reload();
      await expect(shell).toHaveAttribute('data-rail-collapsed', '');
      const expand = page.locator('aside.shell-rail [data-control="rail-expand"]');
      await expect(expand).toHaveAttribute('aria-expanded', 'false');

      await expand.click();
      await expect(shell).not.toHaveAttribute('data-rail-collapsed');
      await expect(page.locator('app-rail-slot')).toBeVisible();
      await page.reload();
      await expect(page.locator('app-rail-slot')).toBeVisible();
    });
  });

  test.describe('at 390', () => {
    test.use(atWidth(390));
    session('zen-compact');

    test('zen at compact: the footer bar replaces the spec head, both header rows stay', async ({ page }) => {
      await page.goto('/w/harbor/s/002/status');
      const zen = page.locator('header [data-control="zen"]');
      await zen.click();
      await expect(page.locator('app-spec-page .spec-head')).toBeHidden();
      for (const tool of TOOLS) await expect(page.locator(`header [data-control="${tool}"]`), tool).toBeHidden();
      await expect(page.locator('header app-tab-bar')).toBeVisible();
      const footer = page.locator('[data-zen-footer]');
      await expect(footer).toBeVisible();
      await expect(footer.locator('[data-zen-part="id"]')).toHaveText('002');
      await expect(footer.locator('[data-zen-part="claims"]')).toContainText('25/30');
      await expect(footer.locator('ui-command-chip')).toBeVisible();
      await expect(footer.locator('[data-zen-part="title"]')).toBeHidden();
      expect((await footer.boundingBox())?.width).toBe(390);

      await zen.click();
      await expect(page.locator('app-spec-page .spec-head')).toBeVisible();
      await expect(footer).toHaveCount(0);
    });
  });
});
