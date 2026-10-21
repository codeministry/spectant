import { inject, type Type } from '@angular/core';
import { type RedirectFunction, Router, type Routes } from '@angular/router';
import { areaOfTab, LEGACY_TAB_IDS, type LegacyTabId, SPEC_AREAS, type ShellRouteData, TAB_IDS, type TabId } from './layout/shell/areas';
import { AreaPlaceholder } from './features/spec/area-placeholder';

/**
 * Where a feature registers its view (T53 onward): one lazy loader per tab id, plus `dashboard` for the spec dashboard
 * at `/w/:ws/s/:id` itself. A key left out renders `AreaPlaceholder`, so every registered tab resolves from day one.
 * The former Docs and Evidence tabs (`LEGACY_TAB_IDS`) register none: they redirect into the Library area (T48).
 *
 *   status: () => import('./features/spec/status/status-tab').then((m) => m.StatusTab),
 */
export const VIEW_LOADERS: Partial<Record<TabId | 'dashboard', () => Promise<Type<unknown>>>> = {
  dashboard: () => import('./features/spec/dashboard/spec-dashboard').then((m) => m.SpecDashboard),
  status: () => import('./features/spec/status/status-tab').then((m) => m.StatusTab),
  timeline: () => import('./features/spec/status/timeline/timeline-tab').then((m) => m.TimelineTab),
  claims: () => import('./features/spec/data/claims/claims-tab').then((m) => m.ClaimsTab),
  // Spec 017 (T46, ISC-158): the workspace Library's own component, narrowed to the spec by the route's spec id.
  library: () => import('./features/library/library-page').then((m) => m.LibraryPage),
  tasks: () => import('./features/spec/data/tasks/tasks-tab').then((m) => m.TasksTab),
  notes: () => import('./features/spec/notes/notes-area').then((m) => m.NotesArea),
  board: () => import('./features/spec/live/board/board-tab').then((m) => m.BoardTab),
  matrix: () => import('./features/spec/live/matrix/matrix-tab').then((m) => m.MatrixTab),
};

const view = (key: TabId | 'dashboard') => {
  const load = VIEW_LOADERS[key];
  return load ? { loadComponent: load } : { component: AreaPlaceholder };
};

const data = (value: ShellRouteData): ShellRouteData => value;
/** The Notes view reads its note from the child: '' is the list, `new` or a note id the editor (T100). */
const NOTE_CHILDREN = { children: [{ path: '', children: [] }, { path: ':noteId', children: [] }] };
const isTab = (id: string): boolean => (TAB_IDS as readonly string[]).includes(id);
const isLegacyTab = (id: string): boolean => (LEGACY_TAB_IDS as readonly string[]).includes(id);

/**
 * Where each former Docs or Evidence tab lands in the spec's Library area (spec 017, T48, ISC-158.1). The spec id of
 * the address is the spec's number, while a document's catalog path starts with the spec's folder (`002-slug/plan.md`),
 * which only the catalog knows; so a spec document is named by its kind (`?doc=plan|design|spec`) and the Library page
 * resolves it to its path once the catalog is loaded, replacing `?doc=` by the path as fragment (`LibraryPage`).
 * Decisions is the `## Decisions` section of spec.md (`?section=decisions`, which the reader scrolls to). The
 * constitution's path is known (`constitution.md`, workspace-wide, listed in the spec scope). Evidence opens the
 * evidence subgroup through the existing type filter (`?type=evidence`), as the Evidence tab showed only evidence.
 */
export const LEGACY_REDIRECTS: Readonly<
  Record<LegacyTabId, { readonly queryParams: Readonly<Record<string, string>>; readonly fragment?: string }>
> = {
  evidence: { queryParams: { type: 'evidence' } },
  plan: { queryParams: { doc: 'plan' } },
  design: { queryParams: { doc: 'design' } },
  decisions: { queryParams: { doc: 'spec', section: 'decisions' } },
  constitution: { queryParams: {}, fragment: 'constitution.md' },
};

/**
 * The redirect of a former spec tab (or the former Docs area, `docs` and any path below it) to the Library area. A
 * route-level redirect as the tech one (`app.routes.ts`, T42): the old view never renders and the old address is no
 * history entry of its own. The incoming query and fragment are dropped; the target names its own.
 */
const libraryRedirect =
  (tab: LegacyTabId | null): RedirectFunction =>
  ({ params }) => {
    const target = tab === null ? { queryParams: {} } : LEGACY_REDIRECTS[tab];
    return inject(Router).createUrlTree(['/w', params['ws'] ?? '', 's', params['id'] ?? '', 'library'], {
      queryParams: target.queryParams,
      ...('fragment' in target && target.fragment !== undefined ? { fragment: target.fragment } : {}),
    });
  };

/**
 * The former Docs and Evidence addresses under `/w/:ws/s/:id`, mounted in `app.routes.ts` ahead of the spec page so
 * the redirect sees the workspace and the spec id (a child of the spec page does not inherit its parent's params).
 * `…/plan/extra` matches none of them and stays not-found inside the spec.
 */
export const LEGACY_SPEC_REDIRECTS: Routes = [
  ...LEGACY_TAB_IDS.map((tab) => ({ path: `w/:ws/s/:id/${tab}`, pathMatch: 'full' as const, redirectTo: libraryRedirect(tab) })),
  { path: 'w/:ws/s/:id/docs', children: [{ path: '**', redirectTo: libraryRedirect(null) }] },
];

/** The children of `/w/:ws/s/:id`: the dashboard, one route per tab, area-name redirects, then not-found. */
export const SPEC_AREA_ROUTES: Routes = [
  { path: '', ...view('dashboard'), data: data({ area: 'dashboard' }) },
  ...TAB_IDS.filter((tab) => !isLegacyTab(tab)).map((tab) => ({
    path: tab,
    ...view(tab),
    data: data({ area: areaOfTab(tab).id, tab }),
    ...(tab === 'notes' ? NOTE_CHILDREN : {}),
  })),
  // `live` and `data` are not tab ids: the area name alone opens its first tab (`status`, `library` and `notes` are
  // tabs). The former Docs and Evidence tabs redirect into the Library area (`LEGACY_SPEC_REDIRECTS`).
  ...SPEC_AREAS.filter((area) => area.tabs.length > 0 && !isTab(area.id)).map((area) => ({
    path: area.id,
    redirectTo: area.tabs[0] ?? '',
    pathMatch: 'full' as const,
  })),
  // A lazy chunk (spec 057): `app.routes.ts` imports this file statically, so a static `NotFound` import here would
  // put the page into the initial bundle.
  { path: '**', loadComponent: () => import('./layout/not-found/not-found').then((m) => m.NotFound), data: data({ notFound: true }) },
];
