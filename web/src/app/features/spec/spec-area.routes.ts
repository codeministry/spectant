import type { Routes } from '@angular/router';
import type { Type } from '@angular/core';
import { areaOfTab, SPEC_AREAS, type ShellRouteData, TAB_IDS, type TabId } from '../../layout/shell/areas';
import { NotFound } from '../../layout/not-found/not-found';
import { AreaPlaceholder } from './area-placeholder';

/**
 * Where a feature registers its view (T53 onward): one lazy loader per tab id, plus `dashboard` for the spec dashboard
 * at `/w/:ws/s/:id` itself. A key left out renders `AreaPlaceholder`, so every registered tab resolves from day one.
 *
 *   status: () => import('./status/status-tab').then((m) => m.StatusTab),
 */
export const VIEW_LOADERS: Partial<Record<TabId | 'dashboard', () => Promise<Type<unknown>>>> = {
  timeline: () => import('./status/timeline/timeline-tab').then((m) => m.TimelineTab),
  claims: () => import('./data/claims/claims-tab').then((m) => m.ClaimsTab),
};

const view = (key: TabId | 'dashboard') => {
  const load = VIEW_LOADERS[key];
  return load ? { loadComponent: load } : { component: AreaPlaceholder };
};

const data = (value: ShellRouteData): ShellRouteData => value;
const isTab = (id: string): boolean => (TAB_IDS as readonly string[]).includes(id);

/** The children of `/w/:ws/s/:id`: the dashboard, one route per tab, area-name redirects, then not-found. */
export const SPEC_AREA_ROUTES: Routes = [
  { path: '', ...view('dashboard'), data: data({ area: 'dashboard' }) },
  ...TAB_IDS.map((tab) => ({ path: tab, ...view(tab), data: data({ area: areaOfTab(tab).id, tab }) })),
  // `live`, `data`, `docs` are not tab ids: the area name alone opens its first tab (`status` and `notes` are tabs).
  ...SPEC_AREAS.filter((area) => area.tabs.length > 0 && !isTab(area.id)).map((area) => ({
    path: area.id,
    redirectTo: area.tabs[0] ?? '',
    pathMatch: 'full' as const,
  })),
  { path: '**', component: NotFound, data: data({ notFound: true }) },
];
