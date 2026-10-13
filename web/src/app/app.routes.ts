import { inject } from '@angular/core';
import { type RedirectFunction, Router, type Routes } from '@angular/router';
import { SPEC_AREA_ROUTES } from './features/spec/spec-area.routes';
import { SpecPage } from './features/spec/spec-page';
import type { ShellRouteData } from './layout/shell/areas';
import { TECH_TABS, type TechTabId } from './layout/shell/page-tabs';
import { ShellComponent } from './layout/shell/shell';

const notFound: ShellRouteData = { notFound: true };
// Spec 024: the designed not-found page is a lazy chunk, so it does not weigh on the initial bundle (1 MB budget).
const notFoundPage = () => import('./layout/not-found/not-found').then((m) => m.NotFound);
const featuresPage: ShellRouteData = { page: 'features' };
const milestonesPage: ShellRouteData = { page: 'milestones' };
const boardPage: ShellRouteData = { page: 'board' };
const ideaPage: ShellRouteData = { page: 'idea' };
const libraryPage: ShellRouteData = { page: 'library' };

/**
 * Where each former tech tab lives in the Library (spec 017, T42, ISC-157.1): Overview and Architecture are sections of
 * `tech.md` (the document as the fragment, the section as `?section=`), Status and Specs are the list itself, grouped by
 * spec, and Open is the filter "open" (`?state=open`). `/w/:ws/tech` alone is Overview, the old first tab.
 */
export const TECH_REDIRECTS: Readonly<Record<TechTabId, { readonly queryParams: Readonly<Record<string, string>>; readonly fragment?: string }>> = {
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
  (tab: TechTabId): RedirectFunction =>
  ({ params }) => {
    const target = TECH_REDIRECTS[tab];
    return inject(Router).createUrlTree(['/w', params['ws'] ?? '', 'library'], {
      queryParams: target.queryParams,
      ...(target.fragment === undefined ? {} : { fragment: target.fragment }),
    });
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
      { path: 'settings', loadComponent: () => import('./features/placeholders/settings-page').then((m) => m.SettingsPage) },
      // Spec 024 (T52): the workspace management, a mock until the registry's spec; lazy, its own chunk.
      {
        path: 'settings/workspaces',
        loadComponent: () => import('./features/settings/settings-workspaces-page').then((m) => m.SettingsWorkspacesPage),
      },
      // Spec 008 (ISC-116): help is global like settings, inside the shell and outside any workspace; lazy, its own chunk.
      { path: 'help', loadComponent: () => import('./features/help/help-page').then((m) => m.HelpPage) },
      // Spec 024: the workspace dashboard is a lazy chunk too, which keeps the initial bundle clear of its 1 MB budget.
      { path: 'w/:ws', loadComponent: () => import('./features/dashboard/dashboard-page').then((m) => m.DashboardPage) },
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
      // The workspace's planning pages (spec 003, ISC-103 / ISC-104): siblings of the spec list, reached through the
      // area menu at workspace scope; lazy, so they ship as one chunk that only these two routes load.
      {
        path: 'w/:ws/features',
        loadComponent: () => import('./features/planning/features-page').then((m) => m.FeaturesPage),
        data: featuresPage,
      },
      {
        path: 'w/:ws/milestones',
        loadComponent: () => import('./features/planning/milestones-page').then((m) => m.MilestonesPage),
        data: milestonesPage,
      },
      // Spec 023's tech page went into the Library (spec 017, T42, ISC-157.1): `/w/:ws/tech` and each of its five tabs
      // redirect there with the matching selection (`TECH_REDIRECTS`); any other path below it is not-found with the
      // workspace still in the route. The old page stays in the codebase until T50 but no route reaches it.
      { path: 'w/:ws/tech', pathMatch: 'full', redirectTo: techRedirect('overview') },
      ...TECH_TABS.map((tab) => ({ path: `w/:ws/tech/${tab}`, pathMatch: 'full' as const, redirectTo: techRedirect(tab) })),
      { path: 'w/:ws/tech', children: [{ path: '**', loadComponent: notFoundPage, data: notFound }] },
      { path: 'w/:ws/s/:id', component: SpecPage, children: SPEC_AREA_ROUTES },
      { path: '**', loadComponent: notFoundPage, data: notFound },
    ],
  },
];
