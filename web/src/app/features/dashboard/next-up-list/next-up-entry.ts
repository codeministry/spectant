import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import type { DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { guidanceEntryOf } from '../../../shared/ui/guidance/guidance-entry';
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
  styles: `
    /* Spec 020 (T25): a row as wide as the 820 px dashboard keeps the chip right, top-aligned. */
    :host { display: block; min-inline-size: 0; container: next-entry / inline-size; }
    .title { display: block; overflow: hidden; overflow-wrap: anywhere; }
    .more { position: relative; justify-self: start; min-block-size: 24px; padding: 2px 0; border: 0; background: none; color: var(--ques-text); font-family: var(--font-mono); font-size: 13px; font-weight: 600; line-height: 20px; cursor: pointer; }
    /* The toggle on the title line, its 24 px box pulled to the 20 px line so the row stays 20 tall. */
    .next-row .more { grid-column: 3; grid-row: 1; margin-block: -2px; }
    @media (hover: hover) { .more:hover { text-decoration: underline; } }
    /* Spec 021 (T31): a 44 px hit area (WCAG 2.5.8) around the 24 px toggle under a coarse pointer, as ui-button and
       the worktree chip grow theirs: an invisible ::before, so the row keeps its height. */
    @media (pointer: coarse) { .more::before { position: absolute; inset: min(0px, (100% - 44px) / 2); content: ''; } }
    .text-link { border-radius: var(--radius-field); color: var(--color-base-content); text-decoration: none; }
    .text-link:hover { text-decoration: underline; text-underline-offset: 3px; }
    .next-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 4px 8px; align-items: baseline; padding: 8px 12px; border-inline-start: 3px solid var(--color-primary); }
    .next-row .text-link { min-inline-size: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
    .next-row .cmd { grid-column: 2 / -1; min-inline-size: 0; }
    /* Spec 020 (T25): the sentence in 13/20 over the chip, wrapping on whole words and never clamped; the ring of
       "open" in its own tone (secondary). */
    .guide { display: grid; gap: 8px; justify-items: start; align-items: start; min-inline-size: 0; }
    .sentence { display: flex; gap: 6px; align-items: flex-start; min-inline-size: 0; color: var(--color-base-content); font-size: 13px; line-height: 20px; overflow-wrap: break-word; }
    .sentence ui-glyph { padding-block-start: 3px; }
    @container next-entry (min-inline-size: 560px) {
      .guide { grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; }
    }
    @media (forced-colors: active) {
      .next-row { border-inline-start-color: CanvasText; }
    }
  `,
  template: `
    <div class="next-row" data-next-row>
      <ui-id-chip>{{ row().id }}</ui-id-chip>
      <a class="text-link" data-next-link [routerLink]="[]" [queryParams]="{ sel: 'spec:' + row().id }" queryParamsHandling="merge"
        ><span
          #rowTitle="uiClamp"
          class="title"
          [id]="titleId()"
          [title]="row().title"
          [uiClamp]="row().title"
          [uiClampLines]="1"
          [uiClampExpanded]="open()"
        ></span
      ></a>
      @if (rowTitle.overflows()) {
        <button
          type="button"
          class="more"
          data-next-more
          [attr.aria-expanded]="open()"
          [attr.aria-controls]="titleId()"
          [attr.aria-label]="(open() ? 'nextUp.lessName' : 'nextUp.moreName') | transloco: { entry: entryName() }"
          (click)="toggle()"
        >
          {{ (open() ? 'brief.less' : 'brief.more') | transloco }}
        </button>
      }
      <!-- The reason line (ISC-122.3): the same phrase and chip as the dashboard row; the bare chip without a phrase.
           With its guidance entry (spec 020, T25, ISC-240): the ring of "open", the whole sentence, never clamped, and
           the entry's command; no "Waits on you" mark, Next is not waiting on you. -->
      @if (entry(); as entry) {
        <div class="cmd">
          <div class="guide" data-next-reason data-next-guide>
            <span class="sentence"
              ><ui-glyph state="open" family="item" [size]="14" /><span data-next-sentence>{{ entry.reason | guidanceReason }}</span></span
            >
            @if (entry.command; as command) {
              <ui-command-chip
                [command]="command"
                [context]="'orientation.chipContext.nextUp' | transloco: { spec: row().id }"
                [copyLabel]="'common.copyCommand' | transloco"
                [copiedLabel]="'common.copied' | transloco: { command }"
                [manualHint]="'common.copyFallback' | transloco"
              />
            }
          </div>
        </div>
      } @else if (row().nextReason; as phrase) {
        <div class="cmd">
          <ui-reason class="reason" data-next-reason [phrase]="phrase" [guidance]="entryReason()" [command]="row().nextCommand" [compact]="true" />
        </div>
      } @else if (row().nextCommand; as command) {
        <div class="cmd">
          <ui-command-chip
            [command]="command"
            [context]="'orientation.chipContext.nextUp' | transloco: { spec: row().id }"
            [copyLabel]="'common.copyCommand' | transloco"
            [copiedLabel]="'common.copied' | transloco: { command }"
            [manualHint]="'common.copyFallback' | transloco"
          />
        </div>
      }
    </div>
  `,
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
