import { beforeFor, edgeBefore, groupOf, positionOf, stepBefore, type Target } from '../../../core/model/backlog-order';
import type { FeatureGroup } from '../../../core/model/feature-order';
import type { ReorderStep } from '../../../layout/backlog-menu/reorder-menu';
import type { TreeRow } from './tree-rows';

// The tree lens's feature moves (spec 037, T23 · ISC-195): the "Move" menu's state, a step's target, the live
// region's words and the gap a drop lands in. Pure functions over the feature order and measured row boxes; the
// component sends the write and reads the DOM.

/** Where the drop line of a drag stands: before or after a feature row of the dragged one's group. */
export interface DropMark {
  readonly key: string;
  readonly side: 'before' | 'after';
}

/** The "Move" menu's state for the feature whose grip opened it: its group's name and where it stands. */
export function menuStateOf(order: readonly FeatureGroup[], row: TreeRow | null) {
  if (row?.group == null) return null;
  const at = positionOf(order, row.group, row.node.id);
  return {
    feature: row.node.id,
    group: groupOf(order, row.group)?.name ?? null,
    canUp: at !== null && at.index > 1,
    canDown: at !== null && at.index < at.count,
    position: at?.index ?? null,
    count: at?.count ?? null,
  };
}

/** The `before` one step of the menu or of Alt+↑/↓ sends; `none` at the group's edge. */
export function stepTarget(order: readonly FeatureGroup[], group: string, id: string, step: ReorderStep): Target {
  return step === 'up' || step === 'down' ? stepBefore(order, group, id, step === 'up' ? -1 : 1) : edgeBefore(order, group, id, step);
}

/** The live region's catalogue key and parameters for `row`'s place in its group; null for a row of no group. */
export function announcement(
  order: readonly FeatureGroup[],
  row: TreeRow,
  key: string,
  plural: boolean,
): { key: string; params: { id: string; position: number; count: number; group: string } } | null {
  if (row.group === null) return null;
  const at = positionOf(order, row.group, row.node.id);
  const name = groupOf(order, row.group)?.name ?? null;
  const params = { id: row.node.id, position: at?.index ?? 0, count: at?.count ?? 0, group: name ?? '' };
  const form = plural ? (params.count === 1 ? '.one' : '.other') : '';
  return { key: `${name === null ? `${key}None` : key}${form}`, params };
}

/**
 * The gap under the pointer at `y`, over the boxes `seen` of the dragged feature's group as they stand now (keyed by
 * row key): a pointer beyond the group's first or last row by half a row is no target. Rows the empty-feature toggle
 * hides are skipped by mapping the shown gap onto the full group, where `beforeFor` refuses a gap beside the feature
 * itself.
 */
export function dropTarget(
  order: readonly FeatureGroup[],
  rows: readonly TreeRow[],
  seen: ReadonlyMap<string, DOMRect>,
  row: TreeRow,
  y: number,
): { before: Target; mark: DropMark | 'none' | null } {
  if (row.group === null) return { before: 'none', mark: null };
  const shown = rows.filter((candidate) => candidate.group === row.group && seen.has(candidate.key));
  const rects = shown.map((candidate) => seen.get(candidate.key) as DOMRect);
  const first = rects.at(0);
  const last = rects.at(-1);
  if (first === undefined || last === undefined) return { before: 'none', mark: null };
  if (y < first.top - first.height / 2 || y > last.bottom + last.height / 2) return { before: 'none', mark: 'none' };
  const gap = rects.filter((rect) => rect.top + rect.height / 2 < y).length;
  const ids = groupOf(order, row.group)?.ids ?? [];
  const lastShown = shown.at(-1)?.node.id;
  const target = shown.at(gap)?.node.id ?? (lastShown === undefined ? null : (ids.at(ids.indexOf(lastShown) + 1) ?? null));
  const before = beforeFor(order, row.group, row.node.id, target === null ? ids.length : ids.indexOf(target));
  if (before === 'none') return { before, mark: null };
  const mark: DropMark = gap < shown.length ? { key: shown[gap]?.key ?? '', side: 'before' } : { key: shown.at(-1)?.key ?? '', side: 'after' };
  return { before, mark };
}
