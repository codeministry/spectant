// The dashboard row's open run (spec 070, ISC-570, ISC-572): each spec with an open run (`run-start` without `run-end`
// in `.spectant/activity.jsonl`) carries `run`, its phase as the `/spec` subcommand, its start and its session, the same
// for every subcommand; an `implement` run also carries the newest step on the spec since the run started.
//
// The fixture case is harbor's tree under a synthetic activity log with fixed dates, read through core's own reader.
import { describe, expect, test } from 'bun:test';

import { buildDashboard } from '../src/dashboard.ts';
import type { DashboardModel, DashboardSpecRow } from '../src/dashboard.ts';
import { activityReading } from '../src/locks.ts';
import { readTree } from './helpers/read-tree.ts';

const line = (fields: Record<string, string>): string => JSON.stringify(fields);
const start = (ts: string, run: string, command: string, session: string, spec: string): string => line({ ts, event: 'run-start', run, command, session, spec });
const end = (ts: string, run: string, command: string, session: string, spec: string): string => line({ ts, event: 'run-end', run, command, session, spec, outcome: 'ok' });

/** Open runs on four harbor specs for four subcommands, an older one beside a newer one, an ended run and an init run. */
const RUNS = [
  start('2026-03-09T08:00:00Z', 'r-tasks-003', '/spec-tasks 003', 'a:claude:sess-30', '003-config-loader'),
  start('2026-03-09T09:00:00Z', 'r-plan-003', '/spec plan 003', 'a:claude:sess-31', '003'),
  start('2026-03-09T09:10:00Z', 'r-review-004', '/spec review 004', 'a:claude:sess-41', '004-retention-policies'),
  start('2026-03-09T09:20:00Z', 'r-done-005', '/spec done 005', 'a:claude:sess-51', '005'),
  start('2026-03-09T09:25:00Z', 'r-code-006', '/spec-code-review 006', 'a:claude:sess-61', '006-partial-push'),
  start('2026-03-09T09:30:00Z', 'r-plan-007', '/spec plan 007', 'a:claude:sess-71', '007'),
  end('2026-03-09T09:40:00Z', 'r-plan-007', '/spec plan 007', 'a:claude:sess-71', '007'),
  start('2026-03-09T09:45:00Z', 'r-init', '/spec init', 'a:claude:sess-1', 'init'),
  start('2026-03-09T10:00:00Z', 'r-impl-002', '/spec implement 002', 'a:claude:spec-002', '002'),
];

/** Step lines around 002's implement run: one before its start, the hook's, the builder's, one on another spec's claim. */
const STEPS = [
  line({ ts: '2026-03-09T09:50:00Z', event: 'dispatch', claim: 'ISC-75', task: 'T28', session: 'a:claude:spec-002/T28' }),
  line({ ts: '2026-03-09T10:01:00Z', event: 'dispatch', claim: 'ISC-73', task: 'T26', session: 'a:claude:0f3a9c21' }),
  line({ ts: '2026-03-09T10:02:00Z', event: 'build', claim: 'ISC-73', task: 'T26', session: 'a:claude:0f3a9c21' }),
  line({ ts: '2026-03-09T10:05:00Z', event: 'probe', claim: 'ISC-73', task: 'T26', result: 'red', session: 'a:claude:spec-002/T26' }),
  line({ ts: '2026-03-09T10:06:00Z', event: 'question', claim: 'ISC-73', task: 'T26', text: 'Keep the focus ring?', session: 'a:claude:spec-002/T26' }),
  line({ ts: '2026-03-09T10:08:00Z', event: 'dispatch', claim: 'ISC-81', task: 'T3', session: 'a:claude:0f3a9c21' }),
];

const modelOf = (lines: readonly string[]): DashboardModel => buildDashboard({ ...readTree('harbor'), locks: activityReading(`${lines.join('\n')}\n`) });

