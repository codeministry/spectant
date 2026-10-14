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
 * A feature with its specs (active first, archived under them) and their claims, then the feature's claims no spec
 * holds, so every live claim of the block shows once under it. Every number is the index entry's own.
 */
function featureNode(index: RelationIndex, ref: RelationRef, parentKey: string | null): TreeNode | null {
  const entry = of(index, ref);
  if (entry === undefined) return null;
  const key = parentKey === null ? ref : `${parentKey}/${ref}`;
  const specRefs = typed(entry, 'spec');
  const specs = specRefs
    .map((spec) => of(index, spec))
    .filter((spec): spec is Relation => spec !== undefined)
    .sort((a, b) => Number(a.archived === true) - Number(b.archived === true))
    .map((spec) => leaf(spec, `${key}/${spec.ref}`, 'spec', claimNodes(index, typed(spec, 'claim'), `${key}/${spec.ref}`)));
  const unheld = typed(entry, 'claim').filter((claim) => !(of(index, claim)?.parents ?? []).some((parent) => parent.startsWith('spec:')));
  return leaf(entry, key, 'feature', [...specs, ...claimNodes(index, unheld, key)]);
}

/**
 * The cascade of the tree lens (spec 026, ISC-168), read from the planning model's relation index so the tree, the
 * sidebar and the other lenses count alike: the milestones in the model's order (target ascending, undated last), each
 * with the features the index lists under it, then the "No milestone" group of the features no milestone lists, only
 * when it is not empty. A model without milestones starts at the features, in master order.
 */
export function buildTree(model: PlanningModel): readonly TreeNode[] {
  const index = model.relations ?? {};
  const featureRefs = model.features.map((feature): RelationRef => `feature:${feature.id}`);
  if (model.milestones.length === 0) return featureRefs.flatMap((ref) => featureNode(index, ref, null) ?? []);

  const roots: TreeNode[] = [];
  for (const milestone of model.milestones) {
    const ref: RelationRef = `milestone:${milestone.slug}`;
    const entry = of(index, ref);
    if (entry === undefined) continue;
    const features = typed(entry, 'feature').flatMap((feature) => featureNode(index, feature, ref) ?? []);
    roots.push(leaf(entry, ref, 'milestone', features, milestone.target));
  }
  const loose = featureRefs
    .filter((ref) => !(of(index, ref)?.parents ?? []).some((parent) => parent.startsWith('milestone:')))
    .flatMap((ref) => featureNode(index, ref, 'group') ?? []);
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
      children: loose,
    });
  }
  return roots;
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
