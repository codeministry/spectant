import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { WS_ACCENT_TOKENS, type WsAccent, wsAccent, wsPattern } from './ws-identity';

/**
 * The workspace cover (prototype `styles.css` `.ws-cover`, `identity.js` `cover`): a 16:5 card on the accent's 12 %
 * tint with a 3 px top edge in the accent, holding the screenshot (top left, cover fit) or, without one, the name
 * pattern: an open arc in the accent and a violet dot, placed from the name hash. The badge stands beside the name,
 * never on the cover. Display only; the caller decides whether the image is a mock and marks it so.
 */
@Component({
  selector: 'ui-ws-cover',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ws-cover',
    '[style.--ws]': 'tokens().mark',
  },
  styles: `
    :host { position: relative; display: block; overflow: hidden; aspect-ratio: 16 / 5; border: 1px solid var(--line); border-block-start: 3px solid var(--ws); border-radius: var(--radius-card); background: color-mix(in oklab, var(--ws) 12%, var(--color-base-100)); color: color-mix(in oklab, var(--ws) 70%, transparent); }
    img, svg { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; object-fit: cover; object-position: top left; }
    img { transition: transform var(--dur-sheet) var(--ease); }
    :host-context(a:hover) img { transform: scale(1.03); }
    @media (prefers-reduced-motion: reduce) {
      img { transition: none; }
    }
    @media (forced-colors: active) {
      :host { border-color: CanvasText; }
    }
  `,
  template: `
    @if (image(); as src) {
      <img [src]="src" [alt]="alt()" loading="lazy" />
    } @else {
      @let p = pattern();
      <!-- The name pattern, drawn from the hash; not an icon (data-icon-exempt, ISC-18.2). -->
      <svg viewBox="0 0 360 120" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" data-icon-exempt>
        <path [attr.d]="p.arc" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" />
        <circle [attr.cx]="p.dot.cx" [attr.cy]="p.dot.cy" r="7" fill="var(--color-secondary)" />
      </svg>
    }
  `,
})
export class UiWsCover {
  readonly name = input.required<string>();
  readonly accent = input<WsAccent | null>(null);
  /** A bundled screenshot path, `null` for the name pattern; never a remote URL. */
  readonly image = input<string | null>(null);
  /** The screenshot's alternative text (the caller translates it). */
  readonly alt = input('');

  protected readonly tokens = computed(() => WS_ACCENT_TOKENS[this.accent() ?? wsAccent(this.name())]);
  protected readonly pattern = computed(() => wsPattern(this.name()));
}
