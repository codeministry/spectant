import { Routes } from '@angular/router';
import { OverviewPage } from './features/overview/overview-page';
import { SettingsPage } from './features/placeholders/settings-page';
import { DashboardPage } from './features/dashboard/dashboard-page';
import { SPEC_AREA_ROUTES } from './features/spec/spec-area.routes';
import { SpecPage } from './features/spec/spec-page';
import { NotFound } from './layout/not-found/not-found';
import type { ShellRouteData } from './layout/shell/areas';
import { ShellComponent } from './layout/shell/shell';

const notFound: ShellRouteData = { notFound: true };
const featuresPage: ShellRouteData = { page: 'features' };
const milestonesPage: ShellRouteData = { page: 'milestones' };

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
      { path: 'w/:ws', component: DashboardPage },
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
      { path: 'w/:ws/s/:id', component: SpecPage, children: SPEC_AREA_ROUTES },
      { path: '**', component: NotFound, data: notFound },
    ],
  },
];
