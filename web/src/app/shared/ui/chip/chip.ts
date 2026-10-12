import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { UiIcon } from '../../icons/icon';
import type { IconName } from '../../icons/icons';
import { type Tone, toneInk, toneMark, toneTint } from '../tone';

export type ChipVariant = 'status' | 'small' | 'plain' | 'mono' | 'take' | 'pill' | 'count';

/**
 * The prototype's chip family (spec 024 design.md § Fundament, `[data-ui="chip"]`, `.pill`, `.count-badge`; ISC-148):
 * a tinted background, ink text (the tone's `--*-ink`, ISC-65), an optional 12 px icon (`chipIcon()` holds the
 * prototype's `CHIP_ICON`) and an optional accent dot. The variants:
 *
 * - `status` (default): 22 px, radius 6, 0 8 px, 11/600 upper case at .06em (stage, state, "stale");
 * - `small`: the board card's state chip (`.schip`): 10/16 at 700, .05em, upper case, `1px 6px`, radius 4, one line that
 *   ends in an ellipsis inside a narrow card header instead of wrapping;
 * - `plain`: the same box at 12/500, no upper case (the type chip "feature");
 * - `mono`: mono, no upper case (an ID or a key inside a chip row);
 * - `take`: mono 500 12/1, no upper case (the "take ISC-334" chip, lime with `hand`);
 * - `pill`: 28 px, radius 999, 0 10 px, 12/600 ("2 notes" with `file-text`);
 * - `count`: the 22 px round counter (`.count-badge`), at least 22 wide, 0 6 px, 12/400.
 */
@Component({
  selector: 'ui-chip',
  imports: [UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-tone]': 'tone()',
    '[attr.data-variant]': 'variant()',
    '[style.--chip-color]': 'colors().color',
    '[style.--chip-tint]': 'colors().tint',
    '[style.--chip-ink]': 'colors().ink',
  },
  styles: `
    :host { display: inline-flex; gap: 6px; align-items: center; min-inline-size: 0; block-size: 22px; padding-inline: 8px; border-radius: var(--radius-sm); background: var(--chip-tint); color: var(--chip-ink); font-size: 11px; font-variant-numeric: tabular-nums; font-weight: 600; letter-spacing: 0.06em; line-height: 20px; text-transform: uppercase; white-space: nowrap; }
    :host([data-variant='small']) { display: inline-block; block-size: auto; max-inline-size: 100%; overflow: hidden; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; letter-spacing: 0.05em; line-height: 16px; text-overflow: ellipsis; }
    :host([data-variant='plain']) { font-size: 12px; font-weight: 500; letter-spacing: normal; text-transform: none; }
    :host([data-variant='mono']) { font-family: var(--font-mono); letter-spacing: normal; text-transform: none; }
    :host([data-variant='take']) { font-family: var(--font-mono); font-size: 12px; font-weight: 500; letter-spacing: normal; line-height: 12px; text-transform: none; }
    :host([data-variant='pill']) { block-size: 28px; padding-inline: 10px; border-radius: 999px; font-size: 12px; letter-spacing: normal; text-transform: none; }
    :host([data-variant='count']) { display: inline-grid; place-items: center; gap: normal; min-inline-size: 22px; padding-inline: 6px; border-radius: 999px; font-size: 12px; font-weight: 400; letter-spacing: normal; text-transform: none; }
    /* The icon sits on the chip's line (the icon host zeroes its own) and 1 px into the padding, as in the prototype. */
    ui-icon { margin-inline-start: -1px; line-height: inherit; }
    .dot { inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--chip-color); }
    @media (forced-colors: active) {
      :host { border: 1px solid CanvasText; }
      .dot { background: CanvasText; }
    }
  `,
  template: `
    @if (dot()) {
      <span class="dot" aria-hidden="true"></span>
    }
    @if (icon(); as name) {
      <ui-icon [name]="name" [size]="12" />
    }
    <ng-content />
  `,
})
export class UiChip {
  readonly tone = input<Tone>('neutral');
  readonly dot = input(false);
  readonly variant = input<ChipVariant>('status');
  /** The 12 px icon in front of the word; `chipIcon()` gives the prototype's for a type, stage or state. */
  readonly icon = input<IconName>();

  protected readonly colors = computed(() => {
    const tone = this.tone();
    return { color: toneMark(tone), tint: toneTint(tone), ink: toneInk(tone) };
  });
}
