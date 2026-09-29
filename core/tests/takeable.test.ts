// The takeable task set (spec 001 T38, ISC-16): which tasks the next round may dispatch and why the others are held,
// in the old SpecRun `plan()` vocabulary. The parity case rebuilds spectant-001's board before round 1 from
// `rounds.jsonl` line 1 (every task open, every claim open) and expects the same dispatch, T1–T4, and the same hold
// reason on every other task. The synthetic cases cover the reasons that round never produced.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parseClaims, type Claim } from '../src/claims.ts';
import type { ClaimLock, TasksModel, TaskView } from '../src/files.ts';
import { parseFrontmatter } from '../src/frontmatter.ts';
import { takeableSet } from '../src/takeable.ts';

const FIXTURES = join(import.meta.dir, '..', 'fixtures');
const read = (rel: string) => readFileSync(join(FIXTURES, rel), 'utf8');

interface RoundTask {
  readonly id: string;
  readonly claim: string;
  readonly lane: string;
  readonly seam: boolean;
  readonly parallel: boolean;
  readonly paths: readonly string[];
  readonly state: string;
  readonly reason: string;
}

interface RoundLine {
  readonly width: number;
  readonly dispatched: readonly string[];
  readonly tasks: readonly RoundTask[];
}

/**
 * The round line does not carry the task edges, but before round 1 every task was open, so each `after … still
 * open` reason names all of a task's edges and each `behind open seam …` names its seam edges. The edges a seam
 * reason leaves out are ordinary open tasks: they would not change the reason, which the seam check wins.
 */
function edgesFrom(reason: string): string[] {
  const m = /^(?:after (.+) still open|behind open seam (.+))$/.exec(reason);
  return (m?.[1] ?? m?.[2] ?? '').split(/,\s*/).filter((id) => id !== '');
}

function task(partial: Partial<TaskView> & Pick<TaskView, 'id' | 'claim'>, line: number): TaskView {
  return {
    flags: { parallel: false, seam: false },
    lane: 'core',
    state: 'open',
    edges: [],
    paths: [],
    text: '',
    line,
    ...partial,
  };
}

function claim(id: string, extra: Partial<Claim> = {}): Claim {
  return {
    id,
    checked: false,
    kind: 'normal',
    text: id,
    raw: id,
    after: [],
    marks: [],
    dropped: false,
    droppedNote: null,
    feature: null,
    indent: 0,
    line: 1,
    ...extra,
  };
}

const model = (tasks: TaskView[]): TasksModel => ({ tasks, probeMapping: [] });

describe('spectant-001 round 1 parity', () => {
  const dir = 'spectant-001/specs/001-app-skeleton';
  const line = JSON.parse(read(`${dir}/rounds.jsonl`).split('\n')[0] ?? '') as RoundLine;
  const tasks = line.tasks.map((t, i) =>
    task(
      {
        id: t.id,
        claim: t.claim,
        lane: t.lane,
        flags: { parallel: t.parallel, seam: t.seam },
        edges: edgesFrom(t.reason),
        paths: t.paths,
      },
      i + 1,
    ),
  );
  // Round 1 started with every claim open: the frozen spec.md's claims and edges, every box unchecked.
  const claims = parseClaims(read(`${dir}/spec.md`)).claims.map((c) => ({ ...c, checked: false }));
  const plan = takeableSet({ specType: 'feature', claims, tasks: model(tasks), width: line.width });

  test('dispatches what rounds.jsonl line 1 dispatched: T1–T4', () => {
    expect(line.dispatched).toEqual(['T1', 'T2', 'T3', 'T4']);
    expect(plan.dispatch.map((d) => d.task)).toEqual([...line.dispatched]);
    expect(plan.dispatch.every((d) => d.reason === '[P], claim takeable, edges closed')).toBe(true);
  });

  test('holds every other task for the reason the round recorded', () => {
    const recorded = Object.fromEntries(line.tasks.filter((t) => t.state === 'held').map((t) => [t.id, t.reason]));
    const planned = Object.fromEntries(plan.held.map((h) => [h.task, h.reason]));
    expect(planned).toEqual(recorded);
  });

  test('counts, width and the takeable claims', () => {
    expect(plan.width).toBe(4);
    expect(plan.tasks).toEqual({ landed: 0, total: line.tasks.length });
    expect(plan.exhausted).toBe(false);
    expect(plan.claims).toContain('ISC-8');
    expect(plan.claims).not.toContain('ISC-8.1');
  });
});

