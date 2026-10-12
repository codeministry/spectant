import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toneInk } from '../tone';
import { type GlyphFamily, type GlyphState, glyphFamily, glyphSpec } from './states';

/**
 * A state glyph (ISC-88): one inline SVG shape per state of the seventeen in `states.ts`, stroked and filled in the
 * state tone's ink (4.5:1 on the card, so the mark clears the 3:1 a graphic needs; ISC-65). Without `size` it is the
 * prototype's `.glyph` (spec 024, ISC-148): an 18 × 20 px inline grid at 15 px, the icon
 * 14 px and centred; `size` 20 (board cards) or 14 (a matrix cell, the state chip) draws a bare icon of that size.
 * `absent` is the dashed cell. Decorative by contract: the host is `aria-hidden` and the state word
 * comes from `ui-state-chip` or the consumer's accessible name. Knockouts (the check on a filled disc) use the card
 * surface, so both themes follow.
 */
@Component({
  selector: 'ui-glyph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[attr.data-family]': 'family_()',
    '[attr.data-shape]': 'spec().shape',
    '[attr.data-tone]': 'spec().tone',
    '[attr.data-size]': 'size() ?? null',
    '[style.--glyph-color]': 'color()',
  },
  styles: `
    :host { display: inline-grid; flex: none; place-items: center; min-inline-size: 0; inline-size: 18px; block-size: 20px; color: var(--glyph-color); font-size: 15px; }
    :host([data-size]) { display: inline-flex; inline-size: auto; block-size: auto; line-height: 0; }
    svg { fill: none; stroke: currentcolor; stroke-width: 1.5; stroke-linecap: round; stroke-linejoin: round; }
    .fill { fill: currentcolor; stroke: none; }
    .ko { stroke: var(--color-base-100); }
    @media (forced-colors: active) {
      :host { color: CanvasText; }
      .ko { stroke: Canvas; }
    }
  `,
  template: `
    <svg data-icon-exempt viewBox="0 0 16 16" [attr.width]="px()" [attr.height]="px()" [attr.data-state]="state()" focusable="false">
      @switch (spec().shape) {
        @case ('dotted-ring') { <circle cx="8" cy="8" r="5.5" stroke-dasharray="1.5 2.2" /> }
        @case ('ring-dot') { <circle cx="8" cy="8" r="5.5" /><circle class="fill" cx="8" cy="8" r="2" /> }
        @case ('half') { <circle cx="8" cy="8" r="5.5" /><path class="fill" d="M8 2.5a5.5 5.5 0 0 1 0 11z" /> }
        @case ('diamond') { <path d="M8 1.8 14.2 8 8 14.2 1.8 8z" /><circle class="fill" cx="8" cy="8" r="1.3" /> }
        @case ('triangle') { <path d="M8 2.2 14.3 13.5H1.7z" /><path d="M8 6.5v3" /> }
        @case ('disc-cross') { <circle class="fill" cx="8" cy="8" r="6.5" /><path class="ko" d="m5.6 5.6 4.8 4.8m0-4.8-4.8 4.8" /> }
        @case ('ring-check') { <circle cx="8" cy="8" r="5.5" /><path d="m5.5 8.2 1.8 1.8 3.2-3.7" /> }
        @case ('disc-check') { <circle class="fill" cx="8" cy="8" r="6.5" /><path class="ko" d="m5.3 8.2 1.9 1.9 3.5-4" /> }
        @case ('dashed-square') { <rect x="2" y="2" width="12" height="12" rx="2" stroke-dasharray="2 2" /> }
        @case ('square') { <rect x="2.5" y="2.5" width="11" height="11" rx="2" /> }
        @case ('square-check') { <rect class="fill" x="2" y="2" width="12" height="12" rx="2.5" /><path class="ko" d="m5.3 8.2 1.9 1.9 3.5-4" /> }
        @case ('ring') { <circle cx="8" cy="8" r="5.5" /> }
        @case ('ring-plus') { <circle cx="8" cy="8" r="5.5" /><path d="M8 5.5v5M5.5 8h5" /> }
        @case ('lock') { <rect class="fill" x="3" y="7" width="10" height="7.5" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /> }
        @case ('ring-slash') { <circle cx="8" cy="8" r="5.5" /><path d="m4.1 11.9 7.8-7.8" /> }
        @case ('disc') { <circle class="fill" cx="8" cy="8" r="6.5" /> }
        @case ('ring-minus') { <circle cx="8" cy="8" r="5.5" /><path d="M5.5 8h5" /> }
      }
    </svg>
  `,
})
export class UiGlyph {
  readonly state = input.required<GlyphState>();
  /** Needed only for `closed`, the one word of both families; every other state infers it. */
  readonly family = input<GlyphFamily>();
  /** Unset: the prototype glyph (18 px box, 14 px icon); 20 or 14: a bare icon of that size. */
  readonly size = input<14 | 20>();

  protected readonly px = computed(() => this.size() ?? 14);

  protected readonly family_ = computed(() => glyphFamily(this.state(), this.family()));
  protected readonly spec = computed(() => glyphSpec(this.state(), this.family_()));
  /** A neutral glyph draws in `--muted-ink` like the prototype's `.glyph` (5.03:1 on the card); the rest in their tone's ink. */
  protected readonly color = computed(() => {
    const tone = this.spec().ink ?? this.spec().tone;
    return tone === 'neutral' ? 'var(--muted-ink)' : toneInk(tone);
  });
}
