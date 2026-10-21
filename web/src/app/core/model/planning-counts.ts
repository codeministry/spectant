import type { PlanningModel } from '../../../../../core/src/planning';

/** The level counts of a planning model the page head and the lenses show; nothing re-derived, only counted. */
export interface PlanningCounts {
  /** Milestones some spec names (the `hasMilestones` rule). */
  readonly milestones: number;
  readonly features: number;
  /** Distinct specs holding a feature, archived ones included. */
  readonly specs: number;
  /** Claims closed and total: the master's recount when the model carries one, else the features' sums. */
  readonly closed: number;
  readonly total: number;
}

export function planningCounts(model: PlanningModel): PlanningCounts {
  const specs = new Set(model.features.flatMap((feature) => feature.holders.map((holder) => holder.slug)));
  const closed = model.recount?.closed ?? model.features.reduce((sum, feature) => sum + feature.closed, 0);
  const total = model.recount?.total ?? model.features.reduce((sum, feature) => sum + feature.total, 0);
  return {
    milestones: model.milestones.filter((milestone) => milestone.specs.length > 0).length,
    features: model.features.length,
    specs: specs.size,
    closed,
    total,
  };
}

/** Whether the model holds an archived spec: the planning lenses offer their archive toggle only then. */
export const hasArchivedSpecs = (model: PlanningModel): boolean =>
  Object.values(model.relations ?? {}).some((relation) => relation.type === 'spec' && relation.archived === true);
