import { InjectionToken, type Signal } from '@angular/core';

/**
 * One entry of a command-palette group (spec 001 plan.md § Stack Decisions "palette groups"): what the palette
 * shows and where Enter leads. `link` is a router link (`['/w', ws]`) or a URL string when the target carries a
 * fragment (`/w/harbor/features#F2`); `keywords` are what the filter matches beside the label.
 */
export interface PaletteEntry {
  readonly id: string;
  readonly label: string;
  /** A second, muted line: a count, a date, a stage. */
  readonly meta?: string;
  /** A short chip after the label: a mono id, a state word. */
  readonly chip?: string;
  readonly link: readonly string[] | string;
  readonly keywords: readonly string[];
}

/**
 * A group the palette renders, contributed through `PALETTE_SOURCES`. The palette (spec 001, T66) sorts groups by
 * `order` and drops a group whose `entries` signal is empty, so a source never has to know whether it applies: the
 * Milestones group of spec 003 is absent while no spec carries a milestone because its entries are.
 */
export interface PaletteSource {
  readonly id: string;
  /** Catalogue key of the group heading, `palette.groups.<id>`. */
  readonly labelKey: string;
  /** Recent 10 · Next up 20 · Workspaces 30 · Specs 40 · Features 50 · Milestones 55 · Services 60 · Actions 70 · Archived 80. */
  readonly order: number;
  readonly entries: Signal<readonly PaletteEntry[]>;
}

/**
 * Multi-provider token: every feature that adds a palette group provides one `PaletteSource` here with one line
 * (`{ provide: PALETTE_SOURCES, useFactory: …, multi: true }`), and never touches the palette's own files.
 */
export const PALETTE_SOURCES = new InjectionToken<readonly PaletteSource[]>('PALETTE_SOURCES');