describe('the frozen spectant-001 claims', () => {
  test('width defaults to 4 for a feature and to 1 for bug, spike and infra', () => {
    const spec = read('spectant-001/specs/001-app-skeleton/spec.md');
    const claims = parseClaims(spec).claims;
    const type = parseFrontmatter(spec).data.specType;
    expect(takeableSet({ specType: type, claims, tasks: null }).width).toBe(4);
    for (const t of ['bug', 'spike', 'infra'] as const) expect(takeableSet({ specType: t, claims, tasks: null }).width).toBe(1);
    expect(takeableSet({ specType: 'feature', claims, tasks: null, width: 2 }).width).toBe(2);
  });
});

describe('without tasks.md the open claims are the units', () => {
  test('lantern 002 (bug, no tasks.md): one claim unit per round, C-numbered', () => {
    const claims = parseClaims(read('lantern/specs/002-duplicate-links/spec.md')).claims;
    const open = claims.filter((c) => !c.checked && !c.dropped);
    const plan = takeableSet({ specType: 'bug', claims, tasks: null });
    expect(plan.width).toBe(1);
    expect(plan.tasks.total).toBe(open.length);
    expect(plan.dispatch).toHaveLength(Math.min(1, plan.claims.length));
    expect(plan.dispatch[0]?.task).toMatch(/^C\d+$/);
    for (const h of plan.held) expect(h.task).toMatch(/^C\d+$/);
  });

  test('every claim closed: nothing left, exhausted', () => {
    const plan = takeableSet({ specType: 'bug', claims: [claim('ISC-1', { checked: true })], tasks: null });
    expect(plan.dispatch).toEqual([]);
    expect(plan.held).toEqual([]);
    expect(plan.tasks).toEqual({ landed: 0, total: 0 });
    expect(plan.exhausted).toBe(true);
  });
});

