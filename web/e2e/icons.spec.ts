/*
 * Group `icons` (ISC-147.1): at every icon place the app shows today and the stub serves, the place renders the
 * expected Lucide name through `ui-icon`, which carries the drawn name as `data-icon`. Every expected name is a value of
 * `ICON_KEY_MAP` (`key` → `lucide-name`) or one a spec's design.md names (`DESIGN_ICONS`); places whose state the stub
 * cannot reach (no claim session, no stale TL;DR, no scoping spec) wait for those states. Each place names its view,
 * the route, an optional step that opens it (a popover, the palette, a dialog), the locator of the place (existing
 * `data-*` hooks) and the expected name. `attached` marks a place whose icon is in the DOM but drawn only in another
 * state (the live icon while no source is connected shows the dot instead). `bun run e2e -- icons` is the probe.
 */
import type { Page } from '@playwright/test';
import type { IconName } from '../src/app/shared/icons/icons.ts';
import { ICON_KEY_MAP } from '../src/app/shared/icons/icon-map.ts';
import { atWidth, expect, test } from './fixtures';

import { openSettings } from './harbor-fixtures';

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

/**
 * Icons a design.md names for a place the icon key map has no key for: Zen's focus corners (spec 024 design.md) and
 * the Library's fog line (spec 017 design.md), the mark of Waits on you (spec 020 design.md), the spec list's Show
 * archived toggle (spec 050 design.md).
 */
const DESIGN_ICONS: readonly IconName[] = ['scan', 'cloud-fog', 'user-round', 'archive'];

const SHELL = 'shell';
const WORKSPACE_VIEW = 'workspace dashboard';
const SPEC_VIEW = 'spec dashboard';
const LIBRARY_VIEW = 'library';
const DETAIL_VIEW = 'spec detail';
const NOTES_VIEW = 'notes';
const BOARD_VIEW = 'live board';

