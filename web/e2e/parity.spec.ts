/**
 * ISC-149: the elements the parity table (spec 024) marks as missing appear in the app where the prototype puts them.
 * `bun run e2e -- parity -g elements` is the claim's probe. Every group of this file is one `test.describe` named after
 * its probe word (`elements`, `icons`; `demo`, `routes`, `navigation` follow), so `-g <word>` runs one group.
 *
 * Group `elements`, pilot scope: the spec dashboard's Spec context (018-B14) and the workspace dashboard's Warnings
 * list (018-B15), against the stub API's harbor workspace (`core/fixtures/harbor*.golden.json`). The tests only read,
 * so they share the default stub session.
 *
 * Hook contract (the implementation renders these; nothing else in this file depends on markup):
 *
 *   Spec context, spec dashboard `/w/:ws/s/:id`
 *   - `[data-spec-context]`              the Spec context root. From 1120 px it sits in the 352 px rail
 *                                        (`aside.shell-rail`); below 1120 px it is the last block of the dashboard's
 *                                        main column (inside `main#main`, below every other `[data-section]`).
 *   - `#waiting`                         exactly one visible element per width, inside the visible Spec context: the
 *                                        KPI "Waiting on you" links to it on the dashboard itself (018-B10).
 *   - `[data-context-block="waiting" | "warnings" | "gates"]`
 *                                        the three blocks, in this order, each with a heading (Waiting on you,
 *                                        Warnings, Gates).
 *   - `[data-count-badge]`               the count badge in the heading row of the waiting and warnings blocks.
 *   - `[data-waiting-item]`              one per waiting item, with `data-waiting-kind` (`operator` | `manual` |
 *                                        `question`) and `data-waiting-ref` (the task or claim id); it holds
 *                                        `[data-waiting-kind-label]`, the plain chip with the kind word.
 *   - `[data-context-warning]`           one per warning of the spec; `[data-warning-command]` inside holds its
 *                                        command when the warning has one.
 *   - `[data-gate-row]`                  one per gate, `data-gate` = `reviewed` | `codeReviewed` | `drift` |
 *                                        `diagrams`, its value in `[data-gate-value]`.
 *   - `[data-context-kbd]`               the key line `[ ] previous / next spec · Esc workspace` below the blocks
 *                                        (rail only).
 *   - `[data-demo-chip]`                 the demo chip (word `demo`) on every mocked block or item (ISC-149.1);
 *                                        Spec context carries none: core delivers all three kinds, warnings and
 *                                        gates (`core/src/spec.ts`), so nothing in it is a mock.
 *
 *   Warnings list, workspace dashboard `/w/:ws`
 *   - `[data-warnings-list]`             the list root: below 1120 px in the main column after Next up
 *                                        (`[data-next-up]`), from 1120 px in the rail after Next up.
 *   - `[data-warning-spec]`              one group per spec with warnings (value: the spec id), holding the spec link
 *                                        `[data-warning-link]` (text: the id), each `[data-warning-text]` and the
 *                                        command as `ui-command-chip`.
 *   - `[data-warnings-empty]`            the "No warnings" line when no spec has one.
 *
 * Group `demo` (ISC-149.1) and group `routes` (ISC-150): hook contract for T49–T55. Both groups run at 1440 unless a
 * test names another width; the `demo` tests run in their own stub session and only read.
 *
 *   The mock convention (`web/src/app/shared/demo/demo-data.ts`)
 *   - `[data-demo]`                      the root of every mocked block, item or whole mocked page; rendered only
 *                                        while the mock is on screen (a closed assistant panel is not in the DOM).
 *   - `[data-demo-head]`                 the root's own head row: the section head or eyebrow row of a block, the h1
 *                                        row of a whole mocked page, the `as-head` of the assistant. Exactly one per
 *                                        root (heads inside a nested `[data-demo]` belong to that one); the root
 *                                        itself may carry it when the mocked item is a single row.
 *   - `[data-demo-chip]`                 `<ui-chip variant="demo">` (the chip's host sets it). Exactly one visible chip
 *                                        per visible root whose nearest `[data-demo]` is that root, inside that
 *                                        root's `[data-demo-head]`. No chip outside a `[data-demo]`.
 *   - Real pages carry no `[data-demo]` and no chip: the spec dashboard `/w/:ws/s/:id` and the status tab
 *     `/w/:ws/s/:id/status` (Spec context, gates, warnings and waiting items are core's). The header's assistant
 *     trigger is a control, not a mock, and carries none; a workspace badge on these pages renders from core's data
 *     (the workspace name), never from the identity fixture, or it would need the chip.
 *
 *   Library `/w/:ws/library` (T50, T51; prototype `library.html`)
 *   - `[data-page="library"]`            the page root, itself `[data-demo]`; its h1 row is the `[data-demo-head]`.
 *   - `[data-library-entry]`             one row per document, value = the fixture's `id`, in `DEMO_LIBRARY` order
 *                                        while no filter is set.
 *   - `[data-library-search]`            the search input; filtering by an entry's title keeps that entry.
 *   - `[data-library-reader]`            the reader; choosing a row shows that entry's title in it.
 *   - `a[data-library-link]`             none: the prototype's rail link to the Library gave way to the PAGE select
 *                                        `header [data-control="page"]`, whose menu lists Library (spec 024 T80,
 *                                        ISC-150.2, principal 2026-10-13).
 *
 *   Settings · Workspaces `/settings/workspaces` (T50, T52; prototype `workspaces.html`)
 *   - `[data-page="settings-workspaces"]` the page root, itself `[data-demo]`; its h1 row is the `[data-demo-head]`.
 *   - `[data-ws-row]`                    one row per registered workspace, value = the fixture's `name`, in
 *                                        `DEMO_WORKSPACES` order; the rows never change (the mock writes nothing).
 *   - `[data-ws-add-path]`, `[data-ws-add]`  the add row's path field and its Add button (a no-op, or disabled).
 *   - `[data-identity-upload]`           the identity image upload control: disabled, inside a `[data-demo]`.
 *   - Reached in the app from the settings popover's `[data-settings-link="workspaces"]` (today it points at
 *     `/settings`) and from the Settings page's card link `main a[href="/settings/workspaces"]`.
 *
 *   Assistant dot (T53; prototype `assistant.js`)
 *   - The trigger `header [data-tool="assistant"]` (an overflow-menu entry below 1120, see `headerControl`) opens it;
 *     today it is `aria-disabled` and opens nothing.
 *   - `[data-assistant]`                 the panel (from 640) or full-screen sheet (below), itself `[data-demo]`; its
 *                                        `as-head` is the `[data-demo-head]`.
 *   - `[data-assistant-suggestion]`      one chip per `DEMO_ASSISTANT_REPLIES` entry, text = its `prompt`, in order.
 *   - `[data-assistant-input]`, `[data-assistant-send]`  the prompt field and the send button.
 *   - `[data-assistant-reply]`           one per answer of dot; the last one holds the fixture's reply (the matching
 *                                        suggestion's, else `DEMO_ASSISTANT_FALLBACK`).
 *   - `[data-assistant-apply]`           Apply on a write proposal, where one is shown: it writes nothing.
 *   - `[data-assistant-close]`           the `x` in the head; closing removes the panel.
 *
 *   Workspace identity images (T54; prototype `identity.js`)
 *   - `[data-ws-cover]`                  the screenshot or name pattern beside a workspace's name on `/`, one per
 *                                        workspace column, each inside a `[data-demo]`.
 *   - `[data-ws-badge]`                  the badge (logo or initials on the accent tint), 30 px in each column head on `/`.
 *
 *   State galleries (T55; prototype `states.html`, `board-states.html`)
 *   - `/__ui` holds the sections `[data-gallery="states"]` and `[data-gallery="board-states"]`.
 *
 *   The views the app has today are reached through hooks other specs hold already: the `app-*` hosts, `app-tab-bar
 *   a[data-tab]`, `[data-area-tile]`, `app-spec-head [data-gate-action]` and `[data-gate-dialog]`, `[data-frame-chip]`,
 *   `ui-segmented[data-control="view"]`, `[data-ui="command-palette"]`, `[data-settings-link]`.
 */
