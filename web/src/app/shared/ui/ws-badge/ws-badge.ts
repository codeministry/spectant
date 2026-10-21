import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { WS_ACCENT_TOKENS, type WsAccent, wsAccent, wsLocalImage, wsMonogram } from './ws-identity';

export type WsBadgeSize = 'sm' | 'md' | 'page' | 'lg';

/**
 * The workspace badge: the monogram, or a logo, on the
 * accent tint with a 45 % ring, Sora 700. Sizes: `sm` 18 px, `md` 22 px (the default), `page` 24 px beside an h1,
 * `lg` 30 px in a ws-head. With nothing but `name` it renders core's data: the initials of the workspace name on the
 * accent its hash picks, so it is no mock; a caller that passes a fixture's `logo` or `accent` owns the demo mark.
 * The logo is a same-origin path only (`wsLocalImage`): a bundled asset or the loopback image route with its
 * cache-bust (spec 016 T18); a remote URL falls back to the initials.
 * Decorative: the name always stands beside it.
 */
@Component({
  selector: 'ui-ws-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ws-badge',
    'aria-hidden': 'true',
    '[attr.data-size]': 'size()',
    '[attr.data-logo]': 'src() ? "" : null',
    '[style.--ws]': 'tokens().mark',
    '[style.--ws-ink]': 'tokens().ink',
  },
  styleUrl: './ws-badge.css',
  templateUrl: './ws-badge.html',
})
export class UiWsBadge {
  /** The workspace name; the initials and the default accent derive from it. */
  readonly name = input.required<string>();
  /** Initials to show instead of the derived ones (a fixture's `monogram`). */
  readonly monogram = input<string | null>(null);
  readonly accent = input<WsAccent | null>(null);
  /** A bundled image path or the loopback image route; a remote URL is refused. */
  readonly logo = input<string | null>(null);
  readonly size = input<WsBadgeSize>('md');

  protected readonly src = computed(() => wsLocalImage(this.logo()));
  protected readonly initials = computed(() => this.monogram() ?? wsMonogram(this.name()));
  protected readonly tokens = computed(() => WS_ACCENT_TOKENS[this.accent() ?? wsAccent(this.name())]);
}
