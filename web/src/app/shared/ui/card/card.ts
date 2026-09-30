import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type Tone, toneColor } from '../tone';

/** `undefined` stays undefined (not given), anything else reads as a boolean attribute (`<ui-card edge>`). */
const optionalFlag = (value: boolean | string | undefined): boolean | undefined =>
  value === undefined ? undefined : booleanAttribute(value);

/**
 * The inherited card anatomy (design.md): 12 px radius, 1 px `--line` border, card surface, and the prototype's two
 * variants (`styles.css:116-123`, master decision 2026-09-29 "Oberkante ja, Glow ja (wie im Prototyp)"):
 *
 * - `edge`: a 3 px top bar in `--edge`;
 * - `glow`: a 140 px corner glow, `--edge` at 14 % fading out, at .7 opacity and 1 on an `interactive` card's hover
 *   (under `(hover: hover)` only; the transition runs on the hover duration token, 0 ms under reduced motion).
 *
 * `--edge` defaults to cyan (`--color-primary`) and is set per use, either through `accent` (a tone) or as a custom
 * property on the element (`style="--edge: var(--color-accent)"`, which wins over `accent`). The tone goes through the
 * private `--card-tone` because a null host binding on `--edge` would clear the consumer's inline value. An `accent`
 * without `edge` or `glow` turns both on.
 * The glow sits behind the content (`z-index: -1` in the card's own stacking context), so text keeps its contrast.
 */
@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-edge]': 'showEdge() ? "" : null',
    '[attr.data-glow]': 'showGlow() ? "" : null',
    '[attr.data-interactive]': 'interactive() ? "" : null',
    '[attr.data-accent]': 'accent() ?? null',
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
    /* An accent tone becomes the edge colour; a --edge set inline on the element still wins. */
    :host([data-accent]) {
      --edge: var(--card-tone);
    }
    :host([data-edge])::before {
      content: '';
      position: absolute;
      inset: 0 0 auto;
      block-size: 3px;
      background: var(--edge, var(--color-primary));
      pointer-events: none;
    }
    :host([data-glow])::after {
      content: '';
      position: absolute;
      z-index: -1;
      inset: -40px -40px auto auto;
      inline-size: 140px;
      block-size: 140px;
      background: radial-gradient(closest-side, color-mix(in srgb, var(--edge, var(--color-primary)) 14%, transparent), transparent);
      opacity: 0.7;
      pointer-events: none;
      transition: opacity var(--motion-duration-instant) var(--motion-ease-standard);
    }
    @media (hover: hover) {
      :host([data-interactive]:hover)::after {
        opacity: 1;
      }
    }
    @media (forced-colors: active) {
      :host::before,
      :host::after {
        display: none;
      }
    }
  `,
  template: `<ng-content />`,
})
export class UiCard {
  readonly accent = input<Tone>();
  readonly edge = input(undefined, { transform: optionalFlag });
  readonly glow = input(undefined, { transform: optionalFlag });
  readonly padding = input<0 | 16 | 24>(16);
  readonly interactive = input(false);

  protected readonly tone = computed(() => {
    const accent = this.accent();
    return accent ? toneColor(accent) : null;
  });
  protected readonly showEdge = computed(() => this.edge() ?? this.accent() !== undefined);
  protected readonly showGlow = computed(() => this.glow() ?? this.accent() !== undefined);
}
