import type { ClaimGlyphState } from '../../../../../core/src/files';
import type { PaletteEntry } from '../../core/palette-sources';

/**
 * An entry that acts instead of navigating (copy a command, switch the theme, open a service): the palette closes and
 * calls `run`. `link` still names the page it concerns. A structural extension of `PaletteEntry`, so the shared seam
 * (`core/palette-sources.ts`) stays as it is.
 */
export interface PaletteCommandEntry extends PaletteEntry {
  readonly run: () => void;
  /** The action drives a `DemoData` mock (spec 024): the row carries the demo chip. */
  readonly demo?: true;
}

export const isCommand = (entry: PaletteEntry): entry is PaletteCommandEntry =>
  typeof (entry as Partial<PaletteCommandEntry>).run === 'function';

/**
 * A claim hit (019 T4 · ISC-139): the palette draws its status as a dot in the claim glyph's tone plus the state word
 * (`palette.claimStates.*`), and names the option with `palette.claimHit` and that word.
 */
export interface PaletteClaimEntry extends PaletteEntry {
  readonly claim: {
    readonly status: ClaimGlyphState;
    readonly statusWord: string;
    /** The dot's colour, a `var()` of the theme (the claim glyph's tone, `toneMark`). */
    readonly dot: string;
    readonly accessibleName: string;
  };
}

export const isClaim = (entry: PaletteEntry): entry is PaletteClaimEntry =>
  typeof (entry as Partial<PaletteClaimEntry>).claim === 'object';

/** Before Next up (20): Recent shows only without a query and Claims only with one, so Claims never sits under it. */
export const CLAIMS_ORDER = 15;

/** After Next up (20), before Workspaces (30). */
export const PAGES_ORDER = 25;

/** A spec of the Specs group: its phase as the prototype's chip (`.chip.building` / `.chip.scoping`). */
export interface PaletteSpecEntry extends PaletteEntry {
  readonly phase: string;
  readonly phaseLabel: string;
}

export const hasPhase = (entry: PaletteEntry): entry is PaletteSpecEntry => typeof (entry as Partial<PaletteSpecEntry>).phase === 'string';

/**
 * An idea of the open workspace (spec 008, ISC-124.2): the palette draws its chip in the idea chip's look (`lightbulb`,
 * dashed, the slug in mono). Not `ui-idea-chip` itself, which is a link: an option holds no control.
 */
export interface PaletteIdeaEntry extends PaletteEntry {
  readonly idea: true;
}

export const isIdea = (entry: PaletteEntry): entry is PaletteIdeaEntry => (entry as Partial<PaletteIdeaEntry>).idea === true;

/** Between Specs (40) and Features (50). */
export const IDEAS_ORDER = 45;
