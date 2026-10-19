import type { BacklogPriority } from '../../../../../../core/src/backlog';
import type { PlanningModel } from '../../../../../../core/src/planning';
import type { Relation, RelationIndex, RelationRef } from '../../../../../../core/src/relations';
import type { Stage } from '../../../../../../core/src/stage';

/** The kinds of row the tree lens shows; `group` is the "No milestone" group, a grouping with no object behind it. */
export type TreeKind = 'milestone' | 'group' | 'feature' | 'spec' | 'claim';

/** One node of the cascade: what a row shows, read from the relation index, and the nodes one level down. */
export interface TreeNode {
  /** The path from the root (`milestone:x/feature:F1/…`), unique even when a feature sits under two milestones. */
  readonly key: string;
  readonly kind: TreeKind;
  /** The object the row stands for (`?sel=`); null for the "No milestone" group. */
  readonly ref: RelationRef | null;
  readonly id: string;
  readonly title: string;
  readonly closed: number;
  readonly total: number;
  readonly archived: boolean;
  readonly stage: Stage | null;
  /** A milestone's target date, ISO; null for every other kind and for an undated milestone. */
  readonly target: string | null;
  /** A feature's priority in `specs/backlog.md` (spec 036, `P3` when unlisted), the chip's value; null for every other kind. */
  readonly priority: BacklogPriority | null;
  readonly children: readonly TreeNode[];
}

const of = (index: RelationIndex, ref: RelationRef): Relation | undefined => index[ref];
const typed = (entry: Relation, type: string): RelationRef[] => entry.children.filter((child) => child.startsWith(`${type}:`));
/** A live claim: a dropped one counts in neither number (total 0), so the tree leaves it out like the counts do. */
const live = (index: RelationIndex, ref: RelationRef): boolean => (of(index, ref)?.total ?? 0) > 0;

function leaf(entry: Relation, key: string, kind: TreeKind, children: readonly TreeNode[] = [], target: string | null = null): TreeNode {
  return {
    key,
    kind,
    ref: entry.ref,
    id: entry.id,
    title: entry.title,
    closed: entry.closed,
    total: entry.total,
    archived: entry.archived === true,
    stage: entry.stage ?? null,
    target,
    priority: null,
    children,
  };
}

function claimNodes(index: RelationIndex, refs: readonly RelationRef[], parentKey: string): TreeNode[] {
  return refs
    .filter((ref) => live(index, ref))
    .flatMap((ref) => {
      const entry = of(index, ref);
      return entry === undefined ? [] : [leaf(entry, `${parentKey}/${ref}`, 'claim')];
    });
}

/**
 * A feature with its specs (active first, archived under them unless `archived` is false) and their claims, then the
 * feature's claims no spec holds, so every live claim of the block shows once under it. Every number is the index
 * entry's own; a hidden archived spec takes its claims with it, the feature's numbers stay.
 */
function featureNode(index: RelationIndex, ref: RelationRef, parentKey: string | null, archived: boolean, priority: BacklogPriority | null): TreeNode | null {
  const entry = of(index, ref);
  if (entry === undefined) return null;
  const key = parentKey === null ? ref : `${parentKey}/${ref}`;
  const specRefs = typed(entry, 'spec');
  const specs = specRefs
    .map((spec) => of(index, spec))
    .filter((spec): spec is Relation => spec !== undefined && (archived || spec.archived !== true))
    .sort((a, b) => Number(a.archived === true) - Number(b.archived === true))
    .map((spec) => leaf(spec, `${key}/${spec.ref}`, 'spec', claimNodes(index, typed(spec, 'claim'), `${key}/${spec.ref}`)));
  const unheld = typed(entry, 'claim').filter((claim) => !(of(index, claim)?.parents ?? []).some((parent) => parent.startsWith('spec:')));
  return { ...leaf(entry, key, 'feature', [...specs, ...claimNodes(index, unheld, key)]), priority };
}

/**
 * The cascade of the tree lens (spec 026, ISC-168), read from the planning model's relation index so the tree, the
 * sidebar and the other lenses count alike: the milestones in the model's order (target ascending, undated last), each
 * with the features the index lists under it, then the "No milestone" group of the features no milestone lists, only
 * when it is not empty. A model without milestones starts at the features. Every feature list is in rank order
 * (`PlanningFeature.rank`, spec 037 T9), and every feature node carries its priority. `archived` false (the page's
 * archive toggle off) leaves archived specs out; the counts stay the index's.
 */
