import { Routes } from '@angular/router';
import { OverviewPage } from './features/overview/overview-page';
import { SettingsPage } from './features/placeholders/settings-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { SPEC_AREA_ROUTES } from './features/spec/spec-area.routes';
import { SpecPage } from './features/spec/spec-page';
import { NotFound } from './layout/not-found/not-found';
import type { ShellRouteData } from './layout/shell/areas';
import { TECH_TABS, type TechTabId } from './layout/shell/page-tabs';
import { ShellComponent } from './layout/shell/shell';

const notFound: ShellRouteData = { notFound: true };
const techTab = (tab: TechTabId): ShellRouteData => ({ page: 'tech', tab });
const featuresPage: ShellRouteData = { page: 'features' };
const milestonesPage: ShellRouteData = { page: 'milestones' };
const boardPage: ShellRouteData = { page: 'board' };
const ideaPage: ShellRouteData = { page: 'idea' };

export const routes: Routes = [
  // The primitives gallery the browser tier measures (T29 to T31). Lazy, so it ships as a separate chunk that only
  // `/__ui` loads and never weighs on the initial bundle; outside the shell on purpose (see ui-gallery.ts).
  { path: '__ui', loadComponent: () => import('./dev/ui-gallery/ui-gallery').then((m) => m.UiGallery) },
  // Every other route renders inside the one shell (ISC-73); an unknown path is the not-found page, never a redirect.
  {
    path: '',
    component: ShellComponent,
    children: [
      { path: '', component: OverviewPage },
      // The header's gear leads here until T40/T41 bring the settings popover and help.
      { path: 'settings', component: SettingsPage },
      // Spec 008 (ISC-116): help is global like settings, inside the shell and outside any workspace; lazy, its own chunk.
      { path: 'help', loadComponent: () => import('./features/help/help-page').then((m) => m.HelpPage) },
      { path: 'w/:ws', component: DashboardPage },
      // Spec 008 (ISC-129, ISC-124.2): the workspace board, a sibling of the planning pages, and a story's read-only
      // page, reached from a board card, the palette or an idea chip; an unknown slug renders not-found in the page.
      {
        path: 'w/:ws/board',
        loadComponent: () => import('./features/board/board-page').then((m) => m.BoardPage),
        data: boardPage,
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
      // Spec 023 (ISC-134.1): the tech page, one route per tab like a spec area; `/w/:ws/tech` opens the first tab. The
      // tabs are componentless children of one lazy page, so a tab switch keeps the page; an unknown tab falls past
      // them to not-found with the workspace still in the route.
      {
        path: 'w/:ws/tech',
        children: [
          { path: '', redirectTo: TECH_TABS[0], pathMatch: 'full' },
          {
            path: '',
            loadComponent: () => import('./features/tech/tech-page').then((m) => m.TechPage),
            children: TECH_TABS.map((tab) => ({ path: tab, children: [], data: techTab(tab) })),
          },
          { path: '**', component: NotFound, data: notFound },
        ],
      },
      { path: 'w/:ws/s/:id', component: SpecPage, children: SPEC_AREA_ROUTES },
      { path: '**', component: NotFound, data: notFound },
    ],
  },
];
