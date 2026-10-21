import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { toneInk } from '../tone';
import { type GlyphFamily, type GlyphState, glyphFamily, glyphSpec } from './states';

/**
 * A state glyph (ISC-88): one inline SVG shape per (shape, tone) pair in `states.ts` (the card, claim and item families), stroked and filled in the
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
  styleUrl: './glyph.css',
  templateUrl: './glyph.html',
})
export class UiGlyph {
  readonly state = input.required<GlyphState>();
  /** Needed for a word of two families (`closed`; `open`, `waiting`, `running`, `done` of the item family). */
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