export function buildTree(model: PlanningModel, archived = true): readonly TreeNode[] {
  const index = model.relations ?? {};
  const byId = new Map(model.features.map((feature) => [`feature:${feature.id}` as RelationRef, feature]));
  const byRank = (refs: readonly RelationRef[]): RelationRef[] =>
    [...refs].sort((a, b) => (byId.get(a)?.rank ?? Infinity) - (byId.get(b)?.rank ?? Infinity));
  const node = (ref: RelationRef, parentKey: string | null): TreeNode | null => featureNode(index, ref, parentKey, archived, byId.get(ref)?.priority ?? null);
  const featureRefs = byRank([...byId.keys()]);
  if (model.milestones.length === 0) return featureRefs.flatMap((ref) => node(ref, null) ?? []);

  const roots: TreeNode[] = [];
  for (const milestone of model.milestones) {
    const ref: RelationRef = `milestone:${milestone.slug}`;
    const entry = of(index, ref);
    if (entry === undefined) continue;
    const features = byRank(typed(entry, 'feature')).flatMap((feature) => node(feature, ref) ?? []);
    roots.push(leaf(entry, ref, 'milestone', features, milestone.target));
  }
  const loose = featureRefs
    .filter((ref) => !(of(index, ref)?.parents ?? []).some((parent) => parent.startsWith('milestone:')))
    .flatMap((ref) => node(ref, 'group') ?? []);
  if (loose.length > 0) {
    roots.push({
      key: 'group',
      kind: 'group',
      ref: null,
      id: '',
      title: '',
      closed: loose.reduce((sum, node) => sum + node.closed, 0),
      total: loose.reduce((sum, node) => sum + node.total, 0),
      archived: false,
      stage: null,
      target: null,
      priority: null,
      children: loose,
    });
  }
  return roots;
}

/** A spec row on done (spec 046): what the done-and-empty toggle hides. */
const isDone = (node: TreeNode): boolean => node.kind === 'spec' && node.stage === 'done';

/** A feature holds an open spec row: one spec at least not on done (and not archived while the archive toggle hides those). */
const holdsOpenSpec = (node: TreeNode): boolean => node.kind !== 'feature' || node.children.some((child) => child.kind === 'spec' && !isDone(child));

/**
 * True when the cascade shows what the done-and-empty toggle hides (spec 046): a spec on done, or a feature without an
 * open spec row (no spec at all, or only specs on done).
 */
export function hasDoneOrEmpty(roots: readonly TreeNode[]): boolean {
  const features = roots.flatMap((root) => (root.kind === 'feature' ? [root] : root.children));
  return features.some((feature) => !holdsOpenSpec(feature) || feature.children.some(isDone));
}

/**
 * The cascade with the toggle on (spec 046, ISC-275, ISC-277): every spec on done leaves, then every feature without an
 * open spec row, and the "No milestone" group leaves with its last feature. Milestones stay, even emptied, and every
 * number stays the index's.
 */
export function withoutDoneAndEmpty(roots: readonly TreeNode[]): readonly TreeNode[] {
  const feature = (node: TreeNode): readonly TreeNode[] =>
    holdsOpenSpec(node) ? [node.kind === 'feature' ? { ...node, children: node.children.filter((child) => !isDone(child)) } : node] : [];
  return roots.flatMap((root) => {
    if (root.kind === 'feature') return feature(root);
    const children = root.children.flatMap(feature);
    return root.kind === 'group' && children.length === 0 ? [] : [{ ...root, children }];
  });
}

/** The keys of the nodes on the path to `ref` (its ancestors, not itself), wherever it shows; empty when it does not. */
export function pathTo(roots: readonly TreeNode[], ref: RelationRef | null): ReadonlySet<string> {
  const open = new Set<string>();
  if (ref === null) return open;
  const walk = (node: TreeNode): boolean => {
    let found = false;
    for (const child of node.children) if (child.ref === ref || walk(child)) found = true;
    if (found) open.add(node.key);
    return found;
  };
  for (const root of roots) walk(root);
  return open;
}
