import { Injectable, signal } from '@angular/core';

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
