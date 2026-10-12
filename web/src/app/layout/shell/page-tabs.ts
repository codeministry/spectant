import { Injectable, signal } from '@angular/core';

/**
 * One tab of `app-tab-bar` (spec 023, ISC-134.1, DS-APP-27): the bar renders the list it is given, so the spec page
 * (tabs from `SPEC_AREAS`) and a workspace page (its own registry, as the tech page's below) share one component.
 * `count` is the formatted figure the tab shows after its label; a tab without one shows none.
 */
export interface PageTab {
  readonly id: string;
  /** Transloco key of the tab's label. */
  readonly labelKey: string;
  /** The tab's route, as a router link. */
  readonly link: readonly string[];
  readonly count?: string;
}

/** The tech page's tabs in tab-bar order (`/w/:ws/tech/<tab>`); `/w/:ws/tech` redirects to the first. */
export const TECH_TABS = ['overview', 'architecture', 'status', 'specs', 'open'] as const;
export type TechTabId = (typeof TECH_TABS)[number];

export const isTechTabId = (value: unknown): value is TechTabId => (TECH_TABS as readonly unknown[]).includes(value);

/** `['/w', ws, 'tech', tab]` as a router link. */
export const techLink = (ws: string, tab: TechTabId): string[] => ['/w', ws, 'tech', tab];

/** The figures a tech tab may carry (design.md: Status and Specs count specs, Open counts fog lines); the page fills them. */
export type TechTabCountValues = Partial<Record<TechTabId, number>>;

/** The tech tabs of workspace `ws` with their label keys `tech.tabs.<id>`, links and the counts given (zero included). */
export function techTabs(ws: string, counts: TechTabCountValues = {}): PageTab[] {
  return TECH_TABS.map((id) => {
    const count = counts[id];
    const tab: PageTab = { id, labelKey: `tech.tabs.${id}`, link: techLink(ws, id) };
    return count === undefined ? tab : { ...tab, count: String(count) };
  });
}

/**
 * Where the tech page puts its tab counts for the tab bar (T14): the bar renders in the header slot at compact, outside
 * the page, so the figures travel through this one signal rather than an input. Empty until the page sets it.
 */
@Injectable({ providedIn: 'root' })
export class TechTabCounts {
  readonly counts = signal<TechTabCountValues>({});
}
