// The Gantt lens (spec 038, ISC-202 and ISC-202.1): `planningGantt` over the planning model on a fixed cut-off day.
// Probes by name: "gantt" (each fixture's model equals its `<tree>.gantt.golden.json`, which golden.test.ts compares;
// here the derivation from the planning golden equals the one from the tree, no spec appears, the group and lane
// order, the windows and the empty axis) and "gantt late" (milestones before the cut-off day share the past segment by
// date, `late` marked overdue and `complete` done, their lanes alike, the first window after them from `asOf`).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import * as core from '../src/index.ts';
import type { GanttGroup, GanttInput, GanttModel, PlanningModel } from '../src/index.ts';
import { goldenPath } from './helpers/golden.ts';
import { PLANNING_NOW, planningOf } from './helpers/planning-model.ts';
import { fixtureTrees } from './helpers/read-tree.ts';

const goldenModel = (tree: string): PlanningModel => JSON.parse(readFileSync(goldenPath(tree, 'planning'), 'utf8')) as PlanningModel;
const ganttOf = (tree: string): GanttModel => core.planningGantt(planningOf(tree), PLANNING_NOW);

/** Every string in a JSON value, keys included. */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

const summary = (g: GanttGroup): unknown => ({ ref: g.ref, window: g.window, from: g.from, to: g.to, mark: g.mark, lanes: g.lanes.map((l) => l.id) });