function row(m: DashboardModel, id: string): DashboardSpecRow {
  const found = m.specs.find((r) => r.id === id);
  if (!found) throw new Error(`no row ${id}`);
  return found;
}

describe('the open run of a dashboard row (spec 070, ISC-570)', () => {
  const m = modelOf([...RUNS, ...STEPS]);

  test('each spec with an open run carries its phase, start and session, the same for every subcommand', () => {
    expect(row(m, '003').run).toEqual({ run: 'r-plan-003', phase: 'plan', command: '/spec plan 003', since: '2026-03-09T09:00:00Z', session: 'a:claude:sess-31' });
    expect(row(m, '004').run).toEqual({ run: 'r-review-004', phase: 'review', command: '/spec review 004', since: '2026-03-09T09:10:00Z', session: 'a:claude:sess-41' });
    expect(row(m, '005').run).toEqual({ run: 'r-done-005', phase: 'done', command: '/spec done 005', since: '2026-03-09T09:20:00Z', session: 'a:claude:sess-51' });
    expect(row(m, '006').run).toEqual({ run: 'r-code-006', phase: 'review', command: '/spec review 006 code', since: '2026-03-09T09:25:00Z', session: 'a:claude:sess-61' });
    expect(row(m, '002').run).toMatchObject({ run: 'r-impl-002', phase: 'implement', command: '/spec implement 002', since: '2026-03-09T10:00:00Z', session: 'a:claude:spec-002' });
  });

  test('an ended run, the init run and a spec without a run leave the row without `run`', () => {
    for (const id of ['007', '008', '009']) expect('run' in row(m, id)).toBe(false);
  });

  test('a log without run lines and a model without a lock reading carry no `run` on any row', () => {
    for (const r of modelOf(STEPS).specs) expect('run' in r).toBe(false);
    for (const r of buildDashboard(readTree('harbor')).specs) expect('run' in r).toBe(false);
  });

  test('a run that is not implement carries no step, even with step lines on its claims', () => {
    expect('step' in (row(m, '003').run ?? {})).toBe(false);
  });
});

describe('the newest step of an implement run (spec 070, ISC-572)', () => {
  test('the newest dispatch, build, patch, apply or probe on the spec since the run started, a question not counted', () => {
    const m = modelOf([...RUNS, ...STEPS]);
    expect(row(m, '002').run?.step).toEqual({ kind: 'probe', at: '2026-03-09T10:05:00Z', task: 'T26', claim: 'ISC-73', session: 'a:claude:spec-002/T26', result: 'red' });
  });

  test("a hook's step under another session counts when it names the spec's claim", () => {
    const m = modelOf([...RUNS, ...STEPS.slice(0, 3)]);
    expect(row(m, '002').run?.step).toEqual({ kind: 'build', at: '2026-03-09T10:02:00Z', task: 'T26', claim: 'ISC-73', session: 'a:claude:0f3a9c21' });
  });

  test('a claimless step counts when its spec session names the spec; a patch and an apply read as such', () => {
    const extra = [
      line({ ts: '2026-03-09T10:10:00Z', event: 'patch', task: 'T26', session: 'a:claude:spec-002', worktree: '.worktrees/002-web-console' }),
      line({ ts: '2026-03-09T10:11:00Z', event: 'apply', task: 'T26', session: 'a:claude:spec-003', worktree: '.worktrees/003-config-loader' }),
    ];
    const m = modelOf([...RUNS, ...STEPS, ...extra]);
    expect(row(m, '002').run?.step).toEqual({ kind: 'patch', at: '2026-03-09T10:10:00Z', task: 'T26', session: 'a:claude:spec-002' });
  });

  test('an implement run without a step since its start carries no step', () => {
    const m = modelOf([...RUNS, STEPS[0] ?? '']);
    expect(row(m, '002').run?.phase).toBe('implement');
    expect('step' in (row(m, '002').run ?? {})).toBe(false);
  });
});
