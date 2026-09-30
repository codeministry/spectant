import type { IconName } from '../../shared/icons/icons';

/**
 * The spec page's areas and their tabs (design.md, ISC-76): the one registry the area menu, the tab bar, the routes
 * and (T102) the `g` sequences read. Order is menu order; each area's tabs are in tab-bar order.
 *
 * - `dashboard` has no tabs: it is `/w/:ws/s/:id` itself (ISC-78).
 * - An area whose id is not one of its tabs (`live`, `data`, `docs`) also answers `/w/:ws/s/:id/<area>` by redirecting
 *   to its first tab, so a deep link or a `g` key can name the area alone.
 * - `built: false` marks an area whose tabs are not built yet; the area menu shows it disabled with its reason (the
 *   mark on ISC-76) and the route still resolves to the placeholder, so a deep link never 404s on a known tab.
 */
export const AREA_IDS = ['dashboard', 'status', 'live', 'data', 'docs', 'notes'] as const;
export type AreaId = (typeof AREA_IDS)[number];

export const TAB_IDS = [
  'status',
  'timeline',
  'board',
  'matrix',
  'claims',
  'tasks',
  'evidence',
  'plan',
  'design',
  'decisions',
  'constitution',
  'notes',
] as const;
export type TabId = (typeof TAB_IDS)[number];

export interface SpecArea {
  readonly id: AreaId;
  readonly tabs: readonly TabId[];
  readonly icon: IconName;
  readonly built: boolean;
  /**
   * The second key of the area's `g` sequence (ISC-97, the prototype's shortcut sheet: `g s` `g l` `g d` `g o` `g n`), shown
   * as a hint in the area menu. The binding is T102's; the dashboard has none yet (the prototype names none).
   */
  readonly goKey: string | null;
}

export const SPEC_AREAS: readonly SpecArea[] = [
  { id: 'dashboard', tabs: [], icon: 'layout-dashboard', built: true, goKey: null },
  { id: 'status', tabs: ['status', 'timeline'], icon: 'activity', built: true, goKey: 's' },
  { id: 'live', tabs: ['board', 'matrix'], icon: 'square-kanban', built: true, goKey: 'l' },
  { id: 'data', tabs: ['claims', 'tasks', 'evidence'], icon: 'table', built: true, goKey: 'd' },
  { id: 'docs', tabs: ['plan', 'design', 'decisions', 'constitution'], icon: 'file-text', built: true, goKey: 'o' },
  { id: 'notes', tabs: ['notes'], icon: 'notebook-pen', built: true, goKey: 'n' },
];

export const areaById = (id: AreaId): SpecArea => SPEC_AREAS.find((area) => area.id === id) ?? must(id);

/** The area a tab belongs to. */
export const areaOfTab = (tab: TabId): SpecArea => SPEC_AREAS.find((area) => area.tabs.includes(tab)) ?? must(tab);

/** The path of an area under `/w/:ws/s/:id`: '' for the dashboard, else its first tab. */
export const areaPath = (area: SpecArea): string => area.tabs[0] ?? '';

/** `['/w', ws, 's', id, …]` as a router link; `tab` '' is the spec dashboard. */
export const specLink = (ws: string, id: string, tab = ''): string[] => (tab ? ['/w', ws, 's', id, tab] : ['/w', ws, 's', id]);

export const isTabId = (value: unknown): value is TabId => (TAB_IDS as readonly unknown[]).includes(value);
export const isAreaId = (value: unknown): value is AreaId => (AREA_IDS as readonly unknown[]).includes(value);

function must(key: string): never {
  throw new Error(`areas: nothing registered for "${key}"`);
}

/** Route data the shell reads (`ShellState.route`): which area and tab a route shows, or that it is the not-found page. */
export interface ShellRouteData {
  readonly area?: AreaId;
  readonly tab?: TabId;
  /** The workspace-scope page a `w/:ws` route shows (`ShellState.route().wsPage`); absent means the spec list. */
  readonly page?: WorkspacePageId;
  readonly notFound?: boolean;
}

/** The workspace-scope pages, the counterpart of the spec areas one level up. */
export type WorkspacePageId = 'specs' | 'features' | 'milestones';

export const isWorkspacePageId = (value: unknown): value is WorkspacePageId =>
  value === 'specs' || value === 'features' || value === 'milestones';

/**
 * A page of a workspace (`/w/:ws`, `/w/:ws/features`, `/w/:ws/milestones`): the registry the area menu, the palette and
 * the routes read, in menu order. It always holds all three entries; `milestones` is only listed by the menu (and the
 * palette, and answered by the route) while `ShellData.hasMilestones` is true (ISC-104, T26), so the filtering lives
 * with the reader, not here.
 */
export interface WorkspacePage {
  readonly id: WorkspacePageId;
  readonly icon: IconName;
  /** Transloco key of the page's name: `shell.pages.<id>`. */
  readonly labelKey: string;
  /** Transloco key of the one-line summary the menu shows under the name: `shell.pages.summary.<id>`. */
  readonly summaryKey: string;
  /**
   * The second key of a candidate `g` sequence (`g f`, `g m`), not bound: the keys are a proposal (design.md § Keyboard,
   * plan.md § Open Points) that `/spec-review 003` decides, and `SHORTCUTS` does not read this field yet. Specs has
   * none: `g s` is Status inside a spec and no workspace-scope binding exists.
   */
  readonly goKey: string | null;
}

export const WORKSPACE_PAGES: readonly WorkspacePage[] = [
  { id: 'specs', icon: 'file-text', labelKey: 'shell.pages.specs', summaryKey: 'shell.pages.summary.specs', goKey: null },
  { id: 'features', icon: 'layers', labelKey: 'shell.pages.features', summaryKey: 'shell.pages.summary.features', goKey: 'f' },
  { id: 'milestones', icon: 'flag', labelKey: 'shell.pages.milestones', summaryKey: 'shell.pages.summary.milestones', goKey: 'm' },
];

export const workspacePageById = (id: WorkspacePageId): WorkspacePage => WORKSPACE_PAGES.find((page) => page.id === id) ?? must(id);

/** `['/w', ws]` for Specs (the workspace root), else `['/w', ws, page]`, as a router link. */
export const workspaceLink = (ws: string, page: WorkspacePageId): string[] => (page === 'specs' ? ['/w', ws] : ['/w', ws, page]);
