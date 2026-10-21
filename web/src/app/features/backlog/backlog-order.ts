import type { FeatureGroup } from '../../core/model/feature-order';

/** The backlog route's `before` (spec 036): the id of the feature the moved one lands in front of, null for the end. */
export type Before = string | null;

/**
 * A `before` to send, or `'none'` when the move changes nothing and nothing is sent (the route refuses a no-op). The
 * type widens to `string | null`; `'none'` stays apart from every feature id at run time, since ids read `F<n>`.
 */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents -- 'none' names the no-move result for readers and callers
export type Target = Before | 'none';

/** The group with this key, undefined for a key the order does not hold. */
export function groupOf(order: readonly FeatureGroup[], groupKey: string): FeatureGroup | undefined {
  return order.find((group) => group.key === groupKey);
}

/** The feature's group ids and its index there, or null when the feature does not stand in that group. */
function locate(order: readonly FeatureGroup[], groupKey: string, feature: string): { ids: readonly string[]; at: number } | null {
  const ids = groupOf(order, groupKey)?.ids;
  const at = ids?.indexOf(feature) ?? -1;
  return ids && at >= 0 ? { ids, at } : null;
}

/** The gaps of `ids` a drop of the feature at `at` may take: all of 0..ids.length but the two around itself. */
function openGaps(ids: readonly string[], at: number): number[] {
  const gaps: number[] = [];
  for (let gap = 0; gap <= ids.length; gap++) if (gap !== at && gap !== at + 1) gaps.push(gap);
  return gaps;
}

/** The `before` of gap `gap` in `ids` when the feature at `at` may take it, else `'none'`. */
function targetOf(ids: readonly string[], at: number, gap: number): Target {
  if (!openGaps(ids, at).includes(gap)) return 'none';
  return ids[gap] ?? null;
}

/**
 * T15 · ISC-195, ISC-195.1: the gaps of the group `groupKey` a drop of `feature` may take, gap i in front of `ids[i]`
 * and gap `ids.length` at the end, without the two gaps around the feature itself, which move nothing. Empty when the
 * feature does not stand in that group: a position in another milestone, or outside the "No milestone" group, is no
 * drop target. The group key is the one the user acts in, because a feature may be listed under two milestones.
 */
export function gapsFor(order: readonly FeatureGroup[], groupKey: string, feature: string): readonly number[] {
  const found = locate(order, groupKey, feature);
  return found ? openGaps(found.ids, found.at) : [];
}

/** The `before` for a drop of `feature` into gap `gap` of its group; `'none'` for a gap `gapsFor` does not offer. */
export function beforeFor(order: readonly FeatureGroup[], groupKey: string, feature: string, gap: number): Target {
  const found = locate(order, groupKey, feature);
  return found ? targetOf(found.ids, found.at, gap) : 'none';
}

/**
 * Alt+↑ (-1) swaps the feature with its upper neighbour in the group, Alt+↓ (+1) with its lower one, which puts it in
 * front of the feature after that (null when it becomes the last); `'none'` at the first or the last feature.
 */
export function stepBefore(order: readonly FeatureGroup[], groupKey: string, feature: string, step: -1 | 1): Target {
  const found = locate(order, groupKey, feature);
  return found ? targetOf(found.ids, found.at, step === -1 ? found.at - 1 : found.at + 2) : 'none';
}

/** "An den Anfang" (`first`) and "Ans Ende" (`last`) of the move menu; `'none'` when it already stands there. */
export function edgeBefore(order: readonly FeatureGroup[], groupKey: string, feature: string, edge: 'first' | 'last'): Target {
  const found = locate(order, groupKey, feature);
  return found ? targetOf(found.ids, found.at, edge === 'first' ? 0 : found.ids.length) : 'none';
}

/** The feature's 1-based position and the size of its group, for the live region; null outside that group. */
export function positionOf(order: readonly FeatureGroup[], groupKey: string, feature: string): { index: number; count: number } | null {
  const found = locate(order, groupKey, feature);
  return found ? { index: found.at + 1, count: found.ids.length } : null;
}