import { readFileSync } from 'node:fs';
import type { BrowserContext, Locator, Page } from '@playwright/test';
import type { SpecPageModel } from '../../core/src/files.ts';
import { DEMO_ASSISTANT_FALLBACK, DEMO_ASSISTANT_REPLIES } from '../src/app/shared/demo/fixtures/assistant.ts';
import { DEMO_LIBRARY } from '../src/app/shared/demo/fixtures/library.ts';
import { DEMO_WORKSPACES } from '../src/app/shared/demo/fixtures/workspaces.ts';
import type { IconName } from '../src/app/shared/icons/icons.ts';
import { PROTOTYPE_ICON_MAP } from '../src/app/shared/icons/prototype-map.ts';
import { atWidth, expect, headerControl, menusReady, test } from './fixtures';
import { STUB_NOTES } from './stub-api';

// Read, not imported: Playwright's ESM loader wants an import attribute the web tsconfig does not take.
const read = (file: string): unknown => JSON.parse(readFileSync(new URL(`../../core/fixtures/${file}`, import.meta.url), 'utf8'));

const SPECS = read('harbor.spec.golden.json') as Record<string, SpecPageModel>;
function spec(path: string): SpecPageModel {
  const model = SPECS[path];
  if (!model) throw new Error(`harbor.spec.golden.json holds no ${path}`);
  return model;
}
/** Waiting items of all three kinds, no warnings. */
const SPEC_002 = spec('specs/002-web-console');
/** Warnings, one of them with a command. */
const SPEC_005 = spec('specs/005-config-format-choice');

type WarningItem = { readonly spec: string; readonly warning: { readonly kind: string; readonly text: string; readonly command?: string } };
type WarningGroup = { readonly items: readonly WarningItem[] };
const WORKSPACE = read('harbor.golden.json') as { readonly warningGroups: readonly WarningGroup[] };
const WARNED = WORKSPACE.warningGroups.flatMap((group) => group.items);

const GATES = ['reviewed', 'codeReviewed', 'drift', 'diagrams'] as const;
const BLOCKS = ['waiting', 'warnings', 'gates'] as const;
const KINDS = { operator: 'operator', manual: 'manual', question: 'question' } as const;

const TIERS = [
  { width: 390, tier: 'compact', rail: false },
  { width: 820, tier: 'medium', rail: false },
  { width: 1440, tier: 'wide', rail: true },
] as const;

/** Where the Spec context and the Warnings list live at this width: the rail from 1120 px, else the main column. */
const home = (page: Page, rail: boolean): Locator => page.locator(rail ? 'aside.shell-rail' : 'main#main');

async function top(locator: Locator): Promise<number> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box.y;
}

