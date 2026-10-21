import { inject } from '@angular/core';
import { type CanActivateFn, RedirectCommand, type RedirectFunction, Router, type Routes } from '@angular/router';
import { LIST_QUERY_KEYS } from './features/dashboard/spec-table/spec-table-model';
import { LEGACY_SPEC_REDIRECTS, SPEC_AREA_ROUTES } from './spec-area.routes';
import { anchorRef, planningTreeLink, type ShellRouteData } from './layout/shell/areas';
import { PLANNING_LENSES, type PlanningLensId } from './layout/shell/page-tabs';
import { ShellComponent } from './layout/shell/shell';
import { OPEN_PARAM, parseOpen } from './shared/open-state';

const notFound: ShellRouteData = { notFound: true };
// Spec 024: the designed not-found page is a lazy chunk, so it does not weigh on the initial bundle (1 MB budget).
const notFoundPage = () => import('./layout/not-found/not-found').then((m) => m.NotFound);
const planningLens = (tab: PlanningLensId): ShellRouteData => ({ page: 'planning', tab });
/** The redirect of an old planning page to the tree lens, its anchor as `?sel=` when it names an object. */
const toTree =
  (page: 'features' | 'milestones'): RedirectFunction =>
  ({ params, fragment }) => {
    const sel = anchorRef(page, fragment);
    return inject(Router).createUrlTree(planningTreeLink(String(params['ws'])), sel === null ? {} : { queryParams: { sel } });
  };
const dashboardPage: ShellRouteData = { page: 'dashboard' };
const specsPage: ShellRouteData = { page: 'specs' };
const boardPage: ShellRouteData = { page: 'board' };
const ideaPage: ShellRouteData = { page: 'idea' };
const libraryPage: ShellRouteData = { page: 'library' };

/** The former tech page's tabs (spec 023), each address of which redirects into the Library. */
type FormerTechTab = 'overview' | 'architecture' | 'status' | 'specs' | 'open';

/**
 * Where each former tech tab lives in the Library (spec 017, T42, ISC-157.1): Overview and Architecture are sections of
 * `tech.md` (the document as the fragment, the section as `?section=`), Status and Specs are the list itself, grouped by
 * spec, and Open is the filter "open" (`?state=open`). `/w/:ws/tech` alone is Overview, the old first tab.
 */
export const TECH_REDIRECTS: Readonly<Record<FormerTechTab, { readonly queryParams: Readonly<Record<string, string>>; readonly fragment?: string }>> = {
  overview: { queryParams: { section: 'overview' }, fragment: 'tech.md' },
  architecture: { queryParams: { section: 'architecture' }, fragment: 'tech.md' },
  status: { queryParams: {} },
  specs: { queryParams: {} },
  open: { queryParams: { state: 'open' } },
};

/**
 * The redirect of a former tech address to the Library. A route-level redirect, so the tech page never renders and the
 * old address never becomes a history entry of its own: the navigation lands on the Library URL, and the first load's
 * navigation replaces the entry it started from. The incoming query and fragment are dropped; the target names its own.
 */
const techRedirect =
  (tab: FormerTechTab): RedirectFunction =>
  ({ params }) => {
    const target = TECH_REDIRECTS[tab];
    return inject(Router).createUrlTree(['/w', params['ws'] ?? '', 'library'], {
      queryParams: target.queryParams,
      ...(target.fragment === undefined ? {} : { fragment: target.fragment }),
    });
  };

/**
 * Spec 058 (T20, ISC-396, ISC-400): whether a dashboard address is an old list address. One of the list's own params
 * (`LIST_QUERY_KEYS`) counts, and `?open=` only when it opens the list's "show all" fold (`specs`); `?open=tldr` and
 * `?sel=` stay the dashboard's own.
 */
export function isListAddress(queryParams: Readonly<Record<string, unknown>>): boolean {
  if (LIST_QUERY_KEYS.some((key) => key in queryParams)) return true;
  const open: unknown = queryParams[OPEN_PARAM];
  const values = (Array.isArray(open) ? open : [open]).filter((value): value is string => typeof value === 'string');
  return values.some((value) => parseOpen(value).includes('specs'));
}

/**
 * Sends an old list address of the dashboard on to the Specs page with the same query (every param, `sel` included)
 * and fragment. A guard, not a redirect route, since a redirect cannot look at the query; the lazy page stays a lazy
 * chunk, and the redirect replaces the history entry, so Back never lands on the old address.
 */
const listAddressToSpecs: CanActivateFn = ({ params, queryParams, fragment }) => {
  if (!isListAddress(queryParams)) return true;
  const router = inject(Router);
  const target = router.createUrlTree(['/w', params['ws'] ?? '', 'specs'], { queryParams, ...(fragment === null ? {} : { fragment }) });
  return new RedirectCommand(target, { replaceUrl: true });
};

