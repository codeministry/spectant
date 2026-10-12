import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import { UiIcon } from '../../icons/icon';
import { UiClamp } from '../clamp/clamp';
import { UiCommandChip } from '../command-chip/command-chip';

/**
 * Why a spec waits (DS-APP-26, ISC-122.3): the hourglass, the stage table's phrase exactly as core delivers it
 * (`SpecHead.nextReason`, read through `reasonOf`) and, when there is one, the next command as a `ui-command-chip`.
 * The same component sits on the dashboard row, the status block, the board card and Next up, so the phrase reads
 * the same everywhere. A long phrase is clamped at a whole word (`uiClamp`: two lines, one when `compact`), never
 * rewritten; the full phrase stays in the accessible text. The ink is `--reason-ink`, so a board card can set its
 * edge tone; it falls back to `--hover-ink`.
 */
@Component({
  selector: 'ui-reason',
  imports: [TranslocoPipe, UiClamp, UiCommandChip, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-compact]': 'compact() && !block() ? "" : null', '[attr.data-block]': 'block() ? "" : null' },
  styles: `
    :host { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: flex-start; min-inline-size: 0; }
    /* Compact keeps one line while the chip fits beside the phrase; in a narrow board card the chip wraps under the
       phrase instead of squeezing it to a column of letters (found in the T157 baselines). */
    :host([data-compact]) { align-items: center; }
    .line { display: flex; flex: 1 1 16ch; gap: 6px; align-items: flex-start; min-inline-size: 0; color: var(--reason-ink, var(--hover-ink)); font-size: 13px; line-height: 20px; }
    :host([data-compact]) .line { align-items: center; }
    ui-icon { padding-block-start: 3px; }
    :host([data-compact]) ui-icon { padding-block-start: 0; }
    :host([data-block]) .line { flex-basis: 100%; font-size: 15px; line-height: 24px; }
    :host([data-block]) ui-icon { padding-block-start: 5px; }
    .phrase { display: block; flex: 1 1 auto; min-inline-size: 0; overflow-wrap: anywhere; }
    ui-command-chip { flex: none; }
    .visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    @media (forced-colors: active) {
      .line { color: CanvasText; }
    }
  `,
  template: `
    <span class="line">
      <ui-icon name="hourglass" [size]="14" [label]="'reason.glyph' | transloco" />
      @if (block()) {
        <span class="phrase">{{ phrase() }}</span>
      } @else {
        <span class="visually-hidden">{{ phrase() }}</span>
        <span
          class="phrase"
          aria-hidden="true"
          [uiClamp]="phrase()"
          [uiClampLines]="lines()"
          #clamp="uiClamp"
          [attr.title]="clamp.cut() ? phrase() : null"
        ></span>
      }
    </span>
    @if (command(); as cmd) {
      <ui-command-chip
        [command]="cmd"
        [copyLabel]="'common.copyCommand' | transloco"
        [copiedLabel]="'common.copied' | transloco: { command: cmd }"
        [manualHint]="'common.copyFallback' | transloco"
        (copied)="copied.emit($event)"
      />
    }
  `,
})
export class UiReason {
  /** The stage table's phrase as core delivers it (`nextReason`); shown as is, never rewritten. */
  readonly phrase = input.required<string>();
  /** The next command (`/spec-review 008`); null for no chip (close-pending, a refusal without a command). */
  readonly command = input<string | null>(null);
  /** One line: the row and card variant; otherwise two. */
  readonly compact = input(false);
  /**
   * The status block's variant (T132): the whole phrase in 15/24, wrapping and never clamped, read once as plain text,
   * the chip on its own line below. Wins over `compact`.
   */
  readonly block = input(false);
  /** Re-emits the chip's `copied`, for the page's live region. */
  readonly copied = output<string>();

  protected readonly lines = computed(() => (this.compact() ? 1 : 2));
}
