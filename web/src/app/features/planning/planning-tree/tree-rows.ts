import type { RelationRef } from '../../../../../../core/src/relations';
import type { SelectedLook } from '../../../layout/detail-sidebar/selection';
import type { TreeKind, TreeNode } from './tree-nodes';

// The tree lens's visible rows (spec 026, ISC-168): which nodes show, where each stands, and where the arrow keys go.
// Pure functions over the built tree; the component holds the signals and the DOM.

/** The tree's levels in cascade order, each with its glossary term (ISC-107's `terms.*` hints). */
export const LEVELS = [
  { id: 'milestones', term: 'terms.milestone' },
  { id: 'features', term: 'terms.feature' },
  { id: 'specs', term: 'terms.spec' },
  { id: 'claims', term: 'terms.claim' },
] as const;

/** One visible row: the node, where it stands, and the state the template binds without calling back. */
export interface TreeRow {
  readonly node: TreeNode;
  readonly kind: TreeKind;
  readonly key: string;
  readonly parentKey: string | null;
  readonly level: number;
  /** One entry per guide line left of the row (`level - 1`). */
  readonly guides: readonly number[];
  readonly expandable: boolean;
  readonly open: boolean;
  readonly look: SelectedLook | null;
  readonly full: boolean;
  /** A feature's move group (`featureOrder` key): its milestone's row key, or `group`; null for every other kind. */
  readonly group: string | null;
}

/** What decides which rows show: the hand-made toggles, the selection's path, a lifted feature and the selected look. */
export interface RowState {
  readonly overrides: ReadonlyMap<string, boolean>;
  readonly path: ReadonlySet<string>;
  readonly lifted: boolean;
  readonly lookOf: (ref: RelationRef) => SelectedLook | null;
}

/** The visible rows in order: milestones, groups and the selection's path open by default, a hand toggle wins. */
export function treeRows(roots: readonly TreeNode[], state: RowState): TreeRow[] {
  const { overrides, path, lifted, lookOf } = state;
  const out: TreeRow[] = [];
  const visit = (node: TreeNode, level: number, parentKey: string | null): void => {
    const expandable = node.children.length > 0;
    const byDefault = node.kind === 'milestone' || node.kind === 'group' || path.has(node.key);
    // While a feature is dragged, every feature shows its head only, so each gap is a feature boundary.
    const open = expandable && !(lifted && node.kind === 'feature') && (overrides.get(node.key) ?? byDefault);
    out.push({
      node,
      kind: node.kind,
      key: node.key,
      parentKey,
      level,
      guides: Array.from({ length: level - 1 }, (_, i) => i),
      expandable,
      open,
      look: node.ref === null ? null : lookOf(node.ref),
      full: node.total > 0 && node.closed === node.total,
      group: node.kind === 'feature' ? (parentKey ?? 'group') : null,
    });
    if (open) for (const child of node.children) visit(child, level + 1, node.key);
  };
  for (const root of roots) visit(root, 1, null);
  return out;
}

/** The key of every node with children, open or not: what "open all" opens. */
export function expandableKeys(roots: readonly TreeNode[]): string[] {
  const keys: string[] = [];
  const walk = (node: TreeNode): void => {
    if (node.children.length > 0) keys.push(node.key);
    node.children.forEach(walk);
  };
  roots.forEach(walk);
  return keys;
}

/** What a navigation key does at a row: open or close it, move the tab stop, or select it. */
export interface KeyStep {
  readonly open?: boolean;
  readonly next?: TreeRow;
  readonly activate?: boolean;
}

/**
 * The WAI-ARIA tree keys at `rows[at]`: the arrows move along the visible rows, Right and Left open, close or step to
 * the child or parent, Home and End jump, Enter and Space select. Null for a key the tree leaves alone.
 */
export function keyStep(rows: readonly TreeRow[], at: number, key: string): KeyStep | null {
  const row = rows[at];
  if (at < 0 || at >= rows.length) return null;
  switch (key) {
    case 'ArrowDown':
      return { next: rows[at + 1] };
    case 'ArrowUp':
      return { next: rows[at - 1] };
    case 'Home':
      return { next: rows[0] };
    case 'End':
      return { next: rows.at(-1) };
    case 'ArrowRight':
      if (row.expandable && !row.open) return { open: true };
      return row.open ? { next: rows[at + 1] } : {};
    case 'ArrowLeft':
      if (row.open) return { open: false };
      return { next: rows.find((candidate) => candidate.key === row.parentKey) };
    case 'Enter':
    case ' ':
      return { activate: true };
    default:
      return null;
  }
}
