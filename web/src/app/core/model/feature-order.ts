import type { PlanningModel } from '../../../../../core/src/planning';

/**
 * One area a feature moves in (spec 037): a milestone of the planning model, or the "No milestone" group. `key` is the
 * tree's key of the row heading it (`milestone:<slug>`, or `group`).
 */
export interface FeatureGroup {
  readonly key: string;
  /** The milestone's name; null for the group. */
  readonly name: string | null;
  /** The milestone's target date, ISO; null for an undated milestone and for the group. */
  readonly target: string | null;
  /** The feature ids in rank order (`PlanningFeature.rank`, spec 036). */
  readonly ids: readonly string[];
}

/**
 * T8 · ISC-194: the features per milestone, in the model's milestone order (target ascending, undated last), and then
 * the "No milestone" group of the features no milestone lists, only when it is not empty; every list in rank order. A
 * milestone lists the blocks of `PlanningMilestone.features`, the shares the tree shows under it, which core already
 * sorts by rank; the group keeps the rank order of `PlanningModel.features`. Without milestones the group is all.
 */
export function featureOrder(model: PlanningModel): readonly FeatureGroup[] {
  const rank = new Map(model.features.map((feature) => [feature.id, feature.rank]));
  const byRank = (ids: readonly string[]): string[] => [...ids].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
  const listed = new Set<string>();
  const groups: FeatureGroup[] = model.milestones.map((milestone) => {
    const ids = byRank(milestone.features.map((share) => share.id));
    for (const id of ids) listed.add(id);
    return { key: `milestone:${milestone.slug}`, name: milestone.name, target: milestone.target, ids };
  });
  const loose = model.features.map((feature) => feature.id).filter((id) => !listed.has(id));
  if (loose.length > 0 || groups.length === 0) groups.push({ key: 'group', name: null, target: null, ids: loose });
  return groups;
}
