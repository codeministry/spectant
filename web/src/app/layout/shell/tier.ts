/** The shell's container tiers (web/CLAUDE.md § Design system, design.md): compact < 640, medium < 1120, else wide. */
export type Tier = 'compact' | 'medium' | 'wide';

export const TIER_MEDIUM_MIN = 640;
export const TIER_WIDE_MIN = 1120;
/**
 * The narrowest shell container the detail sidebar docks in (spec 067, design.md § Desktop): beside the 480 px rail
 * column, its 32 px gap and the 64 px padding the main column keeps 704 px. Between `TIER_WIDE_MIN` and this width a
 * docking page's selection floats. Not a tier: nothing but the sidebar's presentation and the rail column read it.
 */
export const DOCK_MIN = 1280;

/** The tier of a shell container `width` px wide; the CSS repeats the same numbers in its `@container` queries. */
export const tierFor = (width: number): Tier =>
  width < TIER_MEDIUM_MIN ? 'compact' : width < TIER_WIDE_MIN ? 'medium' : 'wide';