test.describe('elements', () => {
  for (const { width, tier, rail } of TIERS) {
    test.describe(`spec context at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('Spec context holds Waiting on you, Warnings and Gates where the prototype puts them', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);

        const context = home(page, rail).locator('[data-spec-context]');
        await expect(context).toBeVisible();
        expect(await context.locator('[data-context-block]').evaluateAll((blocks) => blocks.map((b) => b.getAttribute('data-context-block')))).toEqual([...BLOCKS]);
        for (const name of ['Waiting on you', 'Warnings', 'Gates']) {
          await expect(context.getByRole('heading', { name, exact: true })).toBeVisible();
        }
        // The other home never holds a second, visible Spec context.
        await expect(home(page, !rail).locator('[data-spec-context]:visible')).toHaveCount(0);

        if (rail) {
          const box = await page.locator('aside.shell-rail').boundingBox();
          expect(box?.width).toBe(352);
          await expect(context.locator('[data-context-kbd]')).toBeVisible();
        } else {
          // The last block of the main column: below every other section of the dashboard.
          const contextTop = await top(context);
          for (const section of await page.locator('main#main [data-section]:visible').all()) {
            expect(await top(section)).toBeLessThan(contextTop);
          }
        }
      });

      test('Waiting on you lists every item with its kind chip and a count badge', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const block = home(page, rail).locator('[data-spec-context] [data-context-block="waiting"]');
        await expect(block).toBeVisible();
        await expect(block.locator('[data-count-badge]')).toHaveText(String(SPEC_002.waitingOnYou.length));

        const items = block.locator('[data-waiting-item]');
        await expect(items).toHaveCount(SPEC_002.waitingOnYou.length);
        for (const item of SPEC_002.waitingOnYou) {
          const row = block.locator(`[data-waiting-item][data-waiting-kind="${item.kind}"][data-waiting-ref="${item.ref}"]`);
          await expect(row).toBeVisible();
          await expect(row.locator('[data-waiting-kind-label]')).toHaveText(KINDS[item.kind]);
        }
      });

      test('a question item is real data and carries no demo chip', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const questions = home(page, rail).locator('[data-spec-context] [data-waiting-item][data-waiting-kind="question"]');
        await expect(questions.first()).toBeVisible();
        await expect(home(page, rail).locator('[data-spec-context] [data-demo-chip]')).toHaveCount(0);
      });

      test('Warnings lists every warning of the spec with its command', async ({ page }) => {
        await page.goto('/w/harbor/s/005');
        const block = home(page, rail).locator('[data-spec-context] [data-context-block="warnings"]');
        await expect(block).toBeVisible();
        await expect(block.locator('[data-count-badge]')).toHaveText(String(SPEC_005.warnings.length));
        const lines = block.locator('[data-context-warning]');
        await expect(lines).toHaveCount(SPEC_005.warnings.length);
        for (const warning of SPEC_005.warnings) {
          const line = lines.filter({ hasText: warning.text });
          await expect(line).toHaveCount(1);
          if (warning.command) await expect(line.locator('[data-warning-command]')).toHaveText(warning.command);
        }
      });

      test('Gates shows one row per gate with its value', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const block = home(page, rail).locator('[data-spec-context] [data-context-block="gates"]');
        await expect(block).toBeVisible();
        expect(await block.locator('[data-gate-row]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-gate')))).toEqual([...GATES]);
        for (const gate of GATES) {
          await expect(block.locator(`[data-gate-row][data-gate="${gate}"] [data-gate-value]`)).not.toBeEmpty();
        }
      });

      test('the KPI Waiting on you jumps to #waiting on the dashboard itself', async ({ page }) => {
        await page.goto('/w/harbor/s/002');
        const target = page.locator('#waiting:visible');
        await expect(target).toHaveCount(1);
        await expect(home(page, rail).locator('[data-spec-context] #waiting, [data-spec-context]#waiting').filter({ visible: true })).toHaveCount(1);

        await page.locator('a[data-kpi="waiting"], [data-kpi="waiting"] a').first().click();
        await expect(page).toHaveURL((url) => url.pathname === '/w/harbor/s/002' && url.hash === '#waiting');
        await expect(target).toBeInViewport();
      });
    });

    test.describe(`warnings list at ${String(width)}`, () => {
      test.use(atWidth(width));

      test('the workspace Warnings list follows Next up and names spec, warning and command', async ({ page }) => {
        await page.goto('/w/harbor');
        await expect(page.locator('app-shell')).toHaveAttribute('data-tier', tier);

        const at = home(page, rail);
        const list = at.locator('[data-warnings-list]');
        await expect(list).toBeVisible();
        await expect(home(page, !rail).locator('[data-warnings-list]:visible')).toHaveCount(0);

        const nextUp = at.locator('[data-next-up]');
        await expect(nextUp).toBeVisible();
        const box = await nextUp.boundingBox();
        expect(await top(list)).toBeGreaterThanOrEqual((box?.y ?? 0) + (box?.height ?? 0));

        for (const { spec: id, warning } of WARNED) {
          const group = list.locator(`[data-warning-spec="${id}"]`);
          await expect(group).toBeVisible();
          await expect(group.locator('[data-warning-link]').first()).toHaveText(id);
          if (warning.kind === 'fog') continue; // open fog has its own line, worded by the app
          await expect(group.locator('[data-warning-text]', { hasText: warning.text })).toHaveCount(1);
          if (warning.command) await expect(group.locator('ui-command-chip', { hasText: warning.command })).toHaveCount(1);
        }
      });
    });
  }
});

/*
 * Group `icons` (ISC-147.1): at every icon place of the parity table that the app shows today and the stub serves, the
 * place renders the mapped Lucide name through `ui-icon`, which carries the drawn name as `data-icon`. The table below
 * is derived from the parity table's rows whose icon cell maps a prototype key (`key` → `lucide-name`) and whose state
 * is `gleich` in both themes; rows on `fehlt`, `mock` or `neu entwerfen` belong to views that come later, and rows
 * whose place the stub cannot reach (no claim session, no stale TL;DR, no scoping spec) wait for those states. Each
 * place names its parity section, the route, an optional step that opens it (a popover, the palette, a dialog), the
 * locator of the place (existing `data-*` hooks) and the expected name. `attached` marks a place whose icon is in the
 * DOM but drawn only in another state (the live icon while no source is connected shows the dot instead).
 */
type IconPlace = {
  readonly section: string;
  readonly place: string;
  readonly route: string;
  readonly at: string;
  readonly icon: IconName;
  readonly width?: number;
  readonly open?: (page: Page) => Promise<void>;
  readonly attached?: boolean;
};

const click =
  (selector: string) =>
  async (page: Page): Promise<void> => {
    await page.locator(selector).first().click();
  };
const openPalette = click('header [data-control="palette"]');
/** The settings button, once the deferred menus have mounted (before that it leads to /settings, its fallback). */
const openSettings = async (page: Page): Promise<void> => {
  await menusReady(page);
  await click('header [data-control="settings"]')(page);
};
/** The palette after one of its entries was chosen, so Recent has an entry. */
const openPaletteWithRecent = async (page: Page): Promise<void> => {
  await openPalette(page);
  await page.locator('[data-group="workspaces"] [data-entry="lantern"]').click();
  await expect(page).toHaveURL(/\/w\/lantern$/);
  await openPalette(page);
};

/** Icons the design (spec 024 design.md) names for a place the prototype drew without a key: Zen's focus corners. */
const DESIGN_ICONS: readonly IconName[] = ['scan'];

const SHELL = 'Gemeinsam · Shell';
const WORKSPACE_VIEW = 'workspace.html';
const SPEC_VIEW = 'spec.html';
const DETAIL_VIEW = 'spec-detail.html';
const BOARD_VIEW = 'board-live.html';

const ICON_PLACES: readonly IconPlace[] = [
  // Shell header (rows Suche, Live-Indikator, Zen, Einstellungen, Hilfe; Header icons search … help)
  { section: SHELL, place: 'palette trigger', route: '/w/harbor', at: 'header [data-control="palette"]', icon: 'search' },
  { section: SHELL, place: 'live indicator', route: '/w/harbor', at: 'header [data-control="live"]', icon: 'activity', attached: true },
  { section: SHELL, place: 'status group refresh', route: '/w/harbor', at: 'header [data-tool="refresh"]', icon: 'refresh-cw' },
  { section: SHELL, place: 'refresh interval', route: '/w/harbor', at: 'header [data-tool="interval"]', icon: 'timer' },
  { section: SHELL, place: 'zen', route: '/w/harbor', at: 'header [data-control="zen"]', icon: 'scan' },
  { section: SHELL, place: 'settings', route: '/w/harbor', at: 'header [data-control="settings"]', icon: 'settings' },
  { section: SHELL, place: 'help', route: '/w/harbor', at: 'header [data-tool="help"]', icon: 'circle-help' },
  { section: SHELL, place: 'live popover board link', route: '/w/harbor/s/002', open: click('header [data-control="live"]'), at: '[data-live-board]', icon: 'arrow-right' },
  { section: SHELL, place: 'settings popover workspaces', route: '/w/harbor', open: openSettings, at: '[data-menu="settings"] [data-settings-link="workspaces"]', icon: 'folder' },
  { section: SHELL, place: 'settings popover help', route: '/w/harbor', open: openSettings, at: '[data-menu="settings"] [data-settings-link="help"]', icon: 'circle-help' },

  // Workspace dashboard: spec table, warnings list, palette (the prototype's Inspector rows)
  { section: WORKSPACE_VIEW, place: 'spec table foot', route: '/w/harbor', at: '[data-panel="specs"] [data-fold="archive"]', icon: 'layers' },
  { section: WORKSPACE_VIEW, place: 'warnings list line', route: '/w/harbor', at: '[data-warnings-list] [data-warning-spec] [data-warning-kind]', icon: 'triangle-alert' },
  { section: WORKSPACE_VIEW, place: 'warnings list empty', route: '/w/lantern', at: '[data-warnings-list] [data-warnings-empty]', icon: 'circle-check' },
  { section: WORKSPACE_VIEW, place: 'palette input', route: '/w/harbor', open: openPalette, at: '[data-ui="command-palette"] .p-input', icon: 'search' },
  { section: WORKSPACE_VIEW, place: 'palette Recent', route: '/w/harbor', open: openPaletteWithRecent, at: '[data-group="recent"] [data-entry]', icon: 'clock' },
  { section: WORKSPACE_VIEW, place: 'palette Workspaces', route: '/w/harbor', open: openPalette, at: '[data-group="workspaces"] [data-entry="harbor"]', icon: 'folder' },
  { section: WORKSPACE_VIEW, place: 'palette action all workspaces', route: '/w/harbor', open: openPalette, at: '[data-entry="action/all-workspaces"]', icon: 'layers' },
  { section: WORKSPACE_VIEW, place: 'palette action refresh', route: '/w/harbor', open: openPalette, at: '[data-entry="action/refresh"]', icon: 'refresh-cw' },
  { section: WORKSPACE_VIEW, place: 'palette action theme', route: '/w/harbor', open: openPalette, at: '[data-entry="action/theme"]', icon: 'settings' },
  { section: WORKSPACE_VIEW, place: 'palette action help', route: '/w/harbor', open: openPalette, at: '[data-entry="action/help"]', icon: 'circle-help' },
  { section: WORKSPACE_VIEW, place: 'palette action shortcuts', route: '/w/harbor', open: openPalette, at: '[data-entry="action/shortcuts"]', icon: 'circle-help' },

  // Spec dashboard: head, area tiles, Spec context, next step
  { section: SPEC_VIEW, place: 'head context path', route: '/w/harbor/s/002', at: '[data-crumb="workspace"]', icon: 'arrow-left' },
  { section: SPEC_VIEW, place: 'head type chip', route: '/w/harbor/s/002', at: '[data-head-chip="type"]', icon: 'sparkles' },
  { section: SPEC_VIEW, place: 'head command chip', route: '/w/harbor/s/002', at: '[data-head-command]', icon: 'copy' },
  { section: SPEC_VIEW, place: 'head notes pill', route: '/w/harbor/s/002', at: '[data-notes-pill]', icon: 'sticky-note' },
  { section: SPEC_VIEW, place: 'area tiles', route: '/w/harbor/s/002', at: '[data-section="tiles"] [data-area-tile="status"]', icon: 'arrow-right' },
  { section: SPEC_VIEW, place: 'Waiting on you manual', route: '/w/harbor/s/002', at: '[data-spec-context] [data-waiting-item][data-waiting-kind="manual"]', icon: 'circle-check' },
  { section: SPEC_VIEW, place: 'Waiting on you question', route: '/w/harbor/s/002', at: '[data-spec-context] [data-waiting-item][data-waiting-kind="question"]', icon: 'circle-help' },
  { section: SPEC_VIEW, place: 'Spec context warning', route: '/w/harbor/s/003', at: '[data-spec-context] [data-context-warning]', icon: 'triangle-alert' },
  { section: SPEC_VIEW, place: 'gate row fresh', route: '/w/harbor/s/002', at: '[data-spec-context] [data-gate-row][data-gate="reviewed"]', icon: 'check' },
  { section: SPEC_VIEW, place: 'gate row missing', route: '/w/harbor/s/002', at: '[data-spec-context] [data-gate-row][data-gate="codeReviewed"]', icon: 'x' },
  { section: SPEC_VIEW, place: 'next step gate button Mark reviewed', route: '/w/harbor/s/003', at: '[data-head-actions] [data-gate-action][data-state="ready"]', icon: 'flag' },

  // Spec detail: Status, Claims, Tasks, Evidence, Notes
  { section: DETAIL_VIEW, place: 'Status gate tile fresh', route: '/w/harbor/s/002/status', at: '[data-icon-place="status-gates"] [data-gate="reviewed"]', icon: 'check' },
  { section: DETAIL_VIEW, place: 'Status gate tile missing', route: '/w/harbor/s/002/status', at: '[data-icon-place="status-gates"] [data-gate="codeReviewed"]', icon: 'x' },
  { section: DETAIL_VIEW, place: 'Status gate tile missing with gate flag', route: '/w/harbor/s/003/status', at: '[data-icon-place="status-gates"] [data-gate="reviewed"]', icon: 'flag' },
  { section: DETAIL_VIEW, place: 'Status gate tile warn', route: '/w/harbor/s/003/status', at: '[data-icon-place="status-gates"] [data-gate="diagrams"]', icon: 'triangle-alert' },
  { section: DETAIL_VIEW, place: 'Status fog row', route: '/w/harbor/s/005/status', at: '[data-section="open"] [data-fog]', icon: 'cloud' },
  { section: DETAIL_VIEW, place: 'Status held row', route: '/w/harbor/s/002/status', at: '[data-held-list] [data-held-task]', icon: 'clock' },
  { section: DETAIL_VIEW, place: 'Status activity round', route: '/w/harbor/s/002/status', at: '[data-section="activity"] [data-activity][data-kind="round"]', icon: 'clock' },
  { section: DETAIL_VIEW, place: 'Status activity commit', route: '/w/harbor/s/002/status', at: '[data-section="activity"] [data-activity][data-kind="stage"]', icon: 'git-commit-horizontal' },
  { section: DETAIL_VIEW, place: 'Status activity decision', route: '/w/harbor/s/003/status', at: '[data-section="activity"] [data-activity][data-kind="decision"]', icon: 'file' },
  { section: DETAIL_VIEW, place: 'Status where it stands warning', route: '/w/harbor/s/003/status', at: '[data-spec-rail] [data-rail-warning]', icon: 'triangle-alert' },
  { section: DETAIL_VIEW, place: 'Status where it stands take chip', route: '/w/harbor/s/002/status', at: '[data-spec-rail] [data-rail-take]', icon: 'hand' },
  { section: DETAIL_VIEW, place: 'Status waiting manual', route: '/w/harbor/s/002/status', at: '[data-rail-waiting][data-waiting-kind="manual"]', icon: 'circle-check' },
  { section: DETAIL_VIEW, place: 'Status waiting question', route: '/w/harbor/s/002/status', at: '[data-rail-waiting][data-waiting-kind="question"]', icon: 'circle-help' },
  // spec 024 (principal 2026-10-13, claims fold): ISC-51 is an older closed claim behind its group's fold; the deep link opens it.
  { section: DETAIL_VIEW, place: 'Claims notes badge', route: '/w/harbor/s/002/claims#claim-ISC-51', at: '[data-claim="ISC-51"] [data-link="notes"]', icon: 'sticky-note' },
  { section: DETAIL_VIEW, place: 'Claims verification line', route: '/w/harbor/s/002/claims#claim-ISC-51', at: '[data-claim="ISC-51"]', icon: 'circle-check' },
  { section: DETAIL_VIEW, place: 'Tasks helper line', route: '/w/harbor/s/002/tasks', at: '[data-page="tasks"] .helper', icon: 'lock' },
  { section: DETAIL_VIEW, place: 'Evidence preview dialog close', route: '/w/harbor/s/002/evidence', open: click('[data-file="artifacts/T12-dashboard-model.md"]'), at: '[data-preview-close]', icon: 'x' },
  { section: DETAIL_VIEW, place: 'Decisions still open fog', route: '/w/harbor/s/005/decisions', at: '[data-page="docs"]', icon: 'cloud' },
  { section: 'notes.html', place: 'notes import notice close', route: '/w/harbor/s/002/notes', at: '[data-notes-import]', icon: 'x' },
  { section: 'notes.html', place: 'notes search', route: '/w/harbor/s/002/notes', at: '[data-notes-list] .notes-search', icon: 'search' },
  { section: 'notes.html', place: 'notes new', route: '/w/harbor/s/002/notes', at: '[data-notes-new]', icon: 'plus' },
  { section: 'notes.html', place: 'note anchor', route: '/w/harbor/s/002/notes/00000000-0000-4000-8000-000000000003', at: '[data-notes-editor]', icon: 'anchor' },
  { section: 'notes.html', place: 'note delete', route: '/w/harbor/s/002/notes/00000000-0000-4000-8000-000000000003', at: '[data-note-delete]', icon: 'trash' },
  { section: 'notes.html', place: 'note back (single column)', width: 390, route: '/w/harbor/s/002/notes/00000000-0000-4000-8000-000000000003', at: '[data-notes-editor]', icon: 'arrow-left' },

  // Live board (Lanes; Flow and History share the toolbar), matrix rail
  { section: BOARD_VIEW, place: 'toolbar Lanes', route: '/w/harbor/s/002/board', at: '[data-control="view"] button >> nth=0', icon: 'rows-3' },
  { section: BOARD_VIEW, place: 'toolbar Flow', route: '/w/harbor/s/002/board', at: '[data-control="view"] button >> nth=1', icon: 'workflow' },
  { section: BOARD_VIEW, place: 'toolbar filter', route: '/w/harbor/s/002/board', at: '[data-board-controls] [data-lane-filter-open]', icon: 'layers' },
  { section: BOARD_VIEW, place: 'toolbar search', route: '/w/harbor/s/002/board', at: '[data-board-controls] .bsearch', icon: 'search' },
  { section: BOARD_VIEW, place: 'lane hide', route: '/w/harbor/s/002/board', at: '[data-lane] [data-hide-lane]', icon: 'x' },
  { section: BOARD_VIEW, place: 'waiting group summary', route: '/w/harbor/s/002/board', at: '[data-reason-group]', icon: 'chevron-down' },
  { section: BOARD_VIEW, place: 'rail Needs you', route: '/w/harbor/s/002/board', at: '[data-stale-agent]', icon: 'triangle-alert' },
  { section: 'board-matrix.html', place: 'rail Needs you', route: '/w/harbor/s/002/matrix', at: '[data-stale-agent]', icon: 'triangle-alert' },

  // Help: the lifecycle figure (the other help keys are seeds of the prototype's init, not places in help.html)
  { section: 'help.html', place: 'lifecycle file', route: '/help', at: '[data-lifecycle-stage="plan"] .wf-file', icon: 'file' },
  { section: 'help.html', place: 'lifecycle gate', route: '/help', at: '[data-lifecycle-stage="review"] .wf-gate', icon: 'flag' },
  { section: 'help.html', place: 'lifecycle loop', route: '/help', at: '[data-loop="stale"]', icon: 'refresh-cw' },
];

test.describe('icons', () => {
  test('every expected name is a mapped prototype icon or one design.md names', () => {
    const mapped = new Set<string>([...Object.values(PROTOTYPE_ICON_MAP), ...DESIGN_ICONS]);
    expect(ICON_PLACES.map((p) => p.icon).filter((name) => !mapped.has(name))).toEqual([]);
  });

  for (const spot of ICON_PLACES) {
    test.describe(`${spot.section} at ${String(spot.width ?? 1440)}`, () => {
      test.use(atWidth(spot.width ?? 1440));

      test(`${spot.place} renders ${spot.icon}`, async ({ page }) => {
        await page.goto(spot.route);
        if (spot.open) await spot.open(page);
        const place = page.locator(spot.at).first();
        await expect(place).toBeAttached();
        const icon = place.locator(`ui-icon[data-icon="${spot.icon}"]`).first();
        if (spot.attached) await expect(icon).toBeAttached();
        else await expect(icon).toBeVisible();
      });
    });
  }
});

/*
 * Group `demo` (ISC-149.1): every mocked element carries the demo chip in its head, reads its fixture and nothing
 * else, writes nothing and calls no host outside loopback. `bun run e2e -- parity -g demo` plus `bun run e2e --
 * offline` is the claim's probe; the static half (no `ApiClient`, no write method, frozen fixtures) is
 * `web/tests/demo-readonly.test.ts`. The network guard is the offline spec's: a `context.route('**')` handler lets
 * loopback http(s) through and aborts everything else, a request listener records what the open mock makes.
 */
const DEMO_SESSION_HEADER = 'X-Spectant-Stub-Session';
const DEMO_SESSION = 'parity-demo';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** No endpoint serves these yet: a mock that asks the API for one reads something other than its fixture. */
const MOCK_API = /\/api\/.*(library|assistant|identit|upload)/iu;

interface DemoTraffic {
  readonly blocked: string[];
  readonly seen: Array<{ readonly method: string; readonly url: string }>;
}

async function guardNetwork(context: BrowserContext): Promise<DemoTraffic> {
  const traffic: DemoTraffic = { blocked: [], seen: [] };
  await context.route('**', async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK_HOSTS.has(url.hostname)) return route.continue();
    traffic.blocked.push(url.href);
    return route.abort('blockedbyclient');
  });
  await context.routeWebSocket(/.*/u, (ws) => {
    const url = new URL(ws.url());
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      traffic.blocked.push(url.href);
      return ws.close();
    }
    return ws.connectToServer();
  });
  context.on('request', (req) => traffic.seen.push({ method: req.method(), url: req.url() }));
  return traffic;
}

/**
 * The chip rule over every visible `[data-demo]` of the page: one own head, one own visible chip inside it; and no chip
 * outside a `[data-demo]`. Returns the defects as readable lines, so a failure names the root.
 */
async function chipDefects(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const shown = (el: Element): boolean => {
      const box = el.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    };
    const name = (el: Element): string => `${el.tagName.toLowerCase()}${el.getAttribute('data-page') ? `[data-page=${el.getAttribute('data-page') ?? ''}]` : ''}`;
    const defects: string[] = [];
    for (const root of Array.from(document.querySelectorAll('[data-demo]')).filter(shown)) {
      const own = (el: Element): boolean => el.closest('[data-demo]') === root;
      const heads = [root, ...Array.from(root.querySelectorAll('[data-demo-head]'))].filter((el) => el.hasAttribute('data-demo-head') && (el === root || own(el)));
      const chips = Array.from(root.querySelectorAll('[data-demo-chip]')).filter(own);
      const head = heads[0];
      if (heads.length !== 1) defects.push(`${name(root)}: ${String(heads.length)} heads`);
      if (chips.length !== 1) defects.push(`${name(root)}: ${String(chips.length)} chips`);
      for (const chip of chips) {
        if (!shown(chip)) defects.push(`${name(root)}: chip not visible`);
        if (head && !head.contains(chip)) defects.push(`${name(root)}: chip outside its head`);
      }
    }
    const orphans = Array.from(document.querySelectorAll('[data-demo-chip]')).filter((chip) => chip.closest('[data-demo]') === null);
    if (orphans.length > 0) defects.push(`${String(orphans.length)} chips outside any [data-demo]`);
    return defects;
  });
}

const storage = (page: Page): Promise<string> => page.evaluate(() => JSON.stringify(Object.entries(localStorage).sort()));

interface MockHost {
  readonly name: string;
  readonly route: string;
  readonly width?: number;
  /** Opens the mock on the route (the assistant opens from the header). */
  readonly open?: (page: Page) => Promise<void>;
  /** The mocked roots the view must show (each a `[data-demo]` or inside one). */
  readonly root: string;
  /** Shows the fixture and uses the mock the way a person would; nothing of it may write or leave the machine. */
  readonly use: (page: Page) => Promise<void>;
}

const openAssistant = async (page: Page): Promise<void> => {
  const trigger = await headerControl(page, 'assistant');
  // Today the trigger is only the dot's place (aria-disabled); fail on that rather than wait out the click.
  await expect(trigger).not.toHaveAttribute('aria-disabled', 'true');
  await trigger.click();
};

const useAssistant = async (page: Page): Promise<void> => {
  const panel = page.locator('[data-assistant]');
  await expect(panel.locator('[data-assistant-suggestion]')).toHaveText(DEMO_ASSISTANT_REPLIES.map((entry) => entry.prompt));
  const first = DEMO_ASSISTANT_REPLIES[0];
  if (!first) throw new Error('DEMO_ASSISTANT_REPLIES is empty');
  await panel.locator('[data-assistant-suggestion]').first().click();
  await expect(panel.locator('[data-assistant-reply]').last()).toContainText(first.reply);
  await panel.locator('[data-assistant-input]').fill('Anything else?');
  await panel.locator('[data-assistant-send]').click();
  await expect(panel.locator('[data-assistant-reply]').last()).toContainText(DEMO_ASSISTANT_FALLBACK);
  const apply = panel.locator('[data-assistant-apply]');
  if ((await apply.count()) > 0) await apply.first().click();
};

const MOCK_HOSTS: readonly MockHost[] = [
  {
    name: 'Library',
    route: '/w/harbor/library',
    root: '[data-page="library"][data-demo]',
    use: async (page) => {
      const entries = page.locator('[data-library-entry]');
      expect(await entries.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-library-entry')))).toEqual(DEMO_LIBRARY.map((entry) => entry.id));
      const pick = DEMO_LIBRARY[0];
      if (!pick) throw new Error('DEMO_LIBRARY is empty');
      await page.locator('[data-library-search]').fill(pick.title);
      await expect(page.locator(`[data-library-entry="${pick.id}"]`)).toBeVisible();
      await page.locator(`[data-library-entry="${pick.id}"]`).click();
      await expect(page.locator('[data-library-reader]')).toContainText(pick.title);
    },
  },
  {
    name: 'Settings · Workspaces',
    route: '/settings/workspaces',
    root: '[data-page="settings-workspaces"][data-demo]',
    use: async (page) => {
      const names = (): Promise<Array<string | null>> => page.locator('[data-ws-row]').evaluateAll((rows) => rows.map((row) => row.getAttribute('data-ws-row')));
      expect(await names()).toEqual(DEMO_WORKSPACES.map((row) => row.name));
      const upload = page.locator('[data-identity-upload]').first();
      await expect(upload).toBeDisabled();
      expect(await upload.evaluate((el) => el.closest('[data-demo]') !== null)).toBe(true);
      await page.locator('[data-ws-add-path]').fill('oss/new-repo');
      const add = page.locator('[data-ws-add]');
      if (await add.isEnabled()) await add.click();
      expect(await names()).toEqual(DEMO_WORKSPACES.map((row) => row.name));
    },
  },
  { name: 'assistant dot', route: '/w/harbor/s/002', open: openAssistant, root: '[data-assistant][data-demo]', use: useAssistant },
  { name: 'assistant dot', route: '/w/harbor/s/002', width: 390, open: openAssistant, root: '[data-assistant][data-demo]', use: useAssistant },
  {
    name: 'identity images',
    route: '/',
    root: '[data-ws-cover]',
    use: async (page) => {
      const covers = page.locator('[data-ws-cover]');
      expect(await covers.count()).toBeGreaterThan(0);
      expect(await covers.evaluateAll((all) => all.filter((cover) => cover.closest('[data-demo]') === null).length)).toBe(0);
    },
  },
];

/** Real pages that may hold a mock somewhere (the chip rule holds wherever one is), each with the hook that says it rendered. */
const SAMPLE_PAGES: ReadonlyArray<{ readonly route: string; readonly ready: string }> = [
  { route: '/w/harbor', ready: 'app-dashboard-page h1' },
  { route: '/settings', ready: '[data-page="settings"] h1' },
  { route: '/help', ready: 'app-help-page h1' },
  { route: '/w/harbor/s/002/board', ready: 'app-board-tab section.board' },
];

/** Pages with real data only: no `[data-demo]`, no chip. */
const REAL_ONLY: ReadonlyArray<{ readonly route: string; readonly ready: string }> = [
  { route: '/w/harbor/s/002', ready: '[data-spec-context]' },
  { route: '/w/harbor/s/002/status', ready: 'app-status-tab' },
];

test.describe('demo', () => {
  test.use({ ...atWidth(1440), extraHTTPHeaders: { [DEMO_SESSION_HEADER]: DEMO_SESSION } });
  test.beforeEach(async ({ request }) => {
    await request.post('/api/__stub/reset', { headers: { [DEMO_SESSION_HEADER]: DEMO_SESSION } });
  });

  for (const host of MOCK_HOSTS) {
    test.describe(`${host.name} at ${String(host.width ?? 1440)}`, () => {
      if (host.width) test.use(atWidth(host.width));

      test(`${host.name} carries the chip in its head, shows its fixture, writes nothing and stays on loopback`, async ({ page, context }) => {
        const traffic = await guardNetwork(context);
        await page.goto(host.route);
        if (host.open) await host.open(page);
        await expect(page.locator(host.root).first()).toBeVisible();
        expect(await chipDefects(page)).toEqual([]);

        const from = traffic.seen.length;
        const stored = await storage(page);
        await host.use(page);
        expect(await chipDefects(page)).toEqual([]);

        const made = traffic.seen.slice(from);
        expect(made.filter((req) => req.method !== 'GET').map((req) => `${req.method} ${req.url}`)).toEqual([]);
        expect(made.filter((req) => MOCK_API.test(new URL(req.url).pathname)).map((req) => req.url)).toEqual([]);
        expect(await storage(page)).toBe(stored);
        expect(traffic.blocked).toEqual([]);
      });
    });
  }

  for (const { route, ready } of SAMPLE_PAGES) {
    test(`${route}: every mock on the page carries its chip, no chip stands alone`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator(ready).first()).toBeVisible();
      expect(await chipDefects(page)).toEqual([]);
    });
  }

  for (const { route, ready } of REAL_ONLY) {
    test(`${route}: real data only, no mock and no chip`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator(ready).first()).toBeVisible();
      await expect(page.locator('[data-demo]')).toHaveCount(0);
      await expect(page.locator('[data-demo-chip]')).toHaveCount(0);
    });
  }
});

/*
 * Group `routes` (ISC-150): each of the 19 prototype views (`spectant-ui/*.html`, inventoried in the parity table) has a
 * reachable counterpart in the app. A place is reachable when its route renders inside the one shell, without the
 * not-found page, and its hook is visible (after `open`, for a view that is an overlay or a state of a page); where the
 * prototype links the view, its in-app link leads there too. `bun run e2e -- parity -g routes` is the probe: 19 of 19.
 * The assistant dot and the identity images are no HTML views of their own; their two tests close the claim's second
 * half.
 */
const NOTE_002 = STUB_NOTES.find((note) => note.workspace === 'harbor' && note.anchor?.spec === '002');
if (!NOTE_002) throw new Error('STUB_NOTES holds no harbor 002 note');

interface ViewPlace {
  readonly view: string;
  readonly route: string;
  readonly hook: string;
  readonly open?: (page: Page) => Promise<void>;
  /** The in-app way there: start page, the link to follow, the path it lands on. */
  readonly link?: { readonly from: string; readonly follow: (page: Page) => Promise<void>; readonly lands: string };
}

const follow =
  (selector: string) =>
  async (page: Page): Promise<void> => {
    const link = page.locator(selector).first();
    await expect(link).toBeVisible();
    await link.click();
  };
const viaSettings =
  (entry: string) =>
  async (page: Page): Promise<void> => {
    await menusReady(page);
    await (await headerControl(page, 'settings')).click();
    await follow(`[data-menu="settings"] [data-settings-link="${entry}"]`)(page);
  };
/** A page of the PAGE select's menu (spec 024 T80): the select, then the entry. // spec 024: PAGE select (principal 2026-10-13) */
const viaPage =
  (id: string) =>
  async (page: Page): Promise<void> => {
    await (await headerControl(page, 'page')).click();
    await follow(`nav[aria-label="Pages"] [data-page="${id}"]`)(page);
  };
/** The spec table opens a row in two steps: the first click previews it (`?spec=`), the second opens the spec. */
const openSpecRow =
  (id: string) =>
  async (page: Page): Promise<void> => {
    const row = page.locator(`[data-panel="specs"] [data-spec-row="${id}"]`);
    await row.click();
    await expect(page).toHaveURL((url) => url.searchParams.get('spec') === id);
    await row.click();
  };
const tab = (id: string): ((page: Page) => Promise<void>) => follow(`app-tab-bar a[data-tab="${id}"]`);

const VIEWS: readonly ViewPlace[] = [
  { view: 'index.html', route: '/', hook: 'app-overview-page h1', link: { from: '/w/harbor', follow: follow('header [data-control="brand"]'), lands: '/' } },
  { view: 'workspace.html', route: '/w/harbor', hook: 'app-dashboard-page h1', link: { from: '/', follow: follow('main a[href="/w/harbor"]'), lands: '/w/harbor' } },
  { view: 'spec.html', route: '/w/harbor/s/002', hook: 'app-spec-dashboard', link: { from: '/w/harbor', follow: openSpecRow('002'), lands: '/w/harbor/s/002' } },
  { view: 'spec-detail.html', route: '/w/harbor/s/002/status', hook: 'app-status-tab', link: { from: '/w/harbor/s/002', follow: follow('[data-area-tile="status"] a, a[data-area-tile="status"]'), lands: '/w/harbor/s/002/status' } },
  { view: 'spec-review-gate.html', route: '/w/harbor/s/003/status', open: follow('app-spec-head [data-gate-action]'), hook: 'app-spec-head [data-gate-dialog]' },
  { view: 'spec-tasks.html', route: '/w/harbor/s/002/tasks', hook: 'app-tasks-tab', link: { from: '/w/harbor/s/002/claims', follow: tab('tasks'), lands: '/w/harbor/s/002/tasks' } },
  { view: 'spec-timeline.html', route: '/w/harbor/s/002/timeline', hook: 'app-timeline-tab', link: { from: '/w/harbor/s/002/status', follow: tab('timeline'), lands: '/w/harbor/s/002/timeline' } },
  { view: 'spec-board.html', route: '/w/harbor/s/002/board', hook: 'app-board-tab section.board', link: { from: '/w/harbor/s/002/matrix', follow: tab('board'), lands: '/w/harbor/s/002/board' } },
  { view: 'board-live.html', route: '/w/harbor/s/002/board', hook: 'app-board-tab section.board[data-view="lanes"]' },
  {
    view: 'board-flow.html',
    route: '/w/harbor/s/002/board?view=flow',
    hook: 'app-board-tab section.board[data-view="flow"] app-flow-view',
    link: { from: '/w/harbor/s/002/board', follow: follow('app-board-tab ui-segmented[data-control="view"] [role="radio"]:has-text("Flow")'), lands: '/w/harbor/s/002/board' },
  },
  { view: 'board-history.html', route: '/w/harbor/s/002/board?frame=0', hook: 'app-board-tab [data-frame-chip="history"]' },
  { view: 'board-matrix.html', route: '/w/harbor/s/002/matrix', hook: 'app-matrix-tab', link: { from: '/w/harbor/s/002/board', follow: tab('matrix'), lands: '/w/harbor/s/002/matrix' } },
  { view: 'board-states.html', route: '/__ui', hook: '[data-gallery="board-states"]' },
  { view: 'states.html', route: '/__ui', hook: '[data-gallery="states"]' },
  // spec 024: PAGE select (principal 2026-10-13): the Library is reached through the PAGE select's menu, the rail link is gone
  { view: 'library.html', route: '/w/harbor/library', hook: '[data-page="library"] h1', link: { from: '/w/harbor', follow: viaPage('library'), lands: '/w/harbor/library' } },
  {
    view: 'notes.html',
    route: `/w/harbor/s/002/notes/${NOTE_002.id}`,
    hook: '[data-notes-editor]',
    link: { from: '/w/harbor/s/002/notes', follow: follow(`[data-notes-list] a[href$="/notes/${NOTE_002.id}"]`), lands: `/w/harbor/s/002/notes/${NOTE_002.id}` },
  },
  { view: 'workspaces.html', route: '/settings/workspaces', hook: '[data-page="settings-workspaces"] h1', link: { from: '/w/harbor', follow: viaSettings('workspaces'), lands: '/settings/workspaces' } },
  { view: 'help.html', route: '/help', hook: 'app-help-page h1', link: { from: '/w/harbor', follow: viaSettings('help'), lands: '/help' } },
  { view: 'palette.html', route: '/w/harbor', open: follow('header [data-control="palette"]'), hook: '[data-ui="command-palette"]' },
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

  test('the table names each of the 19 prototype views once', () => {
    const views = VIEWS.map((place) => place.view);
    expect(views).toHaveLength(19);
    expect(new Set(views).size).toBe(19);
  });

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
    test.describe(`assistant.js at ${String(width)}`, () => {
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

  test('identity.js: the overview shows a badge and an image beside each workspace name', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('app-overview-page h1')).toBeVisible();
    const covers = page.locator('[data-ws-cover]');
    const badges = page.locator('[data-ws-badge]');
    await expect(covers.first()).toBeVisible();
    await expect(badges.first()).toBeVisible();
    expect(await badges.count()).toBe(await covers.count());
  });
});

/*
 * Group `navigation` (ISC-150.1, T56): the app's navigation survives the port. Hooks it reads beyond the ones above:
 *
 *   - `nav[aria-label="Pages"]`         the page menu, opened from the PAGE select `header [data-control="page"]`
 *                                        (spec 024 T80, ISC-150.2), second after the workspace on every width;
 *   - `nav[aria-label="Areas"]`         the spec area menu, opened from `header [data-control="area"]` on a spec page
 *                                        (`headerControl`); both a `ui-popover` from 640 px, a `ui-sheet` below.
 *   - `[data-menu-head]`                 the menu's eyebrow head (prototype `.area-pop .pop-head`), naming the scope.
 *   - `[data-page="<id>"]`               one entry per workspace page, in registry order, with `ui-icon[data-icon]`,
 *                                        `.entry-name` and the summary `.sub`; `[data-area="<id>"]` per spec area.
 *   - palette `[data-entry]`             `harbor` (Specs), `action/open-board`, `feature-F0`, `milestone-harbor-0-9`,
 *                                        `tech/harbor`, `action/open-library`, `action/settings-workspaces`.
 *   - shortcut sheet `[data-binding]`    `go-board`, `go-features`, `go-milestones` in the workspace context.
 */
const MENU_PAGES = [
  { id: 'specs', icon: 'file-text', name: 'Specs', lands: (path: string) => path === '/w/harbor' },
  { id: 'board', icon: 'square-kanban', name: 'Board', lands: (path: string) => path === '/w/harbor/board' },
  { id: 'features', icon: 'layers', name: 'Features', lands: (path: string) => path === '/w/harbor/features' },
  { id: 'milestones', icon: 'flag', name: 'Milestones', lands: (path: string) => path === '/w/harbor/milestones' },
  { id: 'tech', icon: 'book-open', name: 'Tech', lands: (path: string) => path.startsWith('/w/harbor/tech') },
  { id: 'library', icon: 'book', name: 'Library', lands: (path: string) => path === '/w/harbor/library' },
] as const;

const SPEC_MENU_AREAS = [
  { id: 'dashboard', path: '/w/harbor/s/002' },
  { id: 'status', path: '/w/harbor/s/002/status' },
  { id: 'live', path: '/w/harbor/s/002/board' },
  { id: 'data', path: '/w/harbor/s/002/claims' },
  { id: 'docs', path: '/w/harbor/s/002/plan' },
  { id: 'notes', path: '/w/harbor/s/002/notes' },
] as const;

const PALETTE_PLACES = [
  { entry: 'harbor', query: 'harbor', lands: (path: string) => path === '/w/harbor' },
  { entry: 'action/open-board', query: 'board', lands: (path: string) => path === '/w/harbor/board' },
  { entry: 'feature-F0', query: 'F0', lands: (path: string) => path === '/w/harbor/features' },
  { entry: 'milestone-harbor-0-9', query: 'harbor-0-9', lands: (path: string) => path === '/w/harbor/milestones' },
  { entry: 'tech/harbor', query: 'tech', lands: (path: string) => path.startsWith('/w/harbor/tech') },
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
        await expect(menu.locator('[aria-current="page"]')).toHaveAttribute('data-page', 'specs');
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

      test('a workspace without milestones lists no Milestones entry but keeps Library', async ({ page }) => {
        await page.goto('/w/lantern');
        // spec 024: PAGE select (principal 2026-10-13)
        const menu = await openPageMenu(page);
        expect(await ids(menu.locator('[data-page]'), 'data-page')).toEqual(['specs', 'board', 'features', 'tech', 'library']);
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

    test('the header selects run Workspace · Page · Spec · Area, the Area select only on a spec page', async ({ page }) => {
      const order = (): Promise<Array<string | null>> =>
        page.locator('app-shell-nav [data-control]').evaluateAll((els) => els.map((el) => el.getAttribute('data-control')));
      await page.goto('/w/harbor/s/002');
      await expect(page.locator('header [data-control="area"]')).toBeVisible();
      expect(await order()).toEqual(['workspace', 'page', 'spec', 'area']);
      const labels = page.locator('app-shell-nav [data-control] [data-pill-label]');
      await expect(labels).toHaveText([/^workspace$/iu, /^page$/iu, /^spec$/iu, /^area$/iu]);
      await page.goto('/w/harbor');
      await expect(page.locator('header [data-control="page"]')).toBeVisible();
      expect(await order()).toEqual(['workspace', 'page', 'spec']);
      // spec 024: PAGE select without trigger icon (principal 2026-10-13): eyebrow, name and chevron only
      await expect(page.locator('header [data-control="page"] ui-icon')).toHaveCount(1);
      await expect(page.locator('header [data-control="page"] ui-icon')).toHaveAttribute('data-icon', 'chevron-down');
    });

    for (const [key, path] of [
      ['b', '/w/harbor/board'],
      ['f', '/w/harbor/features'],
      ['m', '/w/harbor/milestones'],
    ] as const) {
      test(`g ${key} navigates to ${path} from the workspace`, async ({ page }) => {
        await page.goto('/w/harbor');
        await expect(page.locator('[data-panel="specs"] [data-spec-row]').first()).toBeVisible();
        await page.keyboard.press('g');
        await page.keyboard.press(key);
        await expect(page).toHaveURL((url) => url.pathname === path);
      });
    }

    test('the shortcut sheet lists g b, g f and g m in the workspace context', async ({ page }) => {
      await page.goto('/w/harbor');
      await expect(page.locator('[data-panel="specs"] [data-spec-row]').first()).toBeVisible();
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
});
