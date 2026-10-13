import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';
import type { PlanningModel } from '../../../../../../core/src/planning';
import { DetailSelection } from '../../../layout/detail-sidebar/selection';
import { UiTerm } from '../../../shared/ui/term/term';
import { planningCounts } from '../planning-counts';

/** The tree's levels in cascade order, each with its glossary term (ISC-107's `terms.*` hints). */
const LEVELS = [
  { id: 'milestones', term: 'terms.milestone' },
  { id: 'features', term: 'terms.feature' },
  { id: 'specs', term: 'terms.spec' },
  { id: 'claims', term: 'terms.claim' },
] as const;

/**
 * The tree lens (spec 026, `/w/:ws/planning/tree`). T15 renders its frame: the four level headings Milestone ›
 * Feature › Spec › Claim with their glossary hints (ISC-167) and the counts of each level from the planning model; the
 * cascade itself (expandable rows, `?sel=` on every row) is T17 (ISC-168). The tree is the lens with a rail: it docks
 * the detail sidebar there at wide for its lifetime, so switching to the matrix or the graph undocks it.
 */
@Component({
  selector: 'app-planning-tree',
  imports: [TranslocoPipe, UiTerm],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-lens': 'tree' },
  styles: `
    :host { display: grid; gap: 16px; }
    section { display: block; }
    h2 { display: flex; gap: 8px; align-items: baseline; margin: 0; font-size: 16px; font-weight: 600; line-height: 24px; }
    [data-count] { color: var(--muted-ink); font-family: var(--font-mono); font-size: 12px; font-variant-numeric: tabular-nums; }
  `,
  template: `
    @for (level of levels; track level.id) {
      <section [attr.data-level]="level.id">
        <h2>
          <ui-term [id]="'planning-level-' + level.id" [hint]="level.term | transloco">{{
            'planning.page.levels.' + level.id | transloco
          }}</ui-term>
          <span data-count>{{ counts()[level.id] }}</span>
        </h2>
      </section>
    }
  `,
})
export class PlanningTree {
  readonly model = input.required<PlanningModel>();
  protected readonly levels = LEVELS;
  protected readonly counts = computed(() => {
    const counts = planningCounts(this.model());
    return {
      milestones: String(counts.milestones),
      features: String(counts.features),
      specs: String(counts.specs),
      claims: `${String(counts.closed)}/${String(counts.total)}`,
    };
  });

  constructor() {
    inject(DetailSelection).dock(inject(DestroyRef));
  }
}
