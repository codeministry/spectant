import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { WS_ACCENT_TOKENS, type WsAccent, wsAccent, wsLocalImage, wsPattern } from './ws-identity';

/** `card`: the 16:5 cover on a workspace card; `thumb`: the 16:10 preview of a settings row (spec 016 T18). */
export type WsCoverShape = 'card' | 'thumb';

/**
 * The workspace cover: a 16:5 card on the accent's 12 %
 * tint with a 3 px top edge in the accent, holding the screenshot (top left, cover fit) or, without one, the name
 * pattern: an open arc in the accent and a violet dot, placed from the name hash. The badge stands beside the name,
 * never on the cover. Display only; the caller decides whether the image is a mock and marks it so. The image is a
 * same-origin path only (`wsLocalImage`): a bundled asset or the loopback image route with its cache-bust (spec 016
 * T18); a remote URL falls back to the pattern. `shape="thumb"` is the 16:10 preview a settings row sizes.
 */
@Component({
  selector: 'ui-ws-cover',
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

  protected readonly tokens = computed(() => WS_ACCENT_TOKENS[this.accent() ?? wsAccent(this.name())]);
  protected readonly src = computed(() => wsLocalImage(this.image()));
  protected readonly pattern = computed(() => wsPattern(this.name()));
}
