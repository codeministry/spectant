/**
 * The shared measures of the flat tile lists "Waits on you" and "Working" (spec 064, design.md § Across viewports),
 * kept in one place so both lists on the start `/` and the workspace dashboard `/w/<ws>` stay the same shape (ISC-464).
 * `ui-flat-tile` (`flat-tile.css`) and the list partial `_tiles.css` hold the same numbers as CSS literals, because a
 * stylesheet cannot import them; a change here changes them there too.
 */

/** How many tiles a list shows before its "Show all n" row; both lists, both pages. */
export const TILE_LIMIT = 3;

/** The fixed block size of a tile in the one-line density `line` (px), the list at least `TILE_DENSITY_MIN` wide. */
export const TILE_HEIGHT_LINE = 48;

/** The fixed block size of a tile in the two-row density `stacked` (px): 8 + 24 + 4 + 28 + 8, the default. */
export const TILE_HEIGHT_STACKED = 72;

/**
 * The inline size of the list container (`container: tiles / inline-size`, px) from which its tiles switch to the
 * one-line density `line`; below it they stand `stacked`. The density follows the list's width, never the shell tier.
 */
export const TILE_DENSITY_MIN = 560;
