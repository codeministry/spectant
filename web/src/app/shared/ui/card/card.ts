import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type Tone, toneColor } from '../tone';

/**
 * The inherited card anatomy (design.md): 12 px radius, 1 px `--line` border, card surface. With `accent` it gains
 * the 3 px top edge and a decorative corner glow (a `::before` behind the content, 160 px, the accent at 14 %);
 * `interactive` raises the glow to 22 % on hover, under `(hover: hover)` only, and nothing lifts.
 */
@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-accent]': 'accent() ?? null',
    '[attr.data-interactive]': 'interactive() ? "" : null',
    '[style.--card-tone]': 'tone()',
    '[style.padding.px]': 'padding()',
  },
  styles: `
    :host {
      position: relative;
      isolation: isolate;
      display: block;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--radius-box);
      background: var(--color-base-100);
      color: var(--color-base-content);
    }
    :host([data-accent]) {
      box-shadow: inset 0 3px 0 var(--card-tone);
    }
    /* The glow is painted at 22 % and shown at .64 opacity (= 14 %), so hover animates opacity only. */
    :host([data-accent])::before {
      content: '';
      position: absolute;
      z-index: -1;
      inset-block-start: -80px;
      inset-inline-end: -80px;
      inline-size: 160px;
      block-size: 160px;
      border-radius: 50%;
      background: radial-gradient(closest-side, color-mix(in oklch, var(--card-tone) 22%, transparent), transparent);
      opacity: 0.64;
      pointer-events: none;
      transition: opacity var(--motion-duration-instant) var(--motion-ease-standard);
    }
    @media (hover: hover) {
      :host([data-interactive]:hover)::before {
        opacity: 1;
      }
    }
    @media (forced-colors: active) {
      :host([data-accent]) {
        box-shadow: none;
      }
      :host::before {
        display: none;
      }
    }
  `,
  template: `<ng-content />`,
})
export class UiCard {
  readonly accent = input<Tone>();
  readonly padding = input<0 | 16 | 24>(16);
  readonly interactive = input(false);

  protected readonly tone = computed(() => {
    const accent = this.accent();
    return accent ? toneColor(accent) : null;
  });
}
