import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { GuidanceReason } from '../../../../../../core/src/files';
import { UiIcon } from '../../icons/icon';
import { GuidanceReasonPipe } from '../guidance/guidance-reason.pipe';
import type { IconName } from '../../icons/icons';
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
  imports: [GuidanceReasonPipe, TranslocoPipe, UiClamp, UiCommandChip, UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-compact]': 'compact() && !block() ? "" : null', '[attr.data-block]': 'block() ? "" : null' },
  styleUrl: './reason.css',
  templateUrl: './reason.html',
})
export class UiReason {
  /** The stage table's phrase as core delivers it (`nextReason`); shown as is, never rewritten. */
  readonly phrase = input.required<string>();
  /**
   * The item's guidance reason (spec 020, ISC-237.1): when set, the catalogue sentence (`guidanceReason`) stands in for
   * the phrase, so the same item reads the same sentence on every surface; null keeps the phrase (no guidance entry).
   */
  readonly guidance = input<GuidanceReason | null>(null);
  /** The next command (`/spec review 008`); null for no chip (close-pending, a refusal without a command). */
  readonly command = input<string | null>(null);
  /** One line: the row and card variant; otherwise two. */
  /** The glyph before the phrase: the hourglass, or `circle-pause` on the Specs table's waiting row (spec 024). */
  readonly icon = input<IconName>('hourglass');
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
