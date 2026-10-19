import type { PlanningModel } from '../../../../../../core/src/planning';
import backlogGolden from '../../../../../../core/fixtures/backlog-ranks.planning.golden.json';
import harborGolden from '../../../../../../core/fixtures/harbor.planning.golden.json';
import { buildTree, hasDoneOrEmpty, type TreeNode, withoutDoneAndEmpty } from './tree-nodes';

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

// Spec 046 · ISC-275 · ISC-277: the toggle hides every spec on done, every feature whose specs all stand on done and
// every feature without a spec; open specs, mixed features and the milestones stay.
const node = (key: string, kind: TreeNode['kind'], children: readonly TreeNode[] = [], stage: TreeNode['stage'] = null): TreeNode => ({
  key,
  kind,
  ref: null,
  id: key.split('/').at(-1) ?? key,
  title: key,
  closed: 0,
  total: 0,
  archived: false,
  stage,
  target: null,
  priority: null,
  children,
});
const spec = (key: string, stage: TreeNode['stage']): TreeNode => node(key, 'spec', [node(`${key}/c`, 'claim')], stage);
const keys = (roots: readonly TreeNode[]): string[] => roots.flatMap((root) => [root.key, ...keys(root.children)]);

describe('hide done and empty: withoutDoneAndEmpty (spec 046)', () => {
  const tree: readonly TreeNode[] = [
    node('m1', 'milestone', [
      node('m1/open', 'feature', [spec('m1/open/s1', 'build'), spec('m1/open/s2', 'plan')]),
      node('m1/mixed', 'feature', [spec('m1/mixed/s3', 'done'), spec('m1/mixed/s4', 'review'), node('m1/mixed/c9', 'claim')]),
      node('m1/finished', 'feature', [spec('m1/finished/s5', 'done'), spec('m1/finished/s6', 'done'), node('m1/finished/c8', 'claim')]),
      node('m1/empty', 'feature', [node('m1/empty/c7', 'claim')]),
    ]),
    node('m2', 'milestone', [node('m2/finished', 'feature', [spec('m2/finished/s7', 'done')])]),
    node('group', 'group', [node('group/finished', 'feature', [spec('group/finished/s8', 'done')])]),
  ];

  it('ISC-275: no spec on done and no feature whose specs are all done; an open feature keeps exactly its open specs', () => {
    const shown = keys(withoutDoneAndEmpty(tree));
    expect(shown.filter((key) => /\/s[35678]$/u.test(key))).toEqual([]);
    expect(shown).not.toContain('m1/finished');
    expect(shown).not.toContain('m2/finished');
    expect(shown).not.toContain('group/finished');
    expect(shown).not.toContain('m1/empty');
    expect(withoutDoneAndEmpty(tree)[0]?.children.find((f) => f.key === 'm1/mixed')?.children.map((c) => c.key)).toEqual(['m1/mixed/s4', 'm1/mixed/c9']);
  });

  it('ISC-277: every open spec, every feature with an open spec and every milestone stays', () => {
    const shown = keys(withoutDoneAndEmpty(tree));
    for (const key of ['m1', 'm2', 'm1/open', 'm1/open/s1', 'm1/open/s2', 'm1/mixed', 'm1/mixed/s4', 'm1/open/s1/c']) expect(shown).toContain(key);
    // The "No milestone" group leaves with its last feature, milestones never do.
    expect(withoutDoneAndEmpty(tree).map((root) => root.key)).toEqual(['m1', 'm2']);
  });

  it('is offered when the tree shows a done spec even if no feature is empty', () => {
    expect(hasDoneOrEmpty([node('m', 'milestone', [node('m/f', 'feature', [spec('m/f/s', 'done'), spec('m/f/t', 'build')])])])).toBe(true);
    expect(hasDoneOrEmpty([node('m', 'milestone', [node('m/f', 'feature', [spec('m/f/t', 'build')])])])).toBe(false);
  });
});
