import type { PlanningModel } from '../../../../../core/src/planning';
import backlogGolden from '../../../../../core/fixtures/backlog-ranks.planning.golden.json';
import harborGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import { featureOrder } from './backlog-order';

// T7 · ISC-194: the feature order per milestone and for the "No milestone" group, read from the planning model that
// carries the rank of `specs/backlog.md` (spec 036). The goldens are typed as JSON; the served bodies are the core type.
const BACKLOG = backlogGolden as unknown as PlanningModel;
const HARBOR = harborGolden as unknown as PlanningModel;

describe('tree rank: featureOrder (T7, ISC-194)', () => {
  it('lists every milestone in the model order with its features in rank order, then the "No milestone" group', () => {
    expect(featureOrder(BACKLOG).map((group) => ({ key: group.key, ids: group.ids }))).toEqual([
      { key: 'milestone:ferry-1-0', ids: ['F2', 'F1'] },
      { key: 'milestone:ferry-2-0', ids: ['F3', 'F4'] },
      { key: 'group', ids: ['F0'] },
    ]);
  });

  it('follows the rank, not the master order: swapping the ranks of F1 and F2 swaps them under Ferry 1.0', () => {
    const rankOf: Record<string, number> = { F1: 1, F2: 3 };
    const swapped: PlanningModel = { ...BACKLOG, features: BACKLOG.features.map((f) => ({ ...f, rank: rankOf[f.id] ?? f.rank })) };
    expect(featureOrder(swapped)[0]?.ids).toEqual(['F1', 'F2']);
  });

  it('carries the milestone name and target, null for the group', () => {
    const [first, , group] = featureOrder(BACKLOG);
    expect(first).toMatchObject({ name: 'Ferry 1.0', target: '2026-04-15' });
    expect(group).toMatchObject({ key: 'group', name: null, target: null });
  });

  it('lists the shares of a milestone its specs hold where the master has no Milestone: line, the rest in the group', () => {
    expect(featureOrder(HARBOR).map((group) => ({ key: group.key, ids: group.ids }))).toEqual([
      { key: 'milestone:harbor-0-9', ids: ['F3'] },
      { key: 'milestone:harbor-1-0', ids: ['F1', 'F2', 'F4'] },
      { key: 'group', ids: ['F0', 'F5', 'F6', 'F7'] },
    ]);
  });

  it('leaves the group out when every feature has a milestone, and is one group without milestones', () => {
    const assigned: PlanningModel = { ...BACKLOG, features: BACKLOG.features.filter((f) => f.id !== 'F0'), unassignedFeatures: [] };
    expect(featureOrder(assigned).map((group) => group.key)).toEqual(['milestone:ferry-1-0', 'milestone:ferry-2-0']);
    const bare: PlanningModel = { ...BACKLOG, milestones: [], unassignedFeatures: BACKLOG.features.map((f) => f.id) };
    expect(featureOrder(bare)).toEqual([{ key: 'group', name: null, target: null, ids: ['F2', 'F3', 'F1', 'F4', 'F0'] }]);
  });
});
