import type { PlanningModel } from '../../../../../../core/src/planning';
import backlogGolden from '../../../../../../core/fixtures/backlog-ranks.planning.golden.json';
import harborGolden from '../../../../../../core/fixtures/harbor.planning.golden.json';
import { buildTree, type TreeNode } from './tree-nodes';

// T9 · ISC-194: the tree lens orders the features of every milestone and of the "No milestone" group by the rank of
// `specs/backlog.md` (spec 036) and hands each feature node its priority for the chip.
const BACKLOG = backlogGolden as unknown as PlanningModel;
const HARBOR = harborGolden as unknown as PlanningModel;
const features = (roots: readonly TreeNode[]) => roots.map((root) => ({ key: root.key, ids: root.children.map((child) => child.id) }));

describe('tree rank: buildTree (T9, ISC-194)', () => {
  it('lists the features of each milestone and of the group in rank order', () => {
    expect(features(buildTree(BACKLOG))).toEqual([
      { key: 'milestone:ferry-1-0', ids: ['F2', 'F1'] },
      { key: 'milestone:ferry-2-0', ids: ['F3', 'F4'] },
      { key: 'group', ids: ['F0'] },
    ]);
  });

  it('follows the rank, not the order of the relation index', () => {
    const rankOf: Record<string, number> = { F1: 1, F2: 3, F3: 4, F4: 2 };
    const swapped: PlanningModel = { ...BACKLOG, features: BACKLOG.features.map((f) => ({ ...f, rank: rankOf[f.id] ?? f.rank })) };
    expect(features(buildTree(swapped)).slice(0, 2)).toEqual([
      { key: 'milestone:ferry-1-0', ids: ['F1', 'F2'] },
      { key: 'milestone:ferry-2-0', ids: ['F4', 'F3'] },
    ]);
  });

  it('orders the group and a model without milestones by rank too', () => {
    const reversed: PlanningModel = { ...HARBOR, features: HARBOR.features.map((f) => ({ ...f, rank: 100 - f.rank })) };
    expect(features(buildTree(reversed)).at(-1)).toEqual({ key: 'group', ids: ['F7', 'F6', 'F5', 'F0'] });
    const bare: PlanningModel = { ...reversed, milestones: [] };
    expect(buildTree(bare).map((node) => node.id)).toEqual(['F7', 'F6', 'F5', 'F4', 'F3', 'F2', 'F1', 'F0']);
  });

  it('carries the priority on every feature node and on no other kind', () => {
    const roots = buildTree(BACKLOG);
    const byId = new Map(roots.flatMap((root) => root.children).map((node) => [node.id, node.priority]));
    expect(Object.fromEntries(byId)).toEqual({ F2: 'P1', F1: 'P3', F3: 'P2', F4: 'P3', F0: 'P3' });
    const others = roots.flatMap((root) => [root, ...root.children.flatMap((feature) => feature.children)]);
    expect(others.every((node) => node.priority === null)).toBe(true);
  });
});
