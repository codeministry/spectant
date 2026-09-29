/** The shell's container tiers (web/CLAUDE.md § Design system, design.md): compact < 640, medium < 1120, else wide. */
export type Tier = 'compact' | 'medium' | 'wide';

export const TIER_MEDIUM_MIN = 640;
export const TIER_WIDE_MIN = 1120;

/** The tier of a shell container `width` px wide; the CSS repeats the same numbers in its `@container` queries. */
export const tierFor = (width: number): Tier =>
  width < TIER_MEDIUM_MIN ? 'compact' : width < TIER_WIDE_MIN ? 'medium' : 'wide';