describe('the hold vocabulary', () => {
  test('a seam runs alone before its fan-out; the rest wait for next round', () => {
    const plan = takeableSet({
      specType: 'feature',
      claims: [claim('ISC-1')],
      tasks: model([
        task({ id: 'T1', claim: 'ISC-1', flags: { parallel: false, seam: true } }, 1),
        task({ id: 'T2', claim: 'ISC-1', flags: { parallel: true, seam: false } }, 2),
        task({ id: 'T3', claim: 'ISC-1', flags: { parallel: false, seam: true } }, 3),
      ]),
    });
    expect(plan.dispatch).toEqual([{ task: 'T1', claim: 'ISC-1', reason: 'seam — runs alone before its fan-out' }]);
    expect(plan.held).toEqual([
      { task: 'T2', claim: 'ISC-1', reason: 'T1 owns this round (seam)' },
      { task: 'T3', claim: 'ISC-1', reason: 'seam — runs alone, next round' },
    ]);
  });

  test('a task without [P] owns the round; a later one without [P] runs alone next round', () => {
    const plan = takeableSet({
      specType: 'feature',
      claims: [claim('ISC-1')],
      tasks: model([
        task({ id: 'T1', claim: 'ISC-1' }, 1),
        task({ id: 'T2', claim: 'ISC-1', flags: { parallel: true, seam: false } }, 2),
        task({ id: 'T3', claim: 'ISC-1' }, 3),
      ]),
    });
    expect(plan.dispatch).toEqual([{ task: 'T1', claim: 'ISC-1', reason: 'claim takeable, edges closed' }]);
    expect(plan.held.map((h) => h.reason)).toEqual(['T1 owns this round (not [P])', 'not [P] — runs alone, next round']);
  });

  test('same file, closed claim, blocked claim, locked claim, operator lane, open edge, struck and done tasks', () => {
    const locks: ClaimLock[] = [{ source: 'activity', claim: 'ISC-4', session: 'wt-7', since: '2026-03-08T10:00:00Z' }];
    const plan = takeableSet({
      specType: 'feature',
      claims: [claim('ISC-1'), claim('ISC-2', { checked: true }), claim('ISC-3', { after: ['ISC-1'] }), claim('ISC-4')],
      locks,
      tasks: model([
        task({ id: 'T1', claim: 'ISC-1', flags: { parallel: true, seam: false }, paths: ['a.ts'] }, 1),
        task({ id: 'T2', claim: 'ISC-1', flags: { parallel: true, seam: false }, paths: ['b.ts', 'a.ts'] }, 2),
        task({ id: 'T3', claim: 'ISC-2', flags: { parallel: true, seam: false } }, 3),
        task({ id: 'T4', claim: 'ISC-3', flags: { parallel: true, seam: false } }, 4),
        task({ id: 'T5', claim: 'ISC-4', flags: { parallel: true, seam: false } }, 5),
        task({ id: 'T6', claim: 'ISC-1', lane: 'operator' }, 6),
        task({ id: 'T7', claim: 'ISC-1', flags: { parallel: true, seam: false }, edges: ['T1', 'T8'] }, 7),
        task({ id: 'T8', claim: 'ISC-1', state: 'done' }, 8),
        task({ id: 'T9', claim: 'ISC-1', state: 'struck' }, 9),
        task({ id: 'T10', claim: 'ISC-9', flags: { parallel: true, seam: false } }, 10),
      ]),
    });
    expect(plan.dispatch.map((d) => d.task)).toEqual(['T1']);
    expect(plan.held).toEqual([
      { task: 'T2', claim: 'ISC-1', reason: 'same file as a task already in this round: a.ts' },
      { task: 'T3', claim: 'ISC-2', reason: 'claim already closed — task should be [x]; strike or check it' },
      { task: 'T4', claim: 'ISC-3', reason: 'claim blocked by ISC-1' },
      { task: 'T5', claim: 'ISC-4', reason: 'claim locked by wt-7' },
      { task: 'T6', claim: 'ISC-1', reason: "operator lane — the principal's own action, never auto-dispatched" },
      { task: 'T7', claim: 'ISC-1', reason: 'after T1 still open' },
      { task: 'T10', claim: 'ISC-9', reason: 'claim unknown to the spec' },
    ]);
    // A struck task is gone from the board; a done task counts as landed.
    expect(plan.tasks).toEqual({ landed: 1, total: 9 });
    expect(plan.claims).toEqual(['ISC-1']);
    expect(plan.exhausted).toBe(false);
  });

  test('a width reached holds the rest', () => {
    const tasks = ['T1', 'T2', 'T3'].map((id, i) => task({ id, claim: 'ISC-1', flags: { parallel: true, seam: false } }, i + 1));
    const plan = takeableSet({ specType: 'feature', claims: [claim('ISC-1')], tasks: model(tasks), width: 2 });
    expect(plan.dispatch.map((d) => d.task)).toEqual(['T1', 'T2']);
    expect(plan.held).toEqual([{ task: 'T3', claim: 'ISC-1', reason: 'width 2 reached' }]);
  });

  test('only operator and blocked work left: exhausted, a round cannot change it', () => {
    const plan = takeableSet({
      specType: 'feature',
      claims: [claim('ISC-1'), claim('ISC-2', { after: ['ISC-1'] })],
      tasks: model([
        task({ id: 'T1', claim: 'ISC-1', lane: 'operator' }, 1),
        task({ id: 'T2', claim: 'ISC-2' }, 2),
      ]),
    });
    expect(plan.dispatch).toEqual([]);
    expect(plan.exhausted).toBe(true);
  });
});
