import { booleanAttribute, ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { type Tone, toneColor } from '../tone';

/** `undefined` stays undefined (not given), anything else reads as a boolean attribute (`<ui-card edge>`). */
const optionalFlag = (value: boolean | string | undefined): boolean | undefined =>
  value === undefined ? undefined : booleanAttribute(value);

/**
 * The inherited card anatomy (design.md): 12 px radius, 1 px `--line` border, card surface, and two
 * variants (master decision 2026-09-29: top edge yes, glow yes):
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
 *
 * Spec 008 adds two variants for the board card (design 008 § board card), neither a glow nor a tint:
 *
 * - `side`: a 4 px inline-start edge in `--edge` (the card's border there, so it takes the radius), `--line` when no
 *   `--edge` is set;
 * - `dashed`: the whole border dashed, the side edge included (a story, which has no spec folder yet).
 */
@Component({
  selector: 'ui-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-edge]': 'showEdge() ? "" : null',
    '[attr.data-glow]': 'showGlow() ? "" : null',
    '[attr.data-interactive]': 'interactive() ? "" : null',
    '[attr.data-side]': 'side() ? "" : null',
    '[attr.data-dashed]': 'dashed() ? "" : null',
    '[attr.data-accent]': 'accent() ?? null',
    '[style.--card-tone]': 'tone()',
    '[style.padding.px]': 'padding()',
  },
  styleUrl: './card.css',
  templateUrl: './card.html',
})
export class UiCard {
  readonly accent = input<Tone>();
  readonly edge = input(undefined, { transform: optionalFlag });
  readonly glow = input(undefined, { transform: optionalFlag });
  /** 12 is the board card's (design 008 § board card); the others are the inherited cards'. */
  readonly padding = input<0 | 12 | 16 | 24>(16);
  readonly interactive = input(false);
  /** The 4 px inline-start edge in `--edge` (spec 008, the board card's wait class). */
  readonly side = input(false, { transform: booleanAttribute });
  /** The whole border dashed (spec 008, a story's card). */
  readonly dashed = input(false, { transform: booleanAttribute });

  protected readonly tone = computed(() => {
    const accent = this.accent();
    return accent ? toneColor(accent) : null;
  });
  protected readonly showEdge = computed(() => this.edge() ?? this.accent() !== undefined);
  protected readonly showGlow = computed(() => this.glow() ?? this.accent() !== undefined);
}
