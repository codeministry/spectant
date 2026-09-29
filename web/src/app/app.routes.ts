import { Routes } from '@angular/router';
import { HelloComponent } from './hello/hello';

export const routes: Routes = [
  { path: '', component: HelloComponent },
  // The primitives gallery the browser tier measures (T29 to T31). Lazy, so it ships as a separate chunk that only
  // `/__ui` loads and never weighs on the initial bundle; see web/src/app/dev/ui-gallery/ui-gallery.ts.
  { path: '__ui', loadComponent: () => import('./dev/ui-gallery/ui-gallery').then((m) => m.UiGallery) },
];
