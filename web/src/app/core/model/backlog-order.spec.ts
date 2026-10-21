import type { PlanningModel } from '../../../../../core/src/planning';
import backlogGolden from '../../../../../core/fixtures/backlog-ranks.planning.golden.json';
import harborGolden from '../../../../../core/fixtures/harbor.planning.golden.json';
import { beforeFor, edgeBefore, gapsFor, groupOf, positionOf, stepBefore } from './backlog-order';
import { featureOrder, type FeatureGroup } from './feature-order';

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

// T15, T16 · ISC-195, ISC-195.1: where a feature may land when it is dragged or moved with Alt+↑/↓, and the `before`
// the backlog route (spec 036) receives for it. A drop lands only in the feature's own milestone, or in the "No
// milestone" group, and never next to itself; a step or an edge move at the edge sends nothing (`'none'`), because
// the route refuses a move that changes nothing.
describe('backlog gaps (T15, T16, ISC-195, ISC-195.1)', () => {
  const backlog = featureOrder(BACKLOG);
  const harbor = featureOrder(HARBOR);
  const FERRY_1 = 'milestone:ferry-1-0';
  const FERRY_2 = 'milestone:ferry-2-0';
  const HARBOR_1 = 'milestone:harbor-1-0';
  const five: readonly FeatureGroup[] = [
    { key: 'milestone:m', name: 'M', target: null, ids: ['A', 'B', 'C', 'D', 'E'] },
    { key: 'group', name: null, target: null, ids: ['X'] },
  ];

  it('finds a group by its key, undefined for an unknown key', () => {
    expect(groupOf(backlog, FERRY_2)?.ids).toEqual(['F3', 'F4']);
    expect(groupOf(backlog, 'group')?.ids).toEqual(['F0']);
    expect(groupOf(backlog, 'milestone:nowhere')).toBeUndefined();
  });

  it('offers every gap of the own group but the two around the feature itself', () => {
    expect(gapsFor(five, 'milestone:m', 'A')).toEqual([2, 3, 4, 5]);
    expect(gapsFor(five, 'milestone:m', 'C')).toEqual([0, 1, 4, 5]);
    expect(gapsFor(five, 'milestone:m', 'E')).toEqual([0, 1, 2, 3]);
    expect(gapsFor(harbor, HARBOR_1, 'F2')).toEqual([0, 3]);
    expect(gapsFor(harbor, 'group', 'F0')).toEqual([2, 3, 4]);
    expect(gapsFor(harbor, 'group', 'F7')).toEqual([0, 1, 2]);
  });

  it('gives the before of each gap: the feature in front of which it lands, null for the end', () => {
    expect([2, 3, 4, 5].map((gap) => beforeFor(five, 'milestone:m', 'A', gap))).toEqual(['C', 'D', 'E', null]);
    expect([0, 1, 4, 5].map((gap) => beforeFor(five, 'milestone:m', 'C', gap))).toEqual(['A', 'B', 'E', null]);
    expect(beforeFor(backlog, FERRY_1, 'F2', 2)).toBeNull();
    expect(beforeFor(backlog, FERRY_1, 'F1', 0)).toBe('F2');
    expect(beforeFor(harbor, 'group', 'F7', 1)).toBe('F5');
  });

  it('is no move next to the feature itself or outside the gaps of its group', () => {
    expect(beforeFor(five, 'milestone:m', 'C', 2)).toBe('none');
    expect(beforeFor(five, 'milestone:m', 'C', 3)).toBe('none');
    expect(beforeFor(five, 'milestone:m', 'C', -1)).toBe('none');
    expect(beforeFor(five, 'milestone:m', 'C', 6)).toBe('none');
    expect(beforeFor(five, 'milestone:m', 'C', 1.5)).toBe('none');
  });

  it('has no gap in another milestone, and none outside the "No milestone" group for a feature of it', () => {
    expect(gapsFor(backlog, FERRY_2, 'F2')).toEqual([]);
    expect(beforeFor(backlog, FERRY_2, 'F2', 0)).toBe('none');
    expect(gapsFor(backlog, 'group', 'F1')).toEqual([]);
    expect(gapsFor(backlog, FERRY_1, 'F0')).toEqual([]);
    expect(beforeFor(backlog, FERRY_1, 'F0', 0)).toBe('none');
    expect(gapsFor(harbor, HARBOR_1, 'F5')).toEqual([]);
    expect(gapsFor(harbor, 'group', 'F1')).toEqual([]);
    expect(gapsFor(backlog, 'milestone:nowhere', 'F1')).toEqual([]);
  });

  it('gives F0, alone in its group, no gap and no move at all', () => {
    expect(gapsFor(backlog, 'group', 'F0')).toEqual([]);
    expect(stepBefore(backlog, 'group', 'F0', -1)).toBe('none');
    expect(stepBefore(backlog, 'group', 'F0', 1)).toBe('none');
    expect(edgeBefore(backlog, 'group', 'F0', 'first')).toBe('none');
    expect(edgeBefore(backlog, 'group', 'F0', 'last')).toBe('none');
  });

  it('swaps with the upper neighbour on Alt+↑ and with the lower on Alt+↓, null when it becomes the last', () => {
    expect(stepBefore(five, 'milestone:m', 'C', -1)).toBe('B');
    expect(stepBefore(five, 'milestone:m', 'C', 1)).toBe('E');
    expect(stepBefore(five, 'milestone:m', 'D', 1)).toBeNull();
    expect(stepBefore(five, 'milestone:m', 'B', -1)).toBe('A');
    expect(stepBefore(backlog, FERRY_1, 'F2', 1)).toBeNull();
    expect(stepBefore(backlog, FERRY_1, 'F1', -1)).toBe('F2');
    expect(stepBefore(harbor, HARBOR_1, 'F2', -1)).toBe('F1');
    expect(stepBefore(harbor, HARBOR_1, 'F2', 1)).toBeNull();
  });

  it('sends nothing on Alt+↑ at the first or Alt+↓ at the last feature of a milestone or of the group', () => {
    expect(stepBefore(five, 'milestone:m', 'A', -1)).toBe('none');
    expect(stepBefore(five, 'milestone:m', 'E', 1)).toBe('none');
    expect(stepBefore(backlog, FERRY_2, 'F3', -1)).toBe('none');
    expect(stepBefore(backlog, FERRY_2, 'F4', 1)).toBe('none');
    expect(stepBefore(harbor, 'group', 'F0', -1)).toBe('none');
    expect(stepBefore(harbor, 'group', 'F7', 1)).toBe('none');
    expect(stepBefore(harbor, HARBOR_1, 'F1', -1)).toBe('none');
    expect(stepBefore(harbor, HARBOR_1, 'F4', 1)).toBe('none');
  });

  it('steps nothing in a group the feature is not in', () => {
    expect(stepBefore(backlog, FERRY_2, 'F1', -1)).toBe('none');
    expect(stepBefore(harbor, 'group', 'F2', 1)).toBe('none');
  });

  it('moves to the start or the end of its group, none when it already stands there', () => {
    expect(edgeBefore(five, 'milestone:m', 'C', 'first')).toBe('A');
    expect(edgeBefore(five, 'milestone:m', 'C', 'last')).toBeNull();
    expect(edgeBefore(five, 'milestone:m', 'A', 'first')).toBe('none');
    expect(edgeBefore(five, 'milestone:m', 'E', 'last')).toBe('none');
    expect(edgeBefore(five, 'milestone:m', 'A', 'last')).toBeNull();
    expect(edgeBefore(five, 'milestone:m', 'E', 'first')).toBe('A');
    expect(edgeBefore(harbor, 'group', 'F6', 'first')).toBe('F0');
    expect(edgeBefore(backlog, FERRY_1, 'F0', 'first')).toBe('none');
  });

  it('agrees with the gaps: every step and edge move is a drop the group allows', () => {
    for (const id of ['A', 'B', 'C', 'D', 'E']) {
      const drops = gapsFor(five, 'milestone:m', id).map((gap) => beforeFor(five, 'milestone:m', id, gap));
      for (const target of [stepBefore(five, 'milestone:m', id, -1), stepBefore(five, 'milestone:m', id, 1)]) {
        if (target !== 'none') expect(drops).toContain(target);
      }
      for (const target of [edgeBefore(five, 'milestone:m', id, 'first'), edgeBefore(five, 'milestone:m', id, 'last')]) {
        if (target !== 'none') expect(drops).toContain(target);
      }
    }
  });

  it('reports the 1-based position and the count in the group, null outside it', () => {
    expect(positionOf(harbor, 'group', 'F5')).toEqual({ index: 2, count: 4 });
    expect(positionOf(backlog, FERRY_1, 'F1')).toEqual({ index: 2, count: 2 });
    expect(positionOf(backlog, 'group', 'F0')).toEqual({ index: 1, count: 1 });
    expect(positionOf(backlog, FERRY_2, 'F1')).toBeNull();
    expect(positionOf(backlog, 'milestone:nowhere', 'F1')).toBeNull();
  });
});
