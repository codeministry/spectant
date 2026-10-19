import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { Guidance, GuidanceEntry } from '../../../../../../core/src/files';
import type { DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { guidanceEntryOf } from '../../../shared/ui/guidance/guidance-entry';
import { GuidanceReasonPipe } from '../../../shared/ui/guidance/guidance-reason.pipe';
import { UiGlyph } from '../../../shared/ui/glyph/glyph';
import { UiClamp } from '../../../shared/ui/clamp/clamp';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiIdChip } from '../../../shared/ui/id-chip/id-chip';
import { UiReason } from '../../../shared/ui/reason/reason';
import { stageIndex } from '../../spec/dashboard/dashboard-model';
import type { NextUpForm } from './next-up-list';

/**
 * One Next up entry, ported from the prototype (`app.js` nextCard / wsColumn, `styles.css` `.next-card` l.356-358,
 * `.next-row` l.480-481). `rail` form (wide, spec 021 T79): a row of the list's one card — the cyan 3 px left edge,
 * 8 px padding (12 at the start) and an 8 px gap: an h3 of the tinted ID chip and the one-line title link (its
 * accessible name ends with the stage, "Stage 4 of 5: Build"; the labelled track is gone from the rail), then the
 * reason line (`ui-reason`, or the guidance sentence) and the command chip beside the first takeable claim. The toggle
 * sits on the title line in both forms. `card` form (below wide): a next-row inside the list's card — the cyan left edge, the ID in
 * a 36 px column beside the one-line title and its toggle, the compact reason line below it. The phrase is the
 * dashboard row's (ISC-122.3).
 */
