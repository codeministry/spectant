import type { Routes } from '@angular/router';
import type { ShellRouteData } from '../../layout/shell/areas';
import { TECH_TABS } from '../../layout/shell/page-tabs';

/**
 * The former tech page's routes (spec 023, ISC-134.1), for its own unit specs only. Since spec 017 (T42, ISC-157.1) the
 * app's table redirects `/w/:ws/tech` and every tab to the Library, so no route of the app reaches `TechPage` any more;
 * its specs mount it through this table until T50 removes the page, and this file with it.
 */
const TECH_PAGE_ROUTE: Routes[number] = {
  path: 'w/:ws/tech',
  children: [
    { path: '', redirectTo: TECH_TABS[0], pathMatch: 'full' },
    {
      path: '',
      loadComponent: () => import('./tech-page').then((m) => m.TechPage),
      children: TECH_TABS.map((tab) => ({ path: tab, children: [], data: { page: 'tech', tab } satisfies ShellRouteData })),
    },
  ],
};

/** `routes` with the former tech page in front of the shell's children, ahead of the redirects that replaced it. */
export const withTechPage = (routes: Routes): Routes =>
  routes.map((route) => (route.path === '' && route.children ? { ...route, children: [TECH_PAGE_ROUTE, ...route.children] } : route));
