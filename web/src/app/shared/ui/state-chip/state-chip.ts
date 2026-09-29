import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiChip } from '../chip/chip';
import { UiGlyph } from '../glyph/glyph';
import { type GlyphFamily, type GlyphState, glyphFamily, glyphSpec, stateKey } from '../glyph/states';

/**
 * A state chip (ISC-88): the 14 px glyph, the state word as visible text (never tooltip-only) from `states.card.*` /
 * `states.claim.*`, tinted by the state's one tone. The same table drives the glyph, so glyph, word and colour can
 * never disagree.
 */
@Component({
  selector: 'ui-state-chip',
  imports: [TranslocoPipe, UiChip, UiGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-state]': 'state()',
    '[attr.data-family]': 'resolved()',
  },
  styles: `
    :host { display: inline-flex; min-inline-size: 0; }
  `,
  template: `
    <ui-chip [tone]="tone()">
      <ui-glyph [state]="state()" [family]="resolved()" [size]="14" />
      <span>{{ key() | transloco }}</span>
    </ui-chip>
  `,
})
export class UiStateChip {
  readonly state = input.required<GlyphState>();
  /** Needed only for `closed`, the one word of both families. */
  readonly family = input<GlyphFamily>();

  protected readonly resolved = computed(() => glyphFamily(this.state(), this.family()));
  protected readonly tone = computed(() => glyphSpec(this.state(), this.resolved()).tone);
  protected readonly key = computed(() => stateKey(this.state(), this.resolved()));
}
