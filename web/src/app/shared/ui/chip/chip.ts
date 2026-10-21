import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { type Tone, toneInk, toneMark, toneTint } from '../tone';

export type ChipVariant = 'status' | 'small' | 'plain' | 'mono' | 'take' | 'pill' | 'count' | 'demo';

/** The demo chip's yellow (design.md § Across viewports): the app's `--conc-*` tokens. */
const DEMO_COLORS = { color: 'var(--conc)', tint: 'var(--conc-t)', ink: 'var(--conc-text)' } as const;

/**
 * The chip family (spec 024 design.md § Fundament; ISC-148):
 * a tinted background, ink text (the tone's `--*-ink`, ISC-65), an optional 12 px icon (`chipIcon()` reads the
 * `CHIP_ICON` map) and an optional accent dot. The variants:
 *
 * - `status` (default): 22 px, radius 6, 0 8 px, 11/600 upper case at .06em (stage, state, "stale");
 * - `small`: the board card's state chip (`.schip`): 10/16 at 700, .05em, upper case, `1px 6px`, radius 4, one line that
 *   ends in an ellipsis inside a narrow card header instead of wrapping;
 * - `plain`: the same box at 12/500, no upper case (the type chip "feature");
 * - `mono`: mono, no upper case (an ID or a key inside a chip row);
 * - `take`: mono 500 12/1, no upper case (the "take ISC-334" chip, lime with `hand`);
 * - `pill`: 28 px, radius 999, 0 10 px, 12/600 ("2 notes" with `file-text`);
 * - `count`: the 22 px round counter (`.count-badge`), at least 22 wide, 0 6 px, 12/400;
 * - `demo` (ISC-149.1, design.md § Across viewports): the mark of a mocked block, the `plain` box on the yellow
 *   tint (`--conc-t` / `--conc-text`) with `flask-conical`, the
 *   lower-case word `demo.chip` and the accessible description `demo.description` as visually hidden text; it ignores
 *   `tone`, `icon` and projected content, and its host carries `data-demo-chip`, the one selector for every width.
 */
@Component({
  selector: 'ui-chip',
  imports: [TranslocoPipe, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-tone]': 'tone()',
    '[attr.data-variant]': 'variant()',
    '[attr.data-demo-chip]': 'demo() ? "" : null',
    '[style.--chip-color]': 'colors().color',
    '[style.--chip-tint]': 'colors().tint',
    '[style.--chip-ink]': 'colors().ink',
  },
  styleUrl: './chip.css',
  templateUrl: './chip.html',
})
export class UiChip {
  readonly tone = input<Tone>('neutral');
  readonly dot = input(false);
  readonly variant = input<ChipVariant>('status');
  /** The 12 px icon in front of the word; `chipIcon()` gives the one for a type, stage or state. */
  readonly icon = input<IconName>();

  protected readonly demo = computed(() => this.variant() === 'demo');

  protected readonly colors = computed(() => {
    if (this.demo()) return DEMO_COLORS;
    const tone = this.tone();
    return { color: toneMark(tone), tint: toneTint(tone), ink: toneInk(tone) };
  });
}
