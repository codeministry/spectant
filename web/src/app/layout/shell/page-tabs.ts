import { Injectable, signal } from '@angular/core';
import type { IconName } from '../../shared/icons/icons';

/**
 * One tab of `app-tab-bar` (spec 023, ISC-134.1, DS-APP-27): the bar renders the list it is given, so the spec page
 * (tabs from `SPEC_AREAS`) and a workspace page (its own registry) share one component.
 * `count` is the formatted figure the tab shows after its label; a tab without one shows none.
 */
export interface PageTab {
  readonly id: string;
  /** Transloco key of the tab's label. */
  readonly labelKey: string;
  /** The tab's route, as a router link. */
  readonly link: readonly string[];
  readonly count?: string;
  /** The tab opens a new group: the bar draws the prototype's `tab-sep` before it (spec 024, ISC-149). */
  readonly sep?: true;
  /** The tab has no content yet (a doc the spec does not have): the prototype's dimmed `muted-tab` (spec 024, ISC-149). */
  readonly muted?: true;
  /** An icon before the label (the planning lenses, spec 026). */
  readonly icon?: IconName;
  /** A switch keeps the query (`?sel=`, `?m=`): `queryParamsHandling: merge` (the planning lenses, spec 026). */
  readonly keepQuery?: true;
}

/** The figure of the spec area Library's one tab, Documents, and the spec it was counted for. */
export interface LibraryTabCountValue {
  readonly ws: string;
  /** The spec id of the route (`/w/:ws/s/:id/library`). */
  readonly spec: string;
  /** The documents the spec's Library lists: the spec's own, its missing entries and the constitution. */
  readonly count: number;
}

/**
 * Where the library page in spec scope puts the count of its one tab, Documents (spec 017, T45, ISC-158, design.md §
 * Across viewports: the eyebrow LIBRARY and one tab with its count). The spec model carries no document count and
 * the catalog is the page's own read, so the figure travels through this signal; the bar shows
 * it only for the spec it names, so a figure of the spec left behind never shows on the next one. Null until set.
 */
@Injectable({ providedIn: 'root' })
export class LibraryTabCount {
  readonly value = signal<LibraryTabCountValue | null>(null);

  /** The count for `ws` and `spec`, as the tab shows it; null while none was counted for exactly that spec. */
  countFor(ws: string, spec: string): string | null {
    const value = this.value();
    return value !== null && value.ws === ws && value.spec === spec ? String(value.count) : null;
  }
}

/**
 * The planning page's lenses in tab-bar order, Matrix first (spec 026, ISC-167; `/w/:ws/planning/<lens>`,
 * `/w/:ws/planning` opens the matrix). Tabs are route links that keep `?sel=` and `?m=` (`keepQuery`), labelled `planning.page.lenses.<id>`.
 */
export const PLANNING_LENSES = ['board', 'tree', 'graph'] as const;
export type PlanningLensId = (typeof PLANNING_LENSES)[number];

export const isPlanningLensId = (value: unknown): value is PlanningLensId => (PLANNING_LENSES as readonly unknown[]).includes(value);

const LENS_ICONS: Record<PlanningLensId, IconName> = { tree: 'list-tree', board: 'layout-grid', graph: 'share-2' };

/** `['/w', ws, 'planning', lens]` as a router link. */
export const planningLink = (ws: string, lens: PlanningLensId = 'board'): string[] => ['/w', ws, 'planning', lens];

/** The lens tabs of workspace `ws`, each with its icon, keeping the selection and milestone query on a switch. */
export const planningTabs = (ws: string): PageTab[] =>
  PLANNING_LENSES.map((id) => ({ id, labelKey: `planning.page.lenses.${id}`, link: planningLink(ws, id), icon: LENS_ICONS[id], keepQuery: true }));
