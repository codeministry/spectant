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
  /** The tab opens a new group: the bar draws the prototype's `tab-sep` before it (spec 024, ISC-149). */
  readonly sep?: true;
  /** The tab has no content yet (a doc the spec does not have): the prototype's dimmed `muted-tab` (spec 024, ISC-149). */
  readonly muted?: true;
}

/** The tech page's tabs in tab-bar order (`/w/:ws/tech/<tab>`); `/w/:ws/tech` redirects to the first. */
export const TECH_TABS = ['overview', 'architecture', 'status', 'specs', 'open'] as const;
export type TechTabId = (typeof TECH_TABS)[number];

export const isTechTabId = (value: unknown): value is TechTabId => (TECH_TABS as readonly unknown[]).includes(value);

/** `['/w', ws, 'tech', tab]` as a router link. */
export const techLink = (ws: string, tab: TechTabId): string[] => ['/w', ws, 'tech', tab];

/** The figures a tech tab may carry (design.md: Status and Specs count specs, Open counts fog lines); the page fills them. */
export type TechTabCountValues = Partial<Record<TechTabId, number>>;

/** The first live tech tab: `tab-sep` parts the curated pages (Overview, Architecture) from the live ones (design.md). */
const TECH_LIVE_FIRST: TechTabId = 'status';

/**
 * The tech tabs of workspace `ws` with their label keys `tech.tabs.<id>`, links and the counts given (zero included);
 * Status opens the live group (`sep`).
 */
export function techTabs(ws: string, counts: TechTabCountValues = {}): PageTab[] {
  return TECH_TABS.map((id) => {
    const count = counts[id];
    const link: PageTab = { id, labelKey: `tech.tabs.${id}`, link: techLink(ws, id) };
    const tab: PageTab = id === TECH_LIVE_FIRST ? { ...link, sep: true } : link;
    return count === undefined ? tab : { ...tab, count: String(count) };
  });
}

/**
 * Where the tech page puts its tab counts for the tab bar (T14): the bar's slot reads the shell's route state, not the
 * page's inputs, so the figures travel through this one signal. Empty until the page sets it.
 */
@Injectable({ providedIn: 'root' })
export class TechTabCounts {
  readonly counts = signal<TechTabCountValues>({});
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
 * Viewport-übergreifend: the eyebrow LIBRARY and one tab with its count). The spec model carries no document count and
 * the catalog is the page's own read, so the figure travels through this signal as the tech page's did; the bar shows
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
