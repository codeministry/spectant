import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import type { DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { guidanceEntryOf } from '../../../core/model/guidance-entry';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiGlyph } from '../../../shared/ui/glyph/glyph';
import { UiClamp } from '../../../shared/ui/clamp/clamp';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiIdChip } from '../../../shared/ui/id-chip/id-chip';
import { UiReason } from '../../../shared/ui/reason/reason';

/**
 * One Next up entry, ported from the prototype (`app.js` nextCard / wsColumn, `styles.css` `.next-card` l.356-358,
 * `.next-row` l.480-481): a next-row inside the list's card — the cyan left edge, the ID in a 36 px column beside the
 * one-line title and its toggle, the compact reason line below it. The phrase is the dashboard row's (ISC-122.3).
 */
@Component({
  selector: 'app-next-up-entry',
  imports: [GuidanceReasonPipe, RouterLink, TranslocoPipe, UiClamp, UiCommandChip, UiGlyph, UiIdChip, UiReason],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-next-entry]': 'row().id' },
  styleUrl: './next-up-entry.css',
  templateUrl: './next-up-entry.html',
})
export class NextUpEntry {
  readonly row = input.required<DashboardSpecRow>();
  /** `DashboardModel.guidance` (spec 020): the spec's own entry turns the phrase into its sentence (ISC-237.1). */
  readonly guidance = input<Guidance | undefined>(undefined);
  /** The `guidance.next` entry this row stands for (spec 020, T25): its sentence and command replace the row's phrase. */
  readonly entry = input<GuidanceEntry | null>(null);

  protected readonly entryReason = computed(() => guidanceEntryOf(this.guidance(), this.row().id)?.reason ?? null);

  /** The title shows in full: the "more…" / "less" button outside the title link (ISC-111.1). */
  protected readonly open = signal(false);
  protected readonly titleId = computed(() => `next-title-${this.row().id}`);
  /**
   * Spec 021 (T31, ISC-248): the toggle's accessible name starts with its visible "More…" / "Less" and then names the
   * entry ("More… 032 <title>", label in name, WCAG 2.5.3), so two entries' toggles never share a name.
   */
  protected readonly entryName = computed(() => `${this.row().id} ${this.row().title}`);

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}
