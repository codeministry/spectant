import { Routes } from '@angular/router';
import { OverviewPage } from './features/placeholders/overview-page';
import { WorkspacePage } from './features/placeholders/workspace-page';
import { SPEC_AREA_ROUTES } from './features/spec/spec-area.routes';
import { SpecPage } from './features/spec/spec-page';
import { NotFound } from './layout/not-found/not-found';
import type { ShellRouteData } from './layout/shell/areas';
import { ShellComponent } from './layout/shell/shell';

const notFound: ShellRouteData = { notFound: true };

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
      { path: 'w/:ws', component: WorkspacePage },
      { path: 'w/:ws/s/:id', component: SpecPage, children: SPEC_AREA_ROUTES },
      { path: '**', component: NotFound, data: notFound },
    ],
  },
];
