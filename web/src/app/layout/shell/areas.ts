import type { IconName } from '../../shared/icons/icons';
import type { PlanningLensId } from './page-tabs';

/**
 * The spec page's areas and their tabs (design.md, ISC-76): the one registry the area menu, the tab bar, the routes
 * and (T102) the `g` sequences read. Order is menu order; each area's tabs are in tab-bar order.
 *
 * - `dashboard` has no tabs: it is `/w/:ws/s/:id` itself (ISC-78).
 * - An area whose id is not one of its tabs (`live`, `data`) also answers `/w/:ws/s/:id/<area>` by redirecting to its
 *   first tab, so a deep link or a `g` key can name the area alone.
 * - `library` (spec 017, T45, ISC-158) stands where Docs stood: one tab, Documents, at `/w/:ws/s/:id/library`, the
 *   workspace Library's component narrowed to the spec. Data keeps Claims and Tasks; the evidence is in the Library.
 * - `built: false` marks an area whose tabs are not built yet; the area menu shows it disabled with its reason (the
 *   mark on ISC-76) and the route still resolves to the placeholder, so a deep link never 404s on a known tab.
 */
export const AREA_IDS = ['dashboard', 'status', 'live', 'data', 'library', 'notes'] as const;
export type AreaId = (typeof AREA_IDS)[number];

/**
 * The former tabs of the Docs area and Data's Evidence (spec 017, ISC-158.1): no area lists them any more, but their
 * addresses redirect into the Library area (T48, `LEGACY_SPEC_REDIRECTS`); the ids stay for the links that name them.
 */
export const LEGACY_TAB_IDS = ['evidence', 'plan', 'design', 'decisions', 'constitution'] as const;
export type LegacyTabId = (typeof LEGACY_TAB_IDS)[number];

export const TAB_IDS = ['status', 'timeline', 'board', 'matrix', 'claims', 'tasks', 'library', 'notes', ...LEGACY_TAB_IDS] as const;
export type TabId = (typeof TAB_IDS)[number];

export interface SpecArea {
  readonly id: AreaId;
  readonly tabs: readonly TabId[];
  readonly icon: IconName;
  readonly built: boolean;
  /**
   * The second key of the area's `g` sequence (ISC-97, the shortcut sheet: `g s` `g l` `g d` `g o` `g n`), shown
   * as a hint in the area menu. The binding is T102's; the dashboard has none yet.
   */
  readonly goKey: string | null;
  /**
   * The tab bar shows although the area has one tab (spec 017, design.md § Across viewports): the Library's
   * eyebrow and its one tab Documents with its count. Without it a one-tab area (Notes) has no bar.
   */
  readonly singleTabBar?: true;
  /**
   * The area runs without the context column (spec 017 design.md § Across viewports), so
   * the Library's list and reader have the width of the workspace Library; the Live tabs Board and Matrix (spec 075)
   * draw no rail either and take the full width, while zen keeps its footer there.
   */
  readonly noRail?: true;
}

export const SPEC_AREAS: readonly SpecArea[] = [
  { id: 'dashboard', tabs: [], icon: 'layout-dashboard', built: true, goKey: null },
  { id: 'status', tabs: ['status', 'timeline'], icon: 'activity', built: true, goKey: 's' },
  { id: 'live', tabs: ['board', 'matrix'], icon: 'square-kanban', built: true, goKey: 'l', noRail: true },
  { id: 'data', tabs: ['claims', 'tasks'], icon: 'table', built: true, goKey: 'd' },
  // Spec 017 (T45, ISC-158): the Library where Docs stood, with Docs' `g o`; one tab, Documents, at `…/library`.
  { id: 'library', tabs: ['library'], icon: 'book', built: true, goKey: 'o', singleTabBar: true, noRail: true },
  { id: 'notes', tabs: ['notes'], icon: 'notebook-pen', built: true, goKey: 'n' },
];

export const areaById = (id: AreaId): SpecArea => SPEC_AREAS.find((area) => area.id === id) ?? must(id);

const isLegacyTab = (tab: TabId): boolean => (LEGACY_TAB_IDS as readonly TabId[]).includes(tab);