describe('gantt', () => {
  test('gantt: buildPlanning carries the day it derived the milestone states with as asOf', () => {
    expect(planningOf('harbor').asOf).toBe(PLANNING_NOW);
    expect(core.buildPlanning({ master: null, specs: [], archived: [], now: '2027-01-02' }).asOf).toBe('2027-01-02');
  });

  test.each(fixtureTrees())('gantt: %s derives the same model from its planning golden as from the tree, on the golden asOf', (tree) => {
    const golden = goldenModel(tree);
    expect(golden.asOf).toBe(PLANNING_NOW);
    expect(core.planningGantt(golden, golden.asOf)).toEqual(ganttOf(tree));
  });

  test.each(fixtureTrees())('gantt: %s holds no spec, one lane per feature block, every block exactly once', (tree) => {
    const model = planningOf(tree);
    const gantt = ganttOf(tree);
    expect(strings(gantt).filter((s) => s.startsWith('spec:') || s === 'specs' || s === 'holders')).toEqual([]);
    const lanes = gantt.groups.flatMap((g) => g.lanes.map((l) => l.id));
    expect(lanes.toSorted()).toEqual(model.features.map((f) => f.id).toSorted());
    expect(new Set(lanes).size).toBe(lanes.length);
  });

  test.each(fixtureTrees())('gantt: %s lanes stand in rank order within each group, with closed/total and priority of their block', (tree) => {
    const model = planningOf(tree);
    const byId = new Map(model.features.map((f) => [f.id, f]));
    for (const group of ganttOf(tree).groups) {
      expect(group.lanes.map((l) => l.rank)).toEqual(group.lanes.map((l) => l.rank).toSorted((a, b) => a - b));
      for (const lane of group.lanes) {
        const f = byId.get(lane.id);
        if (f === undefined) throw new Error(`no feature block ${lane.id}`);
        const { closed, total, priority, rank, name } = f;
        expect({ ref: lane.ref, name: lane.name, closed: lane.closed, total: lane.total, priority: lane.priority, rank: lane.rank }).toEqual({ ref: `feature:${lane.id}`, name, closed, total, priority, rank });
      }
    }
  });

  test('gantt: backlog-ranks has two windows in date order from asOf, the no-milestone group last without a bar', () => {
    const gantt = ganttOf('backlog-ranks');
    expect(gantt.groups.map(summary)).toEqual([
      { ref: 'milestone:ferry-1-0', window: 'span', from: 0, to: 26, mark: null, lanes: ['F2', 'F1'] },
      { ref: 'milestone:ferry-2-0', window: 'span', from: 26, to: 102, mark: null, lanes: ['F3', 'F4'] },
      { ref: null, window: 'none', from: null, to: null, mark: null, lanes: ['F0'] },
    ]);
    expect(gantt.axis).toEqual({
      asOf: '2026-03-20',
      end: '2026-06-30',
      days: 102,
      past: false,
      months: [
        { month: '2026-03', from: 0, days: 12 },
        { month: '2026-04', from: 12, days: 30 },
        { month: '2026-05', from: 42, days: 31 },
        { month: '2026-06', from: 73, days: 29 },
      ],
    });
    const none = gantt.groups.at(-1);
    expect({ name: none?.name, target: none?.target, state: none?.state, closed: none?.closed, total: none?.total }).toEqual({ name: null, target: null, state: null, closed: 0, total: 2 });
  });

  test('gantt: a milestone group carries its own name, target, state and progress', () => {
    const model = planningOf('backlog-ranks');
    const first = ganttOf('backlog-ranks').groups[0];
    const m = model.milestones[0];
    expect({ name: first?.name, target: first?.target, state: first?.state, closed: first?.closed, total: first?.total }).toEqual({ name: m?.name, target: m?.target, state: m?.state, closed: m?.closed, total: m?.total });
  });

  test('gantt: without a dated milestone the axis is null and every feature stands in the no-milestone group', () => {
    for (const tree of ['lantern', 'empty-master', 'leadgen', 'spectant-001']) {
      const gantt = ganttOf(tree);
      expect(gantt.axis).toBeNull();
      expect(gantt.groups.map((g) => g.ref)).toEqual([null]);
      expect(gantt.groups[0]?.lanes.map((l) => l.id)).toEqual(planningOf(tree).features.map((f) => f.id));
    }
    expect(core.planningGantt(core.buildPlanning({ master: null, specs: [], archived: [], now: PLANNING_NOW }), PLANNING_NOW)).toEqual({ asOf: PLANNING_NOW, axis: null, groups: [] });
  });

  test('gantt: an undated milestone stands after the dated ones, before the no-milestone group, without a window', () => {
    const feature = (id: string, rank: number): GanttInput['features'][number] =>
      ({ id, name: id, why: null, rank, priority: 'P3', closed: 1, total: 2, claims: [], holders: [], unheld: [], ideas: [] });
    const milestone = (name: string, target: string | null, featureIds: string[]): GanttInput['milestones'][number] =>
      ({ name, slug: name.toLowerCase(), target, description: null, closed: 0, total: 0, state: 'upcoming', featureIds, features: [], specs: [], ideas: [] });
    const input: GanttInput = {
      features: [feature('F1', 1), feature('F2', 2), feature('F3', 3)],
      milestones: [milestone('Later', null, ['F2']), milestone('Soon', '2026-04-01', ['F1'])],
      unassignedFeatures: ['F3'],
    };
    expect(core.planningGantt(input, PLANNING_NOW).groups.map(summary)).toEqual([
      { ref: 'milestone:soon', window: 'span', from: 0, to: 12, mark: null, lanes: ['F1'] },
      { ref: 'milestone:later', window: 'none', from: null, to: null, mark: null, lanes: ['F2'] },
      { ref: null, window: 'none', from: null, to: null, mark: null, lanes: ['F3'] },
    ]);
  });

  test('gantt: harbor names its two milestones without features (no Milestone: lines), every block without a milestone', () => {
    const gantt = ganttOf('harbor');
    expect(gantt.groups.map((g) => [g.ref, g.window, g.lanes.length])).toEqual([
      ['milestone:harbor-0-9', 'past', 0],
      ['milestone:harbor-1-0', 'span', 0],
      [null, 'none', 8],
    ]);
  });
});