@Component({
  selector: 'app-next-up-entry',
  imports: [GuidanceReasonPipe, NgTemplateOutlet, RouterLink, TranslocoPipe, UiChip, UiClamp, UiCommandChip, UiGlyph, UiIdChip, UiReason],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-next-entry]': 'row().id', '[attr.data-form]': 'form()' },
  styles: `
    :host { display: block; min-inline-size: 0; }
    /* Spec 021 (T79, P3 heights): the rail entry is a row of the list's one card, under a hairline: the cyan 3 px left
       edge, 8 px padding (12 at the start, 8 at the end so both chips fit), 8 px gaps; the id chip and the one-line
       title with its toggle, the whole sentence, then the command and the takeable chip on one line. No labelled
       stage track: the stage is in the title link's accessible name. */
    .next-item { display: grid; gap: 8px; min-inline-size: 0; padding: 8px 8px 8px 12px; border-inline-start: 3px solid var(--color-primary); }
    .next-item h3 { display: flex; gap: 8px; align-items: baseline; min-inline-size: 0; margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
    .next-item ui-id-chip { flex: none; padding-inline: 6px; border-radius: 4px; background: var(--disp-t); font-size: 12px; font-weight: 500; }
    .next-item .text-link { display: block; flex: 1 1 auto; min-inline-size: 0; }
    .visually-hidden { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
    .title { display: block; overflow: hidden; overflow-wrap: anywhere; }
    .more { position: relative; justify-self: start; min-block-size: 24px; padding: 2px 0; border: 0; background: none; color: var(--ques-text); font-family: var(--font-mono); font-size: 13px; font-weight: 600; line-height: 20px; cursor: pointer; }
    .next-item .head { display: flex; gap: 8px; align-items: baseline; min-inline-size: 0; }
    .next-item h3 { flex: 1 1 auto; }
    .head .more { flex: none; }
    /* Card form: the toggle on the title line, its 24 px box pulled to the 20 px line so the row stays 20 tall. */
    .next-row .more { grid-column: 3; grid-row: 1; margin-block: -2px; }
    @media (hover: hover) { .more:hover { text-decoration: underline; } }
    /* Spec 021 (T31): a 44 px hit area (WCAG 2.5.8) around the 24 px toggle under a coarse pointer, as ui-button and
       the worktree chip grow theirs: an invisible ::before, so the row keeps its height. */
    @media (pointer: coarse) { .more::before { position: absolute; inset: min(0px, (100% - 44px) / 2); content: ''; } }
    .text-link { border-radius: var(--radius-field); color: var(--color-base-content); text-decoration: none; }
    .text-link:hover { text-decoration: underline; text-underline-offset: 3px; }
    .next-foot { display: flex; flex-wrap: wrap; gap: 8px 6px; align-items: center; min-inline-size: 0; }
    .next-foot .reason, .next-foot .sentence { flex: 1 1 100%; }
    /* The guide's sentence and chip join the foot's flow, so the command chip and the takeable chip share one line. */
    .next-foot .guide { display: contents; }
    /* Prototype [data-ui=chip].take: mono 500 12 px, no capitals, the hand glyph. */
    ui-chip.take { gap: 4px; padding-inline: 6px; font-family: var(--font-mono); font-size: 12px; font-weight: 500; letter-spacing: 0; text-transform: none; }
    .next-row { display: grid; grid-template-columns: 36px minmax(0, 1fr) auto; gap: 4px 8px; align-items: baseline; padding: 8px 12px; border-inline-start: 3px solid var(--color-primary); }
    .next-row .text-link { min-inline-size: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
    .next-row .cmd { grid-column: 2 / -1; min-inline-size: 0; }
    /* Spec 020 (T25): the sentence in 13/20 over the chip, wrapping on whole words and never clamped; the ring of
       "open" in its own tone (secondary). A card row as wide as the 820 px dashboard keeps the chip right, top-aligned. */
    :host([data-form='card']) { container: next-entry / inline-size; }
    .guide { display: grid; gap: 8px; justify-items: start; align-items: start; min-inline-size: 0; }
    .sentence { display: flex; gap: 6px; align-items: flex-start; min-inline-size: 0; color: var(--color-base-content); font-size: 13px; line-height: 20px; overflow-wrap: break-word; }
    .sentence ui-glyph { padding-block-start: 3px; }
    @container next-entry (min-inline-size: 560px) {
      .guide { grid-template-columns: minmax(0, 1fr) auto; column-gap: 16px; }
    }
    @media (forced-colors: active) {
      .next-item, .next-row { border-inline-start-color: CanvasText; }
    }
  `,
  template: `
    @if (form() === 'rail') {
      <div class="next-item" data-next-row>
        <div class="head">
          <h3>
            <ui-id-chip>{{ row().id }}</ui-id-chip>
            <a class="text-link" data-next-link [routerLink]="[]" [queryParams]="{ sel: 'spec:' + row().id }" queryParamsHandling="merge"
              ><span
                #railTitle="uiClamp"
                class="title"
                [id]="titleId()"
                [title]="row().title"
                [uiClamp]="row().title"
                [uiClampLines]="1"
                [uiClampExpanded]="open()"
              ></span
              ><span class="visually-hidden" data-next-stage>, {{ 'stages.position' | transloco: { index: position(), total: labels().length, stage: labels()[position() - 1] ?? '' } }}</span></a
            >
          </h3>
          @if (railTitle.overflows()) {
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
        </div>
        <div class="next-foot" data-next-foot>
          <ng-container [ngTemplateOutlet]="next" [ngTemplateOutletContext]="{ compact: false }" />
          @if (row().takeable[0]; as claim) {
            <ui-chip class="take" tone="accent" icon="hand" data-next-takeable>{{ 'common.takeable' | transloco: { claim } }}</ui-chip>
          }
        </div>
      </div>
    } @else {
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
        @if (entry() || row().nextReason || row().nextCommand) {
          <div class="cmd">
            <ng-container [ngTemplateOutlet]="next" [ngTemplateOutletContext]="{ compact: true }" />
          </div>
        }
      </div>
    }

    <!-- The reason line (ISC-122.3): the same phrase and chip as the dashboard row; the bare chip without a phrase.
         With its guidance entry (spec 020, T25, ISC-240): the ring of "open", the whole sentence, never clamped, and the
         entry's command; no "Waits on you" mark, Next is not waiting on you. -->
    <ng-template #next let-compact="compact">
      @if (entry(); as entry) {
        <div class="guide" data-next-reason data-next-guide>
          <span class="sentence"
            ><ui-glyph state="open" family="item" [size]="14" /><span data-next-sentence>{{ entry.reason | guidanceReason }}</span></span
          >
          @if (entry.command; as command) {
            <ui-command-chip
              [command]="command"
              [copyLabel]="'common.copyCommand' | transloco"
              [copiedLabel]="'common.copied' | transloco: { command }"
              [manualHint]="'common.copyFallback' | transloco"
            />
          }
        </div>
      } @else if (row().nextReason; as phrase) {
        <ui-reason class="reason" data-next-reason [phrase]="phrase" [guidance]="entryReason()" [command]="row().nextCommand" [compact]="compact" />
      } @else if (row().nextCommand; as command) {
        <ui-command-chip
          [command]="command"
          [copyLabel]="'common.copyCommand' | transloco"
          [copiedLabel]="'common.copied' | transloco: { command }"
          [manualHint]="'common.copyFallback' | transloco"
        />
      }
    </ng-template>
  `,
})
export class NextUpEntry {
  readonly row = input.required<DashboardSpecRow>();
  readonly form = input<NextUpForm>('card');
  /** The five translated stage labels (`stages.*`), shared by every entry of the list: the rail link names the stage. */
  readonly labels = input.required<readonly string[]>();
  /** `DashboardModel.guidance` (spec 020): the spec's own entry turns the phrase into its sentence (ISC-237.1). */
  readonly guidance = input<Guidance | undefined>(undefined);
  /** The `guidance.next` entry this row stands for (spec 020, T25): its sentence and command replace the row's phrase. */
  readonly entry = input<GuidanceEntry | null>(null);

  protected readonly entryReason = computed(() => guidanceEntryOf(this.guidance(), this.row().id)?.reason ?? null);

  protected readonly current = computed(() => stageIndex(this.row().stage));
  /** One-based stage the accessible label names; a done spec names the last stage. */
  protected readonly position = computed(() => Math.min(this.current(), this.labels().length - 1) + 1);

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
