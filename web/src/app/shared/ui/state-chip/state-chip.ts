import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiChip } from '../chip/chip';
import { UiGlyph } from '../glyph/glyph';
import { type GlyphFamily, type GlyphState, glyphFamily, glyphSpec, stateKey } from '../glyph/states';

/**
 * A state chip (ISC-88): the 14 px glyph, the state word as visible text (never tooltip-only) from `states.card.*`,
 * `states.claim.*` or `states.item.*` (spec 040), tinted by the state's one tone. The same table drives the glyph, so
 * glyph, word and colour can never disagree; `aborted` is the warning chip on `--hover-t`.
 *
 * `small`: the board card's form (the prototype's `.schip`): the word alone in the 10 px `small` chip, since the card
 * already leads with the state's glyph; it never wraps and ends in an ellipsis when the card header runs out of room.
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
    :host { display: inline-flex; min-inline-size: 0; max-inline-size: 100%; }
  `,
  template: `
    <ui-chip [tone]="tone()" [variant]="small() ? 'small' : 'status'">
      @if (!small()) {
        <ui-glyph [state]="state()" [family]="resolved()" [size]="14" />
      }
      <span>{{ key() | transloco }}</span>
    </ui-chip>
  `,
})
export class UiStateChip {
  readonly state = input.required<GlyphState>();
  /** Needed for a word of two families (`closed`; `open`, `waiting`, `running`, `done` of the item family). */
  readonly family = input<GlyphFamily>();
  /** The board card's one-line form (see above). */
  readonly small = input(false, { transform: booleanAttribute });

  protected readonly resolved = computed(() => glyphFamily(this.state(), this.family()));
  protected readonly tone = computed(() => glyphSpec(this.state(), this.resolved()).tone);
  protected readonly key = computed(() => stateKey(this.state(), this.resolved()));
}
