import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { UiCard } from '../card/card';

let nextId = 0;

/**
 * One flat tile of the lists "Waits on you" and "Working" (spec 064, ISC-464; design.md § Across viewports), the one
 * shape both lists share on `/` and `/w/<ws>`. The tile is an unpadded `ui-card` without edge, side, glow or accent,
 * with a fixed block size and the grid `16px auto minmax(0, 1fr) auto` (mark | id | main | end), column gap 8,
 * padding-inline 12. Its density follows the width of the list that holds it, never the shell tier: the list is the
 * container `tiles` (`container: tiles / inline-size`, the partial `_tiles.css` beside this file), and
 *
 * - `stacked` (the default, list < `TILE_DENSITY_MIN`): 72 px (`TILE_HEIGHT_STACKED`), two rows of 24 and 28 px; row 1
 *   mark, id and main, row 2 the aside from the id column and the meta at the end;
 * - `line` (`@container tiles (min-width: 560px)`): 48 px (`TILE_HEIGHT_LINE`), one row; aside and meta share the end
 *   column.
 *
 * Content slots (projected by attribute):
 *
 * - `[tileMark]`: the 16 px mark (`ui-glyph`, `ui-agent-dot`); the caller hides it from assistive tech;
 * - `[tileId]`: the id text inside the link, mono 13/20 600 tabular-nums in `--disp-ink`, at least 3ch wide;
 * - `[tileMain]`: the main text (the spec title), one line, cut with an ellipsis; underlined while the tile is hovered;
 * - `[tileAside]`: a copy chip or the agent; it stands above the stretched link (`position: relative; z-index: 1`),
 *   so a button there is never inside the link and takes its own clicks;
 * - `[tileMeta]`: a short note such as "waiting 2 d", right-aligned.
 *
 * Inputs:
 *
 * - `link` (required): the router commands or URL of the tile's one link, an `<a>` around the id whose `::after`
 *   spans the tile (`inset: 0`), so the whole tile is the target;
 * - `fragment`: the fragment that link lands on;
 * - `name` (required): the link's accessible name (`aria-label`); the caller builds it from its catalogue;
 * - `description`: a sentence rendered visually hidden and referenced by the link's `aria-describedby`;
 * - `hint`: the link's `title`.
 *
 * The focus ring sits on the tile (`:has(a:focus-visible)`), never on the id alone; no motion, no shadow at rest.
 * Under forced colors the border is `CanvasText` and the id `LinkText`.
 */
@Component({
  selector: 'ui-flat-tile',
  imports: [RouterLink, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './flat-tile.css',
  templateUrl: './flat-tile.html',
})
export class UiFlatTile {
  /** Router commands (`['/w', ws, 's', id]`) or a URL string. */
  readonly link = input.required<string | readonly unknown[]>();
  readonly fragment = input<string>();
  /** The link's accessible name. */
  readonly name = input.required<string>();
  /** Visually hidden, referenced by the link's `aria-describedby`; none, no reference. */
  readonly description = input<string>();
  /** The link's `title`; none, no attribute. */
  readonly hint = input<string>();

  protected readonly descriptionId = `flat-tile-desc-${++nextId}`;
}