/** A master with four dated milestones around the cut-off day 2026-03-20, one feature block on each, plus one without. */
const LATE_MASTER = `---
task: "Gantt late"
slug: gantt-late
phase: climbing
progress: 2/6
---

# Gantt late

## Features

### F0 · Without a milestone
Why: not dated.

- [ ] ISC-1: Open.

### F1 · Shipped early
Why: done before the cut-off day.
Milestone: Alpha

- [x] ISC-2: Closed.

### F2 · Running late
Why: open past its target.
Milestone: Beta

- [ ] ISC-3: Open.

### F3 · Later still late
Why: open past a newer target.
Milestone: Gamma

- [x] ISC-4: Closed.
- [ ] ISC-5: Open.

### F4 · Ahead
Why: due after the cut-off day.
Milestone: Delta

- [ ] ISC-6: Open.

## Milestones

- Gamma · 2026-03-18 · Late, the newer of the two.
- Delta · 2026-04-09 · Ahead.
- Alpha · 2026-02-27 · Complete.
- Beta · 2026-03-01 · Late, the older of the two.
`;

describe('gantt late', () => {
  const model = core.buildPlanning({ master: LATE_MASTER, specs: [], archived: [], now: PLANNING_NOW });
  const gantt = core.planningGantt(model, model.asOf);

  test('gantt late: the inline master derives two late milestones and one complete one before the cut-off day', () => {
    expect(model.milestones.map((m) => [m.name, m.target, m.state])).toEqual([
      ['Alpha', '2026-02-27', 'complete'],
      ['Beta', '2026-03-01', 'late'],
      ['Gamma', '2026-03-18', 'late'],
      ['Delta', '2026-04-09', 'upcoming'],
    ]);
  });

  test('gantt late: milestones before asOf stand by date in the past segment at the axis start, late overdue, complete done', () => {
    expect(gantt.groups.map(summary)).toEqual([
      { ref: 'milestone:alpha', window: 'past', from: null, to: null, mark: 'done', lanes: ['F1'] },
      { ref: 'milestone:beta', window: 'past', from: null, to: null, mark: 'overdue', lanes: ['F2'] },
      { ref: 'milestone:gamma', window: 'past', from: null, to: null, mark: 'overdue', lanes: ['F3'] },
      { ref: 'milestone:delta', window: 'span', from: 0, to: 20, mark: null, lanes: ['F4'] },
      { ref: null, window: 'none', from: null, to: null, mark: null, lanes: ['F0'] },
    ]);
  });

  test('gantt late: each lane carries its group mark, and only the past groups mark', () => {
    expect(gantt.groups.flatMap((g) => g.lanes.map((l) => [l.id, l.mark]))).toEqual([
      ['F1', 'done'],
      ['F2', 'overdue'],
      ['F3', 'overdue'],
      ['F4', null],
      ['F0', null],
    ]);
  });

  test('gantt late: the axis flags the past segment and runs from asOf to the latest target; the first window starts at asOf', () => {
    expect(gantt.axis).toEqual({ asOf: PLANNING_NOW, end: '2026-04-09', days: 20, past: true, months: [{ month: '2026-03', from: 0, days: 12 }, { month: '2026-04', from: 12, days: 8 }] });
    expect(gantt.groups.find((g) => g.window === 'span')?.from).toBe(0);
  });

  test('gantt late: with every milestone before asOf the axis is zero days long, still flagged past, without months', () => {
    const after = core.planningGantt(model, '2026-05-01');
    expect(after.axis).toEqual({ asOf: '2026-05-01', end: '2026-05-01', days: 0, past: true, months: [] });
    expect(after.groups.filter((g) => g.window === 'past').map((g) => g.ref)).toEqual(['milestone:alpha', 'milestone:beta', 'milestone:gamma', 'milestone:delta']);
  });

  test('gantt late: milestone-lines puts its complete Beacon 0.5 into the past segment, marked done', () => {
    const first = ganttOf('milestone-lines').groups[0];
    expect(first === undefined ? null : summary(first)).toEqual({ ref: 'milestone:beacon-0-5', window: 'past', from: null, to: null, mark: 'done', lanes: ['F1'] });
  });
});
