import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { RunState } from '../../../../../../../core/src/files';
import { UiChip } from '../../../../shared/ui/chip/chip';
import { UiGlyph } from '../../../../shared/ui/glyph/glyph';
import { glyphSpec, runGlyphState } from '../../../../shared/ui/glyph/states';

/**
 * A task's run chip (spec 027, ISC-179.1, design.md decision 3), on the live board's card and in the Tasks tab: the run
 * state's glyph from `CARD_GLYPHS` (`runGlyphState`) and its word from `states.run.*` as visible text, never a
 * tooltip, tinted by the glyph's one tone. `small` is the board card's one-line form, the word alone, since the card
 * already leads with the same glyph. A change cross-fades the tint through the motion tokens (none under reduced
 * motion); nothing pulses.
 */
@Component({
  selector: 'app-run-chip',
  imports: [TranslocoPipe, UiChip, UiGlyph],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-run]': 'run()' },
  styleUrl: './run-chip.css',
  templateUrl: './run-chip.html',
})
export class RunChip {
  readonly run = input.required<RunState>();
  readonly small = input(false, { transform: booleanAttribute });

  protected readonly glyph = computed(() => runGlyphState(this.run()));
  protected readonly tone = computed(() => glyphSpec(this.glyph(), 'card').tone);
}
