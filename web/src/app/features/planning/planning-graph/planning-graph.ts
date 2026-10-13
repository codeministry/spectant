import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { PlanningModel } from '../../../../../../core/src/planning';
import { planningCounts } from '../planning-counts';

/**
 * The graph lens (spec 026, `/w/:ws/planning/graph`). T15 renders its frame over the full width, no rail: one line
 * naming the levels the graph Milestone → Feature → Spec draws, counted from the planning model. The mermaid figure,
 * bundles and the milestone pills are T21 (ISC-170); the sidebar floats here, it never docks.
 */
@Component({
  selector: 'app-planning-graph',
  imports: [TranslocoPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-lens': 'graph' },
  styles: `
    :host { display: block; }
    p { margin: 0; color: var(--muted-ink); font-size: 14px; line-height: 20px; font-variant-numeric: tabular-nums; }
  `,
  template: `<p data-lens-summary>{{ 'planning.page.summary.graph' | transloco: summary() }}</p>`,
})
export class PlanningGraph {
  readonly model = input.required<PlanningModel>();
  protected readonly summary = computed(() => {
    const counts = planningCounts(this.model());
    return { milestones: counts.milestones, features: counts.features, specs: counts.specs };
  });
}