/** The area a tab belongs to; a former Docs or Evidence tab (`LEGACY_TAB_IDS`) counts as the Library. */
export const areaOfTab = (tab: TabId): SpecArea =>
  SPEC_AREAS.find((area) => area.tabs.includes(tab)) ?? (isLegacyTab(tab) ? areaById('library') : must(tab));

/** The path of an area under `/w/:ws/s/:id`: '' for the dashboard, else its first tab. */
export const areaPath = (area: SpecArea): string => area.tabs[0] ?? '';

/** `['/w', ws, 's', id, …]` as a router link; `tab` '' is the spec dashboard. */
export const specLink = (ws: string, id: string, tab = ''): string[] => (tab ? ['/w', ws, 's', id, tab] : ['/w', ws, 's', id]);

/** Spec 051 (ISC-291, ISC-292): the target of a spec switch keeps the route's tab; no tab or a former Docs/Evidence tab gives the new spec's dashboard. */
export const switchSpecLink = (ws: string, id: string, tab: TabId | null): string[] =>
  specLink(ws, id, tab === null || isLegacyTab(tab) ? '' : tab);

export const isTabId = (value: unknown): value is TabId => (TAB_IDS as readonly unknown[]).includes(value);
export const isAreaId = (value: unknown): value is AreaId => (AREA_IDS as readonly unknown[]).includes(value);

function must(key: string): never {
  throw new Error(`areas: nothing registered for "${key}"`);
}

/** Route data the shell reads (`ShellState.route`): which area and tab a route shows, or that it is the not-found page. */
export interface ShellRouteData {
  readonly area?: AreaId;
  /** A spec tab under `/w/:ws/s/:id`, or a lens on `page: 'planning'` (`ShellState.route().lens`, spec 026). */
  readonly tab?: TabId | PlanningLensId;
  /** The workspace-scope page a `w/:ws` route shows (`ShellState.route().wsPage`); absent means the spec list. */
  readonly page?: WorkspacePageId;
  readonly notFound?: boolean;
}

/**
 * The workspace-scope pages, the counterpart of the spec areas one level up. `idea` (spec 008, `/w/:ws/ideas/:slug`)
 * is a read-only story page reached from a board card, the palette or a chip, never from the menu: it has no
 * `WORKSPACE_PAGES` entry, so the menu's pages are `WorkspaceMenuPageId`. Spec 023's tech page is gone: spec 017
 * folded it into the Library (T41, ISC-157.1, removed in T50), `/w/:ws/tech` and every `/w/:ws/tech/<tab>` redirect
 * there (`app.routes.ts`). `library` (spec 024,
 * `/w/:ws/library`, on the real catalog since spec 017) stands where Tech stood, fifth after Milestones. Spec 058
 * (ISC-394) splits the workspace root: `dashboard` is `/w/:ws` itself, `specs` the spec list at `/w/:ws/specs`.
 */
export type WorkspacePageId = 'dashboard' | 'specs' | 'board' | 'planning' | 'features' | 'milestones' | 'idea' | 'library';
export type WorkspaceMenuPageId = Exclude<WorkspacePageId, 'idea'>;

const WORKSPACE_PAGE_IDS: readonly WorkspacePageId[] = ['dashboard', 'specs', 'board', 'planning', 'features', 'milestones', 'idea', 'library'];

export const isWorkspacePageId = (value: unknown): value is WorkspacePageId =>
  (WORKSPACE_PAGE_IDS as readonly unknown[]).includes(value);

/**
 * A page of a workspace (`/w/:ws`, `/w/:ws/specs`, `/w/:ws/board`, …): the registry the PAGE select's menu
 * (spec 024 T80), the palette and the routes read, in menu order. It always holds every entry; `milestones` is only listed by the menu (and the
 * palette, and answered by the route) while `ShellData.hasMilestones` is true (ISC-104, T26), so the filtering lives
 * with the reader, not here.
 */
