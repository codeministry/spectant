import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import type { DashboardRowView as DashboardSpecRow } from '../context-rail/dashboard-view';
import { UiCard } from '../../../shared/ui/card/card';
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
  imports: [RouterLink, TranslocoPipe, UiCard, UiChip, UiCommandChip, UiIdChip, UiStageTrack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-next-entry]': 'row().id' },
  styles: `
    :host { display: block; min-inline-size: 0; }
    .next-card { display: grid; gap: 12px; min-inline-size: 0; border-inline-start: 3px solid var(--color-primary); }
    .next-card h3 { display: flex; gap: 8px; align-items: baseline; min-inline-size: 0; margin: 0; font-size: 14px; font-weight: 600; line-height: 20px; }
    .next-card ui-id-chip { flex: none; padding-inline: 6px; border-radius: 4px; background: var(--disp-t); font-size: 12px; font-weight: 500; }
    .next-card .link { display: -webkit-box; overflow: hidden; min-inline-size: 0; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; }
    .link { border-radius: var(--radius-field); color: var(--color-base-content); text-decoration: none; }
    .link:hover { text-decoration: underline; text-underline-offset: 3px; }
    .next-foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; min-inline-size: 0; }
    .take { font-family: var(--font-mono); font-size: 12px; }
    .next-row { display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: 4px 8px; align-items: baseline; padding: 10px 12px; border-inline-start: 3px solid var(--color-primary); }
    .next-row .link { overflow: hidden; min-inline-size: 0; font-size: 14px; font-weight: 600; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
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
          <a class="link" data-next-link [routerLink]="[]" [queryParams]="{ spec: row().id }" queryParamsHandling="merge">{{
            row().title
          }}</a>
        </h3>
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
        <a class="link" data-next-link [routerLink]="[]" [queryParams]="{ spec: row().id }" queryParamsHandling="merge">{{
          row().title
        }}</a>
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
}
