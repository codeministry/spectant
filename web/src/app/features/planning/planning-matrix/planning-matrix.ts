import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { PlanningModel } from '../../../../../../core/src/planning';
import { planningCounts } from '../planning-counts';

/**
 * The matrix lens (spec 026, `/w/:ws/planning/board`). T15 renders its frame over the full width, no rail: one line
 * naming the swimlanes (each milestone a spec names, plus "without milestone") and the feature columns from the
 * planning model. The swimlanes and cards are T19 (ISC-169); the sidebar floats here, it never docks.
 */
@Component({
  selector: 'app-planning-matrix',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-lens': 'board' },
  styles: `
    :host { display: block; }
    p { margin: 0; color: var(--muted-ink); font-size: 14px; line-height: 20px; font-variant-numeric: tabular-nums; }
  `,
  template: `<p data-lens-summary>{{ 'planning.page.summary.board' | transloco: summary() }}</p>`,
})
export class PlanningMatrix {
  readonly model = input.required<PlanningModel>();
  protected readonly summary = computed(() => {
    const counts = planningCounts(this.model());
    return { lanes: counts.milestones + 1, columns: counts.features };
  });
}