export const routes: Routes = [
  // The primitives gallery the browser tier measures (T29 to T31). Lazy, so it ships as a separate chunk that only
  // `/__ui` loads and never weighs on the initial bundle; outside the shell on purpose (see ui-gallery.ts).
  { path: '__ui', loadComponent: () => import('./dev/ui-gallery/ui-gallery').then((m) => m.UiGallery) },
  // Every other route renders inside the one shell (ISC-73); an unknown path is the not-found page, never a redirect.
  {
    path: '',
    component: ShellComponent,
    children: [
      // Spec 024: the overview and settings are lazy chunks, so the identity covers and the settings cards stay out of
      // the initial bundle (its 1 MB budget in angular.json).
      { path: '', loadComponent: () => import('./features/overview/overview-page').then((m) => m.OverviewPage) },
      { path: 'settings', loadComponent: () => import('./features/settings/settings-page').then((m) => m.SettingsPage) },
      // Spec 024 (T52): the workspace management, a mock until the registry's spec; lazy, its own chunk.
      {
        path: 'settings/workspaces',
        loadComponent: () => import('./features/settings/settings-workspaces-page').then((m) => m.SettingsWorkspacesPage),
      },
      // Spec 008 (ISC-116): help is global like settings, inside the shell and outside any workspace; lazy, its own chunk.
      { path: 'help', loadComponent: () => import('./features/help/help-page').then((m) => m.HelpPage) },
      // Spec 024: the workspace dashboard is a lazy chunk too, which keeps the initial bundle clear of its 1 MB budget.
      // Spec 058 (ISC-390): the route names its page, so the side menu marks the dashboard, not the Specs page.
      {
        path: 'w/:ws',
        loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage),
        // Spec 058 (ISC-396): an old list address of the dashboard goes on to the Specs page.
        canActivate: [listAddressToSpecs],
        data: dashboardPage,
      },
      // Spec 058 (ISC-391): the workspace's Specs page, the spec list with the backlog; lazy, its own chunk.
      {
        path: 'w/:ws/specs',
        loadComponent: () => import('./features/dashboard/specs-page/specs-page').then((m) => m.SpecsPage),
        data: specsPage,
      },
      // Spec 008 (ISC-129, ISC-124.2): the workspace board, a sibling of the planning pages, and a story's read-only
      // page, reached from a board card, the palette or an idea chip; an unknown slug renders not-found in the page.
      {
        path: 'w/:ws/board',
        loadComponent: () => import('./features/board/board-page').then((m) => m.BoardPage),
        data: boardPage,
      },
      // Spec 024 (T50, T51): the workspace's Library, a mock until spec 017 delivers the documents; lazy, its own chunk.
      {
        path: 'w/:ws/library',
        loadComponent: () => import('./features/library/library-page').then((m) => m.LibraryPage),
        data: libraryPage,
      },
      {
        path: 'w/:ws/ideas/:slug',
        loadComponent: () => import('./features/ideas/idea-page').then((m) => m.IdeaPage),
        data: ideaPage,
      },
      // Spec 026 (ISC-167): the planning page, one route per lens like the tech page; `/w/:ws/planning` opens the Gantt lens
      // (spec 038, ISC-203), which took the Matrix lens's place and its role as the default (PR #31).
      // The lenses are componentless children of one lazy page, so a lens switch keeps the page (and its overview).
      {
        path: 'w/:ws/planning',
        children: [
          { path: '', redirectTo: 'gantt', pathMatch: 'full' },
          // Spec 038 (ISC-203.1): the Matrix lens's address leads to the Gantt lens that replaced it; the query (`?sel=`, `?m=`)
          // rides along, as a relative redirect keeps it.
          { path: 'board', redirectTo: 'gantt', pathMatch: 'full' },
          {
            path: '',
            loadComponent: () => import('./features/planning/planning-lens-page').then((m) => m.PlanningPage),
            children: PLANNING_LENSES.map((lens) => ({ path: lens, children: [], data: planningLens(lens) })),
          },
          { path: '**', loadComponent: notFoundPage, data: notFound },
        ],
      },
      // Spec 026 (ISC-167.1): the old Features and Milestones pages (spec 003) are redirects to the tree lens; an anchor
      // naming a feature (`#F8`) or a milestone (`#m-<slug>`) becomes `?sel=`, so the tree opens the path, focuses the
      // row and the sidebar shows the object. A redirect replaces the old address, so Back skips it.
      { path: 'w/:ws/features', pathMatch: 'full', redirectTo: toTree('features') },
      { path: 'w/:ws/milestones', pathMatch: 'full', redirectTo: toTree('milestones') },
      // Spec 023's tech page went into the Library (spec 017, T42, ISC-157.1): `/w/:ws/tech` and each of its five tabs
      // redirect there with the matching selection (`TECH_REDIRECTS`); any other path below it is not-found with the
      // workspace still in the route. The old page itself is gone (T50).
      { path: 'w/:ws/tech', pathMatch: 'full', redirectTo: techRedirect('overview') },
      ...(Object.keys(TECH_REDIRECTS) as FormerTechTab[]).map((tab) => ({ path: `w/:ws/tech/${tab}`, pathMatch: 'full' as const, redirectTo: techRedirect(tab) })),
      { path: 'w/:ws/tech', children: [{ path: '**', loadComponent: notFoundPage, data: notFound }] },
      // Spec 017 (T48, ISC-158.1): the former Docs and Evidence tabs redirect into the spec's Library area.
      ...LEGACY_SPEC_REDIRECTS,
      // Spec 021: the spec page (its head, gate button, overlaps and rail) is a lazy chunk like every other page, which
      // keeps it out of the initial bundle (its 1 MB budget in angular.json); its tab views load lazily below it.
      {
        path: 'w/:ws/s/:id',
        loadComponent: () => import('./features/spec/spec-page').then((m) => m.SpecPage),
        children: SPEC_AREA_ROUTES,
      },
      { path: '**', loadComponent: notFoundPage, data: notFound },
    ],
  },
];