const ICON_PLACES: readonly IconPlace[] = [
  // Shell header (search, live indicator, refresh, zen, settings, help) and its popovers
  { section: SHELL, place: 'palette trigger', route: '/w/harbor', at: 'header [data-control="palette"]', icon: 'search' },
  { section: SHELL, place: 'live indicator', route: '/w/harbor', at: 'header [data-control="live"]', icon: 'activity', attached: true },
  { section: SHELL, place: 'status group refresh', route: '/w/harbor', at: 'header [data-tool="refresh"]', icon: 'refresh-cw' },
  { section: SHELL, place: 'zen', route: '/w/harbor', at: 'header [data-control="zen"]', icon: 'scan' },
  { section: SHELL, place: 'settings', route: '/w/harbor', at: 'header [data-control="settings"]', icon: 'settings' },
  { section: SHELL, place: 'help', route: '/w/harbor', at: 'header [data-tool="help"]', icon: 'circle-help' },
  { section: SHELL, place: 'live popover board link', route: '/w/harbor/s/002', open: click('header [data-control="live"]'), at: '[data-live-board]', icon: 'arrow-right' },
  { section: SHELL, place: 'settings popover workspaces', route: '/w/harbor', open: openSettings, at: '[data-menu="settings"] [data-settings-link="workspaces"]', icon: 'folder' },
  { section: SHELL, place: 'settings popover help', route: '/w/harbor', open: openSettings, at: '[data-menu="settings"] [data-settings-link="help"]', icon: 'circle-help' },

  // Workspace dashboard: spec table, warnings list, palette
  // Spec 050 (T10, ISC-289): the archived link footer `[data-fold="archive"]` (`layers`) is gone; its pin moved to the
  // list head's Show archived toggle, marked `archive` (design.md 050). Harbor has an archived spec, so it renders.
  { section: WORKSPACE_VIEW, place: 'spec table archived toggle', route: '/w/harbor/specs', at: '[data-panel="specs"] [data-control="archived"]', icon: 'archive' },
  { section: WORKSPACE_VIEW, place: 'warnings list line', route: '/w/harbor?open=warnings', at: '[data-warnings-list] [data-warning-spec] [data-warning-kind]', icon: 'triangle-alert' },
  { section: WORKSPACE_VIEW, place: 'warnings list empty', route: '/w/lantern?open=warnings', at: '[data-warnings-list] [data-warnings-empty]', icon: 'circle-check' },
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
  // Spec 020 (ISC-239): the dashboard rail's Waits on you is the shared `ui-waits-block`, marked `user-round`.
  { section: SPEC_VIEW, place: 'Waits on you mark', route: '/w/harbor/s/002', at: '[data-spec-context] ui-waits-block[data-rail-block="waits"] ui-section-header', icon: 'user-round' },
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
  // Spec 020 (T20, ISC-239): the rail's Waits on you is the shared `ui-waits-block`; its rows carry the reference and
  // the kind chip in place of a per-kind icon (design.md 020 § Spec-Seite), and the block's mark is `user-round`.
  { section: DETAIL_VIEW, place: 'Status waits on you', route: '/w/harbor/s/002/status', at: 'app-spec-rail ui-waits-block[data-rail-block="waits"] ui-section-header', icon: 'user-round' },
  { section: DETAIL_VIEW, place: 'Status next step marker', route: '/w/harbor/s/006/status', at: 'app-spec-rail [data-rail-block="next"] [data-rail-marker]', icon: 'user-round' },
  // spec 024 (principal 2026-10-13, claims fold): ISC-51 is an older closed claim behind its group's fold; the deep link opens it.
  { section: DETAIL_VIEW, place: 'Claims notes badge', route: '/w/harbor/s/002/claims#claim-ISC-51', at: '[data-claim="ISC-51"] [data-link="notes"]', icon: 'sticky-note' },
  { section: DETAIL_VIEW, place: 'Claims verification line', route: '/w/harbor/s/002/claims#claim-ISC-51', at: '[data-claim="ISC-51"]', icon: 'circle-check' },
  { section: DETAIL_VIEW, place: 'Tasks helper line', route: '/w/harbor/s/002/tasks', at: '[data-page="tasks"] .helper', icon: 'lock' },
  // Spec 017 (ISC-158): the former Evidence preview and Decisions fog live in the Library. An evidence file opens in
  // the reader, whose single-column way out is the back button (no dialog, so no close); the still-open fog lines stand
  // under the filter "open" with the `cloud-fog` of design.md 017.
  { section: LIBRARY_VIEW, place: 'evidence in the reader back (single column)', width: 390, route: '/w/harbor/library#002-web-console/.evidence/kpi-band-390.png', at: '[data-library-reader] [data-library-back]', icon: 'arrow-left' },
  { section: LIBRARY_VIEW, place: 'filter open fog line', route: '/w/harbor/library?state=open', at: '[data-library-fog-group] [data-library-fog-line]', icon: 'cloud-fog' },
  { section: NOTES_VIEW, place: 'notes import notice close', route: '/w/harbor/s/002/notes', at: '[data-notes-import]', icon: 'x' },
  { section: NOTES_VIEW, place: 'notes search', route: '/w/harbor/s/002/notes', at: '[data-notes-list] .notes-search', icon: 'search' },
  { section: NOTES_VIEW, place: 'notes new', route: '/w/harbor/s/002/notes', at: '[data-notes-new]', icon: 'plus' },
  { section: NOTES_VIEW, place: 'note anchor', route: '/w/harbor/s/002/notes/00000000-0000-4000-8000-000000000003', at: '[data-notes-editor]', icon: 'anchor' },
  { section: NOTES_VIEW, place: 'note delete', route: '/w/harbor/s/002/notes/00000000-0000-4000-8000-000000000003', at: '[data-note-delete]', icon: 'trash' },
  { section: NOTES_VIEW, place: 'note back (single column)', width: 390, route: '/w/harbor/s/002/notes/00000000-0000-4000-8000-000000000003', at: '[data-notes-editor]', icon: 'arrow-left' },

  // Live board (Lanes; Flow and History share the toolbar)
  { section: BOARD_VIEW, place: 'toolbar Lanes', route: '/w/harbor/s/002/board', at: '[data-control="view"] button >> nth=0', icon: 'rows-3' },
  { section: BOARD_VIEW, place: 'toolbar Flow', route: '/w/harbor/s/002/board', at: '[data-control="view"] button >> nth=1', icon: 'workflow' },
  { section: BOARD_VIEW, place: 'toolbar filter', route: '/w/harbor/s/002/board', at: '[data-board-controls] [data-lane-filter-open]', icon: 'layers' },
  { section: BOARD_VIEW, place: 'toolbar search', route: '/w/harbor/s/002/board', at: '[data-board-controls] .bsearch', icon: 'search' },
  { section: BOARD_VIEW, place: 'lane hide', route: '/w/harbor/s/002/board', at: '[data-lane] [data-hide-lane]', icon: 'x' },
  { section: BOARD_VIEW, place: 'waiting group summary', route: '/w/harbor/s/002/board', at: '[data-reason-group]', icon: 'chevron-down' },

  // Help: the lifecycle figure (the map's other help keys have no place of their own on /help)
  { section: 'help', place: 'lifecycle file', route: '/help', at: '[data-lifecycle-stage="plan"] .wf-file', icon: 'file' },
  { section: 'help', place: 'lifecycle gate', route: '/help', at: '[data-lifecycle-stage="review"] .wf-gate', icon: 'flag' },
  { section: 'help', place: 'lifecycle loop', route: '/help', at: '[data-loop="stale"]', icon: 'refresh-cw' },
];

test.describe('icons', () => {
  test('every expected name is a value of ICON_KEY_MAP or one a design.md names', () => {
    const mapped = new Set<string>([...Object.values(ICON_KEY_MAP), ...DESIGN_ICONS]);
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
