import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { UiWsBadge } from './ws-badge';
import { WS_ACCENT_TOKENS, type WsAccent, wsAccent, wsLocalImage, wsPattern } from './ws-identity';

/**
 * `card`: the 16:5 cover on a workspace card; `thumb`: the 16:10 preview of a settings row (spec 016 T18); `tile`: the
 * preview of an overview tile (spec 066), as tall as the tile's `--tile-preview` track with or without a screenshot.
 */
export type WsCoverShape = 'card' | 'thumb' | 'tile';

/**
 * The workspace cover: a 16:5 card on the accent's 12 %
 * tint with a 3 px top edge in the accent, holding the screenshot (top left, cover fit) or, without one, the name
 * pattern: an open arc in the accent and a violet dot, placed from the name hash. The badge stands beside the name,
 * never on the cover. Display only; the caller decides whether the image is a mock and marks it so. The image is a
 * same-origin path only (`wsLocalImage`): a bundled asset or the loopback image route with its cache-bust (spec 016
 * T18); a remote URL falls back to the pattern. `shape="thumb"` is the 16:10 preview a settings row sizes.
 * `shape="tile"` is borderless (the tile draws the hairlines) and, without a screenshot, shows the neutral placeholder
 * `[data-cover-placeholder]`: the badge at 32 px in the neutral tone, its `logo` if set, else the monogram.
 */
@Component({
  selector: 'ui-ws-cover',
  imports: [UiWsBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ws-cover',
    '[style.--ws]': 'tokens().mark',
    '[attr.data-shape]': 'shape()',
  },
  styleUrl: './ws-cover.css',
  templateUrl: './ws-cover.html',
})
export class UiWsCover {
  readonly name = input.required<string>();
  readonly accent = input<WsAccent | null>(null);
  /** A bundled screenshot path or the loopback image route, `null` for the name pattern; a remote URL is refused. */
  readonly image = input<string | null>(null);
  readonly shape = input<WsCoverShape>('card');
  /** The screenshot's alternative text (the caller translates it). */
  readonly alt = input('');
  /** The badge's logo in the `tile` placeholder; same-origin only, like `image`. */
  readonly logo = input<string | null>(null);
  /** The badge's initials in the `tile` placeholder instead of the derived ones. */
  readonly monogram = input<string | null>(null);

  protected readonly tokens = computed(() => WS_ACCENT_TOKENS[this.accent() ?? wsAccent(this.name())]);
  protected readonly src = computed(() => wsLocalImage(this.image()));
  protected readonly pattern = computed(() => wsPattern(this.name()));
}
