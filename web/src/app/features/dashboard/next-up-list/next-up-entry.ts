import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { UiCard } from '../../../shared/ui/card/card';
import { UiClamp } from '../../../shared/ui/clamp/clamp';
import { UiChip } from '../../../shared/ui/chip/chip';
import { UiCommandChip } from '../../../shared/ui/command-chip/command-chip';
import { UiIdChip } from '../../../shared/ui/id-chip/id-chip';
import { UiStageTrack } from '../../../shared/ui/stage-track/stage-track';
import { stageIndex } from '../../spec/dashboard/dashboard-model';
import type { NextUpForm } from './next-up-list';

/**
 * One Next up entry, ported from the prototype (`app.js` nextCard / wsColumn, `styles.css` `.next-card` l.356-358,
 * `.next-row` l.480-481). `rail` form (wide): a next-card — a card with the cyan 3 px left edge, 16 px padding and a
 * 12 px gap: an h3 of the tinted ID chip and the title link, the labelled five-stage track (60 px segments so
 * "Abschluss" fits), then the command chip and the first takeable claim. `card` form (below wide): a next-row inside
 * the list's card — the cyan left edge, the ID in a 36 px column beside the one-line title, the command below it.
 */
@Component({
  selector: 'app-next-up-entry',
  imports: [RouterLink, TranslocoPipe, UiCard, UiChip, UiClamp, UiCommandChip, UiIdChip, UiStageTrack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-next-entry]': 'row().id' },
  styles: `
    :host { display: block; min-inline-size: 0; }
    .next-card { display: grid; gap: 12px; min-inline-size: 0; border-inline-start: 3px solid var(--color-primary); }
    .next-card h3 { display: flex; gap: 8px; align-items: baseline; min-inline-size: 0; margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
    .next-card ui-id-chip { flex: none; padding-inline: 6px; border-radius: 4px; background: var(--disp-t); font-size: 12px; font-weight: 500; }
    .next-card .link { display: block; min-inline-size: 0; }
    .title { display: block; overflow: hidden; overflow-wrap: anywhere; }
    .more { justify-self: start; min-block-size: 24px; padding: 2px 0; border: 0; background: none; color: var(--ques-text); font-family: var(--font-mono); font-size: 13px; font-weight: 600; line-height: 20px; cursor: pointer; }
    .next-card .more { margin-block-start: -8px; }
    .next-row .more { grid-column: 2; }
    @media (hover: hover) { .more:hover { text-decoration: underline; } }
    @media (pointer: coarse) { .more { min-block-size: 44px; } }
    .link { border-radius: var(--radius-field); color: var(--color-base-content); text-decoration: none; }
    .link:hover { text-decoration: underline; text-underline-offset: 3px; }
    .next-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-inline-size: 0; }
    .take { font-family: var(--font-mono); font-size: 12px; }
    .next-row { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 4px 8px; align-items: baseline; padding: 10px 12px; border-inline-start: 3px solid var(--color-primary); }
    .next-row .link { min-inline-size: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
    .next-row .cmd { grid-column: 2; min-inline-size: 0; }
    @media (forced-colors: active) {
      .next-card, .next-row { border-inline-start-color: CanvasText; }
    }
  `,
  template: `
    @if (form() === 'rail') {
      <ui-card class="next-card" data-next-card [padding]="16">
        <h3>
          <ui-id-chip>{{ row().id }}</ui-id-chip>
          <a class="link" data-next-link [routerLink]="[]" [queryParams]="{ spec: row().id }" queryParamsHandling="merge"
            ><span
              #railTitle="uiClamp"
              class="title"
              [id]="titleId()"
              [title]="row().title"
              [uiClamp]="row().title"
              [uiClampLines]="2"
              [uiClampExpanded]="open()"
            ></span
          ></a>
        </h3>
        @if (railTitle.overflows()) {
          <button type="button" class="more" data-next-more [attr.aria-expanded]="open()" [attr.aria-controls]="titleId()" (click)="toggle()">
            {{ (open() ? 'brief.less' : 'brief.more') | transloco }}
          </button>
        }
        <ui-stage-track
          size="labelled"
          [labels]="labels()"
          [current]="current()"
          [ariaLabel]="'stages.position' | transloco: { index: position(), total: labels().length, stage: labels()[position() - 1] ?? '' }"
        />
        <div class="next-foot" data-next-foot>
          @if (row().nextCommand; as command) {
            <ui-command-chip
              [command]="command"
              [copyLabel]="'common.copyCommand' | transloco"
              [copiedLabel]="'common.copied' | transloco: { command }"
              [manualHint]="'common.copyFallback' | transloco"
            />
          }
          @if (row().takeable[0]; as claim) {
            <ui-chip class="take" tone="accent" data-next-takeable>{{ 'common.takeable' | transloco: { claim } }}</ui-chip>
          }
        </div>
      </ui-card>
    } @else {
      <div class="next-row" data-next-row>
        <ui-id-chip>{{ row().id }}</ui-id-chip>
        <a class="link" data-next-link [routerLink]="[]" [queryParams]="{ spec: row().id }" queryParamsHandling="merge"
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
          <button type="button" class="more" data-next-more [attr.aria-expanded]="open()" [attr.aria-controls]="titleId()" (click)="toggle()">
            {{ (open() ? 'brief.less' : 'brief.more') | transloco }}
          </button>
        }
        @if (row().nextCommand; as command) {
          <div class="cmd">
            <ui-command-chip
              [command]="command"
              [copyLabel]="'common.copyCommand' | transloco"
              [copiedLabel]="'common.copied' | transloco: { command }"
              [manualHint]="'common.copyFallback' | transloco"
            />
          </div>
        }
      </div>
    }
  `,
})
export class NextUpEntry {
  readonly row = input.required<DashboardSpecRow>();
  readonly form = input<NextUpForm>('card');
  /** The five translated stage labels (`stages.*`), shared by every entry of the list. */
  readonly labels = input.required<readonly string[]>();

  protected readonly current = computed(() => stageIndex(this.row().stage));
  /** One-based stage the accessible label names; a done spec names the last stage. */
  protected readonly position = computed(() => Math.min(this.current(), this.labels().length - 1) + 1);

  /** The title shows in full: the "more…" / "less" button outside the title link (ISC-111.1). */
  protected readonly open = signal(false);
  protected readonly titleId = computed(() => `next-title-${this.row().id}`);

  protected toggle(): void {
    this.open.update((open) => !open);
  }
}
