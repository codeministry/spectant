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
 */
import { readFileSync } from 'node:fs';
import type { Locator, Page } from '@playwright/test';
import type { SpecPageModel } from '../../core/src/files.ts';
import type { IconName } from '../src/app/shared/icons/icons.ts';
import { PROTOTYPE_ICON_MAP } from '../src/app/shared/icons/prototype-map.ts';
import { atWidth, expect, test } from './fixtures';

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
  { section: SHELL, place: 'settings popover workspaces', route: '/w/harbor', open: click('header [data-control="settings"]'), at: '[data-menu="settings"] [data-settings-link="workspaces"]', icon: 'folder' },
  { section: SHELL, place: 'settings popover help', route: '/w/harbor', open: click('header [data-control="settings"]'), at: '[data-menu="settings"] [data-settings-link="help"]', icon: 'circle-help' },

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
  { section: DETAIL_VIEW, place: 'Claims notes badge', route: '/w/harbor/s/002/claims', at: '[data-claim="ISC-51"] [data-link="notes"]', icon: 'sticky-note' },
  { section: DETAIL_VIEW, place: 'Claims verification line', route: '/w/harbor/s/002/claims', at: '[data-claim="ISC-51"]', icon: 'circle-check' },
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
