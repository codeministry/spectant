import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UiAgentDot } from '../../shared/ui/agent-dot/agent-dot';
import { UiFlatTile } from '../../shared/ui/guidance/flat-tile';
import { TILE_HEIGHT_LINE, TILE_HEIGHT_STACKED } from '../../shared/ui/guidance/tiles';
import { UiCommandChip, UiGlyph } from '../../shared/ui';

/** One list width the section renders: a container below or above `TILE_DENSITY_MIN`. */
interface TileDensity {
  readonly key: 'stacked' | 'line';
  readonly width: number;
  readonly height: number;
}

/**
 * The flat tiles (spec 064, T11) as the section `[data-gallery="flat-tiles"]` of `/__ui`: `ui-flat-tile` in both
 * densities, each with a "Waits on you" tile (glyph, id, title, copy chip, waiting time) and a "Working" tile (agent dot,
 * id, title, agent), inside a `tiles` container of 360 px (stacked, 72 px) and of 700 px (line, 48 px); and
 * `ui-agent-dot` with and without its label. The dot's ring stands still under reduced motion like everywhere else.
 * Dev-only strings.
 */
@Component({
  selector: 'app-tiles-gallery',
  imports: [UiAgentDot, UiCommandChip, UiFlatTile, UiGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tiles-gallery.html',
  styleUrl: './tiles-gallery.css',
})
export class TilesGallery {
  protected readonly densities: readonly TileDensity[] = [
    { key: 'stacked', width: 360, height: TILE_HEIGHT_STACKED },
    { key: 'line', width: 700, height: TILE_HEIGHT_LINE },
  ];
}