export interface WorkspacePage {
  readonly id: WorkspaceMenuPageId;
  readonly icon: IconName;
  /** Transloco key of the page's name: `shell.pages.<id>`. */
  readonly labelKey: string;
  /** Transloco key of the one-line summary the menu shows under the name: `shell.pages.summary.<id>`. */
  readonly summaryKey: string;
  /**
   * The second key of the page's `g` sequence, read by `SHORTCUTS`: Board's `g b` (spec 008, T117), Features' `g f`
   * and Milestones' `g m` (spec 024, T58, ISC-150.1), Library's `g o` (spec 017, T41, ISC-157.1: the key that opens
   * the documents inside a spec, the Library area since T45, opens them at workspace scope; `g b` is the Board's).
   * The dashboard and Specs have none: `g s` is Status inside a spec and no workspace-scope binding exists.
   */
  readonly goKey: string | null;
}

export const WORKSPACE_PAGES: readonly WorkspacePage[] = [
  // Spec 058 (ISC-394): the workspace dashboard, first in the menu, at the workspace root `/w/:ws`; the spec list
  // moved to `/w/:ws/specs`, second. Its summary line counts what waits on the viewer and the warnings.
  { id: 'dashboard', icon: 'layout-dashboard', labelKey: 'shell.pages.dashboard', summaryKey: 'shell.pages.summary.dashboard', goKey: null },
  { id: 'specs', icon: 'file-text', labelKey: 'shell.pages.specs', summaryKey: 'shell.pages.summary.specs', goKey: null },
  // Spec 008 (ISC-129): the workspace board, second in the menu, "Board" (the spec's tab is the "Round board"). Its
  // summary line counts through the board's own model (T116). `g b` is bound (T117, SHORTCUTS `go-board`): the
  // 2026-10-11 review found it free, the round board's `b` being a tab inside a spec, not a `g` sequence.
  { id: 'board', icon: 'square-kanban', labelKey: 'shell.pages.board', summaryKey: 'shell.pages.summary.board', goKey: 'b' },
  // Spec 026 (ISC-167, ISC-167.1): Planning, one page with the lenses Gantt (spec 038), Tree and Graph, replaces Features
  // and Milestones in the menu; their routes redirect to the tree, and `g f` / `g m` open the page (the Gantt).
  { id: 'planning', icon: 'list-tree', labelKey: 'shell.pages.planning', summaryKey: 'shell.pages.summary.planning', goKey: 'p' },
  // Spec 017 (T41, ISC-157.1): the Library where Tech stood, after Planning; Tech's content is in it and its routes
  // redirect there. The summary counts the catalog's documents, outdated and missing ones (`AreaMenu`).
  { id: 'library', icon: 'book', labelKey: 'shell.pages.library', summaryKey: 'shell.pages.summary.library', goKey: 'o' },
];

/** A menu page's entry. */
export const workspacePageById = (id: WorkspaceMenuPageId): WorkspacePage => WORKSPACE_PAGES.find((page) => page.id === id) ?? must(id);

/**
 * `['/w', ws]` for the dashboard (the workspace root, spec 058), else `['/w', ws, page]`, as a router link; Specs is
 * `['/w', ws, 'specs']`.
 */
export const workspaceLink = (ws: string, page: WorkspaceMenuPageId): string[] => (page === 'dashboard' ? ['/w', ws] : ['/w', ws, page]);

/** `['/w', ws, 'planning', 'tree']`, the planning page's tree lens as a router link (spec 026, ISC-167). */
export const planningTreeLink = (ws: string): string[] => ['/w', ws, 'planning', 'tree'];

/**
 * The `?sel=` ref an old planning anchor names (spec 026, ISC-167.1): `F<n>` on `/features` is `feature:F<n>`,
 * `m-<slug>` on `/milestones` is `milestone:<slug>`; any other anchor names nothing.
 */
export function anchorRef(page: 'features' | 'milestones', fragment: string | null): string | null {
  if (fragment === null) return null;
  if (page === 'features') return /^F\d+$/u.test(fragment) ? `feature:${fragment}` : null;
  const slug = /^m-(.+)$/u.exec(fragment)?.[1];
  return slug === undefined ? null : `milestone:${slug}`;
}
