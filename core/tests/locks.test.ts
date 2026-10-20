// The holder of a lock in the actor grammar (spec 008, T63, ISC-119). `readLockSources` runs every `session` it reads
// through `parseActor` and carries the result as `ClaimLock.actor`; a session outside the grammar is legacy: read,
// counted like any other, and flagged with one `actor-legacy` warning per file — once for `.spectant/activity.jsonl`,
// at its first legacy line, and once per frontier lock file. Harbor's log carries only grammar sessions.
//
// The run events (spec 027, ISC-179): `dispatch`, `build`, `patch` and `apply` beside `claim` and `release`, folded per
// task into its last run state; an unknown event is one `activity-event-unknown` warning per file (`activity-events`).
// Since spec 035 (ISC-189) `dispatch` and `build` may name no worktree; `patch` and `apply` still require one.
//
// Every tree here is a fresh temp dir with synthetic sessions; no real state directory or session enters the tree.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseActor } from '../src/actor.ts';
import { buildDashboard } from '../src/dashboard.ts';
import type { LockReading, RunState, TaskRun } from '../src/files.ts';
import { DEFAULT_ABORT_AFTER_MS, itemStates } from '../src/item-state.ts';
import { taskRunsOf } from '../src/live.ts';
import { readLockSources } from '../src/locks.ts';
import { parseTaskLines } from '../src/tasks.ts';
import { FIXTURES, readTreeAt } from './helpers/read-tree.ts';

const HARBOR = join(FIXTURES, 'harbor');
const NOW = new Date('2026-03-08T16:00:00Z');

const temps: string[] = [];
afterAll(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `spectant-actor-locks-${label}-`));
  temps.push(dir);
  return dir;
}

function tempRepo(activity?: readonly object[]): string {
  const repo = tempDir('repo');
  cpSync(join(HARBOR, 'ISA.md'), join(repo, 'ISA.md'));
  if (activity !== undefined) {
    mkdirSync(join(repo, '.spectant'));
    writeFileSync(join(repo, '.spectant', 'activity.jsonl'), activity.map((l) => `${JSON.stringify(l)}\n`).join(''));
  }
  return repo;
}

function stateWithLocks(repo: string, sessions: Record<string, string>): string {
  const state = tempDir('state');
  const isa = join(repo, 'ISA.md');
  const dir = join(state, 'isa-locks', createHash('sha1').update(realpathSync(isa)).digest('hex').slice(0, 16));
  mkdirSync(dir, { recursive: true });
  for (const [claim, session] of Object.entries(sessions)) {
    writeFileSync(join(dir, `${claim}.lock`), `${JSON.stringify({ session, ts: '2026-03-08T15:30:00.000Z', isa })}\n`);
  }
  return state;
}

const claimLine = (claim: string, session: string, ts: string) => ({ ts, event: 'claim', claim, session });

describe('ClaimLock.actor: the session in the actor grammar', () => {
  test('harbor: every activity lock carries its session parsed, none legacy, no actor-legacy', async () => {
    const r = await readLockSources({ repoRoot: HARBOR });
    expect(r.locks).toEqual([
      { source: 'activity', claim: 'ISC-74', session: 'a:claude:sess-2', actor: parseActor('a:claude:sess-2'), since: '2026-03-08T14:06:00Z' },
    ]);
    expect(r.locks[0]?.actor).toEqual({ raw: 'a:claude:sess-2', kind: 'agent', id: 'a:claude:sess-2', legacy: false });
    // Harbor's one diagnostic is its unknown run event (spec 027, `activity-events` below), never an actor-legacy.
    expect(r.diagnostics?.filter((d) => d.code === 'actor-legacy')).toEqual([]);
  });

  test('a sub-agent session reads as the sub-agent of its session on the task', async () => {
    const repo = tempRepo([claimLine('ISC-53', 'a:claude:sess-2/T4', '2026-03-06T09:12:00Z')]);
    const r = await readLockSources({ repoRoot: repo });
    expect(r.locks.map((l) => l.actor)).toEqual([{ raw: 'a:claude:sess-2/T4', kind: 'subagent', id: 'a:claude:sess-2', task: 'T4', legacy: false }]);
    expect(r.diagnostics).toEqual([]);
  });
});

describe('legacy sessions: one actor-legacy warning per file, the value still read', () => {
  test('legacy: the activity log warns once, at its first legacy line and claim, and every lock is still held', async () => {
    const repo = tempRepo([
      claimLine('ISC-72', 'a:claude:sess-2', '2026-03-08T14:05:00Z'),
      claimLine('ISC-73', 'spec-002-ISC-73', '2026-03-08T14:06:00Z'),
      claimLine('ISC-74', 'agent', '2026-03-08T14:07:00Z'),
      { ts: '2026-03-08T14:08:00Z', event: 'release', claim: 'ISC-74', session: 'agent' },
      claimLine('ISC-75', 'spec-002-ISC-75', '2026-03-08T14:09:00Z'),
    ]);
    const r = await readLockSources({ repoRoot: repo });
    expect(r.locks.map((l) => [l.claim, l.session, l.actor.kind, l.actor.legacy])).toEqual([
      ['ISC-72', 'a:claude:sess-2', 'agent', false],
      ['ISC-73', 'spec-002-ISC-73', 'legacy', true],
      ['ISC-75', 'spec-002-ISC-75', 'legacy', true],
    ]);
    expect(r.diagnostics).toEqual([
      expect.objectContaining({ severity: 'warning', code: 'actor-legacy', line: 2, claim: 'ISC-73', subject: 'spec-002-ISC-73' }),
    ]);
    expect(r.diagnostics?.[0]?.message).toContain('4 sessions');
    expect(r.diagnostics?.[0]?.message).toContain('"spec-002-ISC-73"');
  });

  test('legacy: each frontier lock file with a legacy session warns once, naming its claim; the lock still counts', async () => {
    const repo = tempRepo();
    const state = stateWithLocks(repo, { 'ISC-75': 'spec-002-ISC-75', 'ISC-76': 'a:lifeos:sess-9', 'ISC-77': 'principal' });
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.locks.map((l) => [l.claim, l.actor.legacy])).toEqual([
      ['ISC-75', true],
      ['ISC-76', false],
      ['ISC-77', true],
    ]);
    expect(r.locks[0]?.actor).toEqual(parseActor('spec-002-ISC-75'));
    expect(r.diagnostics?.map((d) => [d.code, d.claim, d.subject])).toEqual([
      ['actor-legacy', 'ISC-75', 'spec-002-ISC-75'],
      ['actor-legacy', 'ISC-77', 'principal'],
    ]);
    expect(r.diagnostics?.[0]?.message).toStartWith('The frontier lock for ISC-75 carries 1 session ');
    expect(r.diagnostics?.every((d) => d.line === undefined)).toBe(true);
  });

  test('legacy: a lock skipped as foreign raises no actor-legacy; a malformed line is not counted', async () => {
    const repo = tempRepo([
      { ts: '2026-03-08T14:05:00Z', event: 'claim', claim: 'ISC-72' },
      claimLine('ISC-74', 'a:claude:sess-2', '2026-03-08T14:06:00Z'),
    ]);
    const state = tempDir('foreign');
    const isa = join(repo, 'ISA.md');
    const dir = join(state, 'isa-locks', createHash('sha1').update(realpathSync(isa)).digest('hex').slice(0, 16));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'ISC-75.lock'), JSON.stringify({ session: 'principal', ts: '2026-03-08T15:30:00.000Z', isa: join(state, 'other', 'ISA.md') }));
    const r = await readLockSources({ repoRoot: repo, lifeosStateDir: state, now: NOW });
    expect(r.diagnostics?.map((d) => d.code)).toEqual(['locks-frontier-foreign', 'locks-activity-malformed']);
  });
});

// ── spec 027, T8 (ISC-179): the run events ─────────────────────────────────────────────────────────────────────
// The contract T9 builds to: `runStates(reading, ticked)` in locks.ts folds the run events `readLockSources` read into
// one TaskRun per task that a run event names, in task-ID order. The task's last run event in file order decides —
// dispatch → dispatched, build → building, patch → patched, apply → applied, or applied-open while `ticked` (the ids
// tasks.md checks) lacks the task — and the run carries that event's session, worktree and ts. A run event needs
// `task`, `session` and `worktree`; `claim` is optional and holds nothing. An event that is none of the six is one
// `activity-event-unknown` warning per file, at its first line, and the lines after it are read on.

type RunStates = (reading: LockReading, ticked: ReadonlySet<string>) => readonly TaskRun[];

/** `runStates` from locks.ts, looked up at call time so the probe fails on its absence and not on a broken import. */
async function runStates(reading: LockReading, ticked: ReadonlySet<string>): Promise<readonly TaskRun[]> {
  const mod: Record<string, unknown> = await import('../src/locks.ts');
  const { runStates: fn } = mod;
  if (typeof fn !== 'function') throw new Error('core/src/locks.ts exports no runStates(reading, ticked) yet (spec 027, T9)');
  return (fn as RunStates)(reading, ticked);
}

const HARBOR_LOG = join(HARBOR, '.spectant', 'activity.jsonl');
const SPEC_002 = join(HARBOR, 'specs', readdirSync(join(HARBOR, 'specs')).find((d) => d.startsWith('002-')) ?? '002');

/** The ids harbor 002's tasks.md checks, through core's own task parser. */
const ticked002 = (): ReadonlySet<string> =>
  new Set(parseTaskLines({ tasks: readFileSync(join(SPEC_002, 'tasks.md'), 'utf8') }).tasks.filter((t) => t.state === 'done').map((t) => t.id));

/** The golden: T26 ran all four before round 3 closed it and is ticked; T28 ran all four after round 3 and is not. */
const HARBOR_RUNS: readonly TaskRun[] = [
  { task: 'T26', state: 'applied', session: 'a:claude:sess-2/T26', worktree: 'wt-8', ts: '2026-03-08T16:12:00Z' },
  { task: 'T28', state: 'applied-open', session: 'a:claude:sess-2/T28', worktree: 'wt-9', ts: '2026-03-08T16:42:00Z' },
];

const runLine = (event: string, task: string, ts: string, worktree = 'wt-1') => ({ ts, event, claim: 'ISC-53', task, session: `a:claude:sess-2/${task}`, worktree });

describe('activity-events: dispatch, build, patch and apply per task (spec 027, ISC-179)', () => {
  test('activity-events: harbor holds all four events of T26 and T28, the unknown one between them included', () => {
    const events = readFileSync(HARBOR_LOG, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { event: string; task?: string });
    const of = (task: string) => events.filter((e) => e.task === task && !['claim', 'release', 'probe', 'question'].includes(e.event)).map((e) => e.event);
    expect(of('T26')).toEqual(['dispatch', 'build', 'patch', 'apply']);
    expect(of('T28')).toEqual(['dispatch', 'build', 'ponder', 'patch', 'apply']);
    const ticked = ticked002();
    expect([ticked.has('T26'), ticked.has('T28')]).toEqual([true, false]);
  });

  test('activity-events: harbor T26 (ticked) ends applied, T28 (open) applied-open, each with its last event', async () => {
    const r = await readLockSources({ repoRoot: HARBOR });
    expect(await runStates(r, ticked002())).toEqual(HARBOR_RUNS);
  });

  test('activity-events: harbor carries exactly one activity-event-unknown, at the ponder line, and no other diagnostic', async () => {
    const line = readFileSync(HARBOR_LOG, 'utf8').split('\n').findIndex((l) => l.includes('"event":"ponder"')) + 1;
    expect(line).toBeGreaterThan(0);
    const r = await readLockSources({ repoRoot: HARBOR });
    expect(r.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', code: 'activity-event-unknown', line, claim: 'ISC-75' })]);
    expect(r.diagnostics?.[0]?.message).toContain('"ponder"');
  });

  test('activity-events: harbor claim and release lines read as before; a run event holds no claim', async () => {
    const r = await readLockSources({ repoRoot: HARBOR });
    expect(r.source).toBe('activity');
    expect(r.locks).toEqual([
      { source: 'activity', claim: 'ISC-74', session: 'a:claude:sess-2', actor: parseActor('a:claude:sess-2'), since: '2026-03-08T14:06:00Z' },
    ]);
  });

  test('activity-events: each event moves the task one state on; apply is applied-open until tasks.md ticks it', async () => {
    const steps: ReadonlyArray<readonly [ReturnType<typeof runLine>, RunState]> = [
      [runLine('dispatch', 'T4', '2026-03-06T09:10:00Z'), 'dispatched'],
      [runLine('build', 'T4', '2026-03-06T09:11:00Z'), 'building'],
      [runLine('patch', 'T4', '2026-03-06T09:57:00Z'), 'patched'],
      [runLine('apply', 'T4', '2026-03-06T09:59:00Z'), 'applied-open'],
    ];
    for (const [n, [line, state]] of steps.entries()) {
      const r = await readLockSources({ repoRoot: tempRepo(steps.slice(0, n + 1).map(([l]) => l)) });
      expect(r.diagnostics).toEqual([]);
      expect(await runStates(r, new Set())).toEqual([{ task: 'T4', state, session: line.session, worktree: line.worktree, ts: line.ts }]);
    }
    const all = await readLockSources({ repoRoot: tempRepo(steps.map(([l]) => l)) });
    expect((await runStates(all, new Set(['T4'])))[0]?.state).toBe('applied');
  });

  test('activity-events: the last event in file order decides, so a re-dispatch after apply is dispatched again', async () => {
    const r = await readLockSources({
      repoRoot: tempRepo([
        runLine('dispatch', 'T4', '2026-03-06T09:10:00Z'),
        runLine('apply', 'T4', '2026-03-06T09:59:00Z'),
        runLine('dispatch', 'T5', '2026-03-07T10:00:00Z', 'wt-2'),
        runLine('dispatch', 'T4', '2026-03-07T10:01:00Z', 'wt-9'),
      ]),
    });
    expect(await runStates(r, new Set(['T4']))).toEqual([
      { task: 'T4', state: 'dispatched', session: 'a:claude:sess-2/T4', worktree: 'wt-9', ts: '2026-03-07T10:01:00Z' },
      { task: 'T5', state: 'dispatched', session: 'a:claude:sess-2/T5', worktree: 'wt-2', ts: '2026-03-07T10:00:00Z' },
    ]);
  });

  test('activity-events: two unknown events warn once, at the first; claims and runs after them are still read', async () => {
    const r = await readLockSources({
      repoRoot: tempRepo([
        claimLine('ISC-53', 'a:claude:sess-2', '2026-03-06T09:00:00Z'),
        { ...runLine('ponder', 'T5', '2026-03-06T09:01:00Z'), claim: 'ISC-54' },
        runLine('dispatch', 'T5', '2026-03-06T09:02:00Z'),
        { ts: '2026-03-06T09:03:00Z', event: 'muse', session: 'a:claude:sess-2' },
        claimLine('ISC-54', 'a:claude:sess-2', '2026-03-06T09:04:00Z'),
        runLine('build', 'T5', '2026-03-06T09:05:00Z'),
      ]),
    });
    expect(r.locks.map((l) => l.claim)).toEqual(['ISC-53', 'ISC-54']);
    expect(r.diagnostics?.map((d) => [d.severity, d.code, d.line])).toEqual([['warning', 'activity-event-unknown', 2]]);
    expect((await runStates(r, new Set())).map((run) => [run.task, run.state])).toEqual([['T5', 'building']]);
  });

  test('unknown event: one activity-event-unknown warning, shown on every open dashboard row (spec 057, ISC-366)', async () => {
    const reading = await readLockSources({
      repoRoot: tempRepo([claimLine('ISC-53', 'a:claude:sess-2', '2026-03-06T09:00:00Z'), { ts: '2026-03-06T09:01:00Z', event: 'ponder', session: 'a:claude:sess-2' }]),
      now: NOW,
    });
    const unknown = (reading.diagnostics ?? []).filter((d) => d.code === 'activity-event-unknown');
    expect(unknown.map((d) => [d.severity, d.line])).toEqual([['warning', 2]]);
    // The dashboard turns it into a `locks` warning naming the activity file and line on every open row.
    const model = buildDashboard({ ...readTreeAt(HARBOR), locks: reading });
    const open = model.specs.filter((s) => s.phase !== 'complete');
    expect(open.length).toBeGreaterThan(0);
    for (const row of open) {
      const shown = row.warnings.filter((w) => w.kind === 'locks' && w.text.includes('"ponder"'));
      expect(shown).toHaveLength(1);
      expect(shown[0]?.text).toStartWith('.spectant/activity.jsonl line 2: ');
      expect(shown[0]?.ref).toBe('.spectant/activity.jsonl');
    }
  });

  test('activity-events: a run event without task, session or worktree is malformed and skipped; a claim-only log has no runs', async () => {
    const without = (line: object, key: string) => Object.fromEntries(Object.entries(line).filter(([k]) => k !== key));
    const r = await readLockSources({
      repoRoot: tempRepo([
        runLine('dispatch', 'T6', '2026-03-06T09:01:00Z'),
        without(runLine('patch', 'T6', '2026-03-06T09:02:00Z'), 'worktree'),
        without(runLine('build', 'T6', '2026-03-06T09:03:00Z'), 'task'),
        without(runLine('apply', 'T6', '2026-03-06T09:04:00Z'), 'session'),
      ]),
    });
    expect(r.diagnostics?.map((d) => [d.code, d.line])).toEqual([
      ['locks-activity-malformed', 2],
      ['locks-activity-malformed', 3],
      ['locks-activity-malformed', 4],
    ]);
    expect((await runStates(r, new Set(['T6']))).map((run) => [run.task, run.state])).toEqual([['T6', 'dispatched']]);

    const old = await readLockSources({ repoRoot: tempRepo([claimLine('ISC-53', 'a:claude:sess-2', '2026-03-06T09:00:00Z')]) });
    expect(await runStates(old, new Set())).toEqual([]);
  });
});

// ── spec 035, T4 (ISC-189): `dispatch` and `build` may name no worktree ──────────────────────────────────────────────
// The round writes `dispatch` before the builder's worktree exists, so `dispatch` and `build` need no `worktree`: read,
// no diagnostic, and the run carries no `worktree` key at all. `patch` and `apply` still require it.
describe('run events without worktree (spec 035, ISC-189)', () => {
  const bare = (event: string, task: string, ts: string) => Object.fromEntries(Object.entries(runLine(event, task, ts)).filter(([k]) => k !== 'worktree'));

  test('run events without worktree: dispatch and build are read, dispatched and building, with no worktree key', async () => {
    const r = await readLockSources({
      repoRoot: tempRepo([bare('dispatch', 'T7', '2026-03-06T09:01:00Z'), bare('dispatch', 'T8', '2026-03-06T09:02:00Z'), bare('build', 'T8', '2026-03-06T09:03:00Z')]),
    });
    expect(r.diagnostics).toEqual([]);
    const runs = await runStates(r, new Set());
    expect(runs).toEqual([
      { task: 'T7', state: 'dispatched', session: 'a:claude:sess-2/T7', ts: '2026-03-06T09:01:00Z' },
      { task: 'T8', state: 'building', session: 'a:claude:sess-2/T8', ts: '2026-03-06T09:03:00Z' },
    ]);
    expect(runs.map((run) => 'worktree' in run)).toEqual([false, false]);
    expect(r.runs?.map((run) => 'worktree' in run)).toEqual([false, false, false]);
  });

  test('run events without worktree: patch and apply are one locks-activity-malformed each and no run', async () => {
    const r = await readLockSources({
      repoRoot: tempRepo([bare('patch', 'T9', '2026-03-06T09:01:00Z'), bare('apply', 'T9', '2026-03-06T09:02:00Z')]),
    });
    expect(r.diagnostics?.map((d) => [d.code, d.line])).toEqual([
      ['locks-activity-malformed', 1],
      ['locks-activity-malformed', 2],
    ]);
    expect(r.diagnostics?.every((d) => d.message.includes('worktree'))).toBe(true);
    expect(await runStates(r, new Set())).toEqual([]);
  });
});

// ── spec 040, T2 (ISC-222): the run lifecycle events ─────────────────────────────────────────────────────────────────
// `run-start` when a command starts on a spec or an idea, `run-end` when it ends, both with `ts`, `run`, `command`,
// `session` and exactly one of `spec` or `idea`; `run-end` may carry `outcome` (`ok`, `error`, `released`). Paired by
// `run`: a start without an end is an open run, collected on the reading as `openRuns` in file order. A line that lacks a
// field, names both or neither of spec and idea, or carries another outcome is one `locks-activity-malformed` warning
// at its line and is skipped; a `run-end` for a run that is not open is one `locks-activity-run-unmatched` warning.
type RunLifecycleLine = Record<string, string>;

const runStart = (run: string, command: string, target: { spec: string } | { idea: string }, ts: string, session = 'a:claude:sess-4'): RunLifecycleLine => ({
  ts,
  event: 'run-start',
  run,
  command,
  session,
  ...target,
});

const runEnd = (start: RunLifecycleLine, ts: string, outcome?: string): RunLifecycleLine => ({
  ...start,
  ts,
  event: 'run-end',
  ...(outcome === undefined ? {} : { outcome }),
});

const omit = (line: RunLifecycleLine, key: string): RunLifecycleLine => Object.fromEntries(Object.entries(line).filter(([k]) => k !== key));

const TASKS_037 = runStart('r-1', '/spec-tasks 037', { spec: '037-night-shift' }, '2026-03-08T15:10:00Z');
const IDEA_NIGHT = runStart('r-2', '/spec-idea night-mode', { idea: 'night-mode' }, '2026-03-08T15:12:00Z', 'a:claude:sess-5');

describe('run events: run-start and run-end paired by run (spec 040, ISC-222)', () => {
  test('run events: a run-start on a spec without its run-end is one open run, with the session parsed as actor', async () => {
    const r = await readLockSources({ repoRoot: tempRepo([TASKS_037]) });
    expect(r.diagnostics).toEqual([]);
    expect(r.openRuns).toEqual([
      { run: 'r-1', command: '/spec-tasks 037', session: 'a:claude:sess-4', actor: parseActor('a:claude:sess-4'), since: '2026-03-08T15:10:00Z', spec: '037-night-shift', line: 1 },
    ]);
    expect(r.locks).toEqual([]);
    expect(r.runs).toEqual([]);
  });

  test('run events: a run-start on an idea is an open run naming the idea and no spec', async () => {
    const r = await readLockSources({ repoRoot: tempRepo([IDEA_NIGHT]) });
    expect(r.diagnostics).toEqual([]);
    expect(r.openRuns).toEqual([
      { run: 'r-2', command: '/spec-idea night-mode', session: 'a:claude:sess-5', actor: parseActor('a:claude:sess-5'), since: '2026-03-08T15:12:00Z', idea: 'night-mode', line: 1 },
    ]);
    expect(r.openRuns?.map((run) => 'spec' in run)).toEqual([false]);
  });

  test('run events: a run-end with and without outcome ends its run; every ended run leaves openRuns empty', async () => {
    for (const outcome of [undefined, 'ok', 'error', 'released']) {
      const r = await readLockSources({ repoRoot: tempRepo([TASKS_037, runEnd(TASKS_037, '2026-03-08T15:20:00Z', outcome)]) });
      expect(r.diagnostics).toEqual([]);
      expect(r.openRuns).toEqual([]);
    }
    const idea = await readLockSources({ repoRoot: tempRepo([IDEA_NIGHT, runEnd(IDEA_NIGHT, '2026-03-08T15:13:00Z', 'ok')]) });
    expect(idea.openRuns).toEqual([]);
  });

  test('run events: runs pair by run id, so interleaved runs end apart and the open ones stay in file order', async () => {
    const second = runStart('r-3', '/spec-implement 037', { spec: '037' }, '2026-03-08T15:11:00Z', 'a:claude:sess-6');
    const third = runStart('r-4', '/spec-review 038', { spec: '038' }, '2026-03-08T15:14:00Z');
    const r = await readLockSources({
      repoRoot: tempRepo([TASKS_037, second, IDEA_NIGHT, runEnd(TASKS_037, '2026-03-08T15:13:00Z', 'error'), third, runEnd(third, '2026-03-08T15:15:00Z')]),
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.openRuns?.map((run) => [run.run, run.command, run.spec ?? run.idea, run.line])).toEqual([
      ['r-3', '/spec-implement 037', '037', 2],
      ['r-2', '/spec-idea night-mode', 'night-mode', 3],
    ]);
  });

  test('run events: both events are known, so neither raises activity-event-unknown; claims and task runs read on beside them', async () => {
    const r = await readLockSources({
      repoRoot: tempRepo([claimLine('ISC-53', 'a:claude:sess-2', '2026-03-06T09:00:00Z'), TASKS_037, runLine('dispatch', 'T4', '2026-03-06T09:10:00Z'), runEnd(TASKS_037, '2026-03-08T15:20:00Z', 'ok')]),
    });
    expect(r.diagnostics).toEqual([]);
    expect(r.locks.map((l) => l.claim)).toEqual(['ISC-53']);
    expect((await runStates(r, new Set())).map((run) => [run.task, run.state])).toEqual([['T4', 'dispatched']]);
    expect(r.openRuns).toEqual([]);
  });

  test('run events: a line without ts, run, command or session is malformed at its line and skipped', async () => {
    for (const key of ['ts', 'run', 'command', 'session']) {
      for (const line of [TASKS_037, runEnd(TASKS_037, '2026-03-08T15:20:00Z', 'ok')]) {
        const r = await readLockSources({ repoRoot: tempRepo([omit(line, key)]) });
        expect(r.diagnostics?.map((d) => [d.severity, d.code, d.line])).toEqual([['warning', 'locks-activity-malformed', 1]]);
        expect(r.diagnostics?.[0]?.message).toContain(String(line.event));
        expect(r.openRuns).toEqual([]);
      }
    }
  });

  test('run events: a line naming both a spec and an idea, or neither, is malformed and skipped', async () => {
    const both = { ...TASKS_037, idea: 'night-mode' };
    const neither = omit(TASKS_037, 'spec');
    const r = await readLockSources({ repoRoot: tempRepo([both, neither, IDEA_NIGHT, omit(runEnd(IDEA_NIGHT, '2026-03-08T15:13:00Z'), 'idea')]) });
    expect(r.diagnostics?.map((d) => [d.code, d.line])).toEqual([
      ['locks-activity-malformed', 1],
      ['locks-activity-malformed', 2],
      ['locks-activity-malformed', 4],
    ]);
    expect(r.openRuns?.map((run) => run.run)).toEqual(['r-2']);
  });

  test('run events: a run-end with an unknown outcome is malformed and skipped, so its run stays open', async () => {
    const r = await readLockSources({ repoRoot: tempRepo([TASKS_037, runEnd(TASKS_037, '2026-03-08T15:20:00Z', 'aborted')]) });
    expect(r.diagnostics?.map((d) => [d.code, d.line])).toEqual([['locks-activity-malformed', 2]]);
    expect(r.diagnostics?.[0]?.message).toContain('"aborted"');
    expect(r.openRuns?.map((run) => run.run)).toEqual(['r-1']);
  });

  test('run events: a run-end for an unknown or already ended run is one warning each and skipped', async () => {
    const stray = runEnd(runStart('r-9', '/spec-plan 039', { spec: '039' }, '2026-03-08T15:00:00Z'), '2026-03-08T15:05:00Z');
    const r = await readLockSources({
      repoRoot: tempRepo([stray, TASKS_037, runEnd(TASKS_037, '2026-03-08T15:20:00Z', 'ok'), runEnd(TASKS_037, '2026-03-08T15:21:00Z', 'released')]),
    });
    expect(r.diagnostics?.map((d) => [d.severity, d.code, d.line])).toEqual([
      ['warning', 'locks-activity-run-unmatched', 1],
      ['warning', 'locks-activity-run-unmatched', 4],
    ]);
    expect(r.openRuns).toEqual([]);
  });

  test('run events: a second run-start with an open or ended run id is one warning and skipped; the first start stands', async () => {
    const again = { ...TASKS_037, ts: '2026-03-08T15:30:00Z' };
    const r = await readLockSources({ repoRoot: tempRepo([TASKS_037, again]) });
    expect(r.diagnostics?.map((d) => [d.code, d.line])).toEqual([['locks-activity-run-duplicate', 2]]);
    expect(r.openRuns?.map((run) => [run.run, run.since])).toEqual([['r-1', '2026-03-08T15:10:00Z']]);
    const ended = await readLockSources({ repoRoot: tempRepo([TASKS_037, runEnd(TASKS_037, '2026-03-08T15:20:00Z'), again]) });
    expect(ended.diagnostics?.map((d) => [d.code, d.line])).toEqual([['locks-activity-run-duplicate', 3]]);
    expect(ended.openRuns).toEqual([]);
  });

  test('run events: a legacy session on a run line is read and flagged by the one actor-legacy warning of the file', async () => {
    const legacy = runStart('r-5', '/spec-tasks 037', { spec: '037' }, '2026-03-08T15:10:00Z', 'principal');
    const r = await readLockSources({ repoRoot: tempRepo([legacy]) });
    expect(r.diagnostics?.map((d) => [d.code, d.line, d.subject])).toEqual([['actor-legacy', 1, 'principal']]);
    expect(r.openRuns?.map((run) => [run.run, run.actor.legacy])).toEqual([['r-5', true]]);
  });

  // T4: the lines FORMAT.md § Activity and lock lines shows are beacon's own, and they read as the prose says.
  test('run events: the FORMAT.md example lines are beacon lines and parse into its two open runs', async () => {
    const format = readFileSync(join(FIXTURES, '..', '..', 'FORMAT.md'), 'utf8');
    const block = /From `core\/fixtures\/beacon\/\.spectant\/activity\.jsonl`:[\s\S]*?```json\n([\s\S]*?)```/u.exec(format)?.[1] ?? '';
    const lines = block.split('\n').filter((l) => l !== '');
    const beacon = readFileSync(join(FIXTURES, 'beacon', '.spectant', 'activity.jsonl'), 'utf8').split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(beacon).toContain(line);
    const r = await readLockSources({ repoRoot: tempRepo(lines.map((l) => JSON.parse(l) as object)) });
    expect(r.diagnostics).toEqual([]);
    expect(r.openRuns?.map((run) => [run.run, run.command, run.spec ?? null, run.idea ?? null, run.since])).toEqual([
      ['r-0308-1445', '/spec new uptime-badges', null, 'uptime-badges', '2026-03-08T14:45:00Z'],
      ['r-0308-1452', '/spec-tasks 003', '003-alert-rules', null, '2026-03-08T14:52:00Z'],
    ]);
  });
});

// ── spec 040, T5 (ISC-222.2): a log without run lines reads exactly as before ────────────────────────────────────────
// The run lifecycle events are additive. Every fixture log without `run-start` and `run-end` yields the lock list, the
// task runs and the diagnostics it yielded before spec 040, and its reading carries no `openRuns` key at all; run lines
// added to a log change none of those either. HARBOR_READING is harbor's reading as the reader produced it before spec
// 040, byte for byte.
const HARBOR_READING =
  '{"source":"activity","sources":["activity"],"locks":[{"source":"activity","claim":"ISC-74","session":"a:claude:sess-2","actor":{"raw":"a:claude:sess-2","kind":"agent","id":"a:claude:sess-2","legacy":false},"since":"2026-03-08T14:06:00Z"}],"diagnostics":[{"severity":"warning","code":"activity-event-unknown","message":"The event \\"ponder\\" is none of claim, release, dispatch, build, patch or apply; this and any later line with an unknown event is skipped, and the file is read on.","line":12,"claim":"ISC-75"}],"runs":[{"event":"dispatch","task":"T26","session":"a:claude:sess-2/T26","worktree":"wt-8","ts":"2026-03-08T15:54:00Z","claim":"ISC-73"},{"event":"build","task":"T26","session":"a:claude:sess-2/T26","worktree":"wt-8","ts":"2026-03-08T15:55:00Z","claim":"ISC-73"},{"event":"patch","task":"T26","session":"a:claude:sess-2/T26","worktree":"wt-8","ts":"2026-03-08T16:10:00Z","claim":"ISC-73"},{"event":"apply","task":"T26","session":"a:claude:sess-2/T26","worktree":"wt-8","ts":"2026-03-08T16:12:00Z","claim":"ISC-73"},{"event":"dispatch","task":"T28","session":"a:claude:sess-2/T28","worktree":"wt-9","ts":"2026-03-08T16:32:00Z","claim":"ISC-75"},{"event":"build","task":"T28","session":"a:claude:sess-2/T28","worktree":"wt-9","ts":"2026-03-08T16:33:00Z","claim":"ISC-75"},{"event":"patch","task":"T28","session":"a:claude:sess-2/T28","worktree":"wt-9","ts":"2026-03-08T16:40:00Z","claim":"ISC-75"},{"event":"apply","task":"T28","session":"a:claude:sess-2/T28","worktree":"wt-9","ts":"2026-03-08T16:42:00Z","claim":"ISC-75"}]}';

/** Every directory under core/fixtures, to two levels, that holds a `.spectant/activity.jsonl`. */
const activityTrees = (): string[] =>
  readdirSync(FIXTURES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .flatMap((e) => [
      join(FIXTURES, e.name),
      ...readdirSync(join(FIXTURES, e.name), { withFileTypes: true })
        .filter((s) => s.isDirectory())
        .map((s) => join(FIXTURES, e.name, s.name)),
    ])
    .filter((dir) => existsSync(join(dir, '.spectant', 'activity.jsonl')));

const RUN_LINE = /"event":"run-(?:start|end)"/u;

describe('run events legacy: a log without run lines reads as before (spec 040, ISC-222.2)', () => {
  // Since spec 015 harbor's log carries step lines too; without them it is the log spec 040 read (ISC-230.1).
  test('run events legacy: harbor reads byte-equal to its reading before spec 040, with no openRuns key', async () => {
    const reading = await readLockSources({ repoRoot: harborWithoutSteps() });
    // Spec 015 (ISC-231) adds `releases`, the claims a release line freed, as the reading's last key; the rest is as before.
    const { releases, ...r } = reading;
    expect(releases?.map((x) => [x.claim, x.ts])).toEqual([
      ['ISC-53', '2026-03-06T09:58:00Z'],
      ['ISC-72', '2026-03-08T15:52:00Z'],
    ]);
    expect(JSON.stringify(r)).toBe(HARBOR_READING);
    expect('openRuns' in r).toBe(false);
    expect(await runStates(r, ticked002())).toEqual(HARBOR_RUNS);
  });

  test('run events legacy: every fixture log without run lines carries no openRuns key', async () => {
    const trees = activityTrees().filter((dir) => !RUN_LINE.test(readFileSync(join(dir, '.spectant', 'activity.jsonl'), 'utf8')));
    expect(trees).toContain(HARBOR);
    for (const dir of trees) expect('openRuns' in (await readLockSources({ repoRoot: dir }))).toBe(false);
  });

  test('run events legacy: run lines put before harbor change no lock, no task run and no diagnostic', async () => {
    const harbor = readFileSync(HARBOR_LOG, 'utf8');
    const lines = [TASKS_037, IDEA_NIGHT, runEnd(IDEA_NIGHT, '2026-03-08T15:13:00Z', 'ok')].map((l) => JSON.stringify(l));
    // The same log with each run line blanked out keeps every other line's number, so the two readings compare as-is.
    const withRuns = tempRepo();
    const blanked = tempRepo();
    mkdirSync(join(withRuns, '.spectant'));
    mkdirSync(join(blanked, '.spectant'));
    writeFileSync(join(withRuns, '.spectant', 'activity.jsonl'), `${lines.join('\n')}\n${harbor}`);
    writeFileSync(join(blanked, '.spectant', 'activity.jsonl'), `${lines.map(() => '').join('\n')}\n${harbor}`);
    const a = await readLockSources({ repoRoot: withRuns });
    const b = await readLockSources({ repoRoot: blanked });
    expect('openRuns' in b).toBe(false);
    expect(a.openRuns?.map((run) => run.run)).toEqual(['r-1']);
    const legacy = Object.fromEntries(Object.entries(a).filter(([key]) => key !== 'openRuns'));
    expect(JSON.stringify(legacy)).toBe(JSON.stringify(b));
    expect(await runStates(a, ticked002())).toEqual(HARBOR_RUNS);
  });
});

// ── spec 015, T1 (ISC-230): the step events of a task ────────────────────────────────────────────────────────────────
// `probe` with `task`, `claim` and `result` (`red` or `green`), and `question` with `task`, `text` and an optional
// `claim`, each with `ts` and `session` and an optional `worktree`. They are collected on the reading as `steps` in file
// order, set only when the log holds at least one of them; a line without a required field is one
// `locks-activity-malformed` warning at its line and is skipped. A question's text is cut to its first line and to at
// most 200 characters.
const STEP_LINE = /"event":"(?:probe|question)"/u;

const probeLine = (task: string, claim: string, result: string, ts: string): Record<string, string> => ({ ts, event: 'probe', task, claim, result, session: `a:claude:sess-4/${task}`, worktree: 'wt-4' });
const questionLine = (task: string, text: string, ts: string, claim?: string): Record<string, string> => ({ ts, event: 'question', task, ...(claim === undefined ? {} : { claim }), text, session: `a:claude:sess-4/${task}` });
const without = (line: Record<string, string>, key: string): Record<string, string> => Object.fromEntries(Object.entries(line).filter(([k]) => k !== key));

/** A temp repo whose activity log is harbor's with every step line taken out: harbor's log as it was before spec 015. */
function harborWithoutSteps(): string {
  const repo = tempRepo();
  mkdirSync(join(repo, '.spectant'));
  const lines = readFileSync(HARBOR_LOG, 'utf8').split('\n').filter((l) => !STEP_LINE.test(l));
  writeFileSync(join(repo, '.spectant', 'activity.jsonl'), lines.join('\n'));
  return repo;
}

describe('step events: probe and question per task (spec 015, ISC-230)', () => {
  const RED = probeLine('T4', 'ISC-53', 'red', '2026-03-08T15:01:00Z');
  const ASK = questionLine('T4', 'Keep the old flag?', '2026-03-08T15:02:00Z', 'ISC-53');
  const ASK_BARE = questionLine('T5', 'Which fixture carries the timeout?', '2026-03-08T15:03:00Z');
  const GREEN = probeLine('T4', 'ISC-53', 'green', '2026-03-08T15:04:00Z');

  test('step events: probe red and green and a question with and without claim are read in file order', async () => {
    const r = await readLockSources({ repoRoot: tempRepo([RED, ASK, ASK_BARE, GREEN]) });
    expect(r.diagnostics).toEqual([]);
    expect(r.steps).toEqual([
      { event: 'probe', task: 'T4', claim: 'ISC-53', result: 'red', session: 'a:claude:sess-4/T4', worktree: 'wt-4', ts: '2026-03-08T15:01:00Z' },
      { event: 'question', task: 'T4', claim: 'ISC-53', text: 'Keep the old flag?', session: 'a:claude:sess-4/T4', ts: '2026-03-08T15:02:00Z' },
      { event: 'question', task: 'T5', text: 'Which fixture carries the timeout?', session: 'a:claude:sess-4/T5', ts: '2026-03-08T15:03:00Z' },
      { event: 'probe', task: 'T4', claim: 'ISC-53', result: 'green', session: 'a:claude:sess-4/T4', worktree: 'wt-4', ts: '2026-03-08T15:04:00Z' },
    ]);
    expect(r.runs).toEqual([]);
    expect(r.locks).toEqual([]);
  });

  test('step events: a probe without result or claim, one with another result, a question without text are one locks-activity-malformed each', async () => {
    const bad = [without(RED, 'result'), without(GREEN, 'claim'), { ...RED, result: 'amber' }, without(ASK, 'text'), without(ASK, 'session'), without(GREEN, 'ts'), without(RED, 'task')];
    const r = await readLockSources({ repoRoot: tempRepo([RED, ...bad, GREEN]) });
    expect(r.diagnostics?.map((d) => [d.code, d.line])).toEqual(bad.map((_, i) => ['locks-activity-malformed', i + 2]));
    expect(r.diagnostics?.every((d) => d.severity === 'warning')).toBe(true);
    expect(r.steps?.map((s) => s.event === 'probe' && s.result)).toEqual(['red', 'green']);
  });

  test('step events: a question text is cut to its first line and to at most 200 characters', async () => {
    const long = 'x'.repeat(250);
    const r = await readLockSources({ repoRoot: tempRepo([questionLine('T4', 'First line\nsecond line', '2026-03-08T15:02:00Z'), questionLine('T4', long, '2026-03-08T15:03:00Z')]) });
    expect(r.steps?.map((s) => (s.event === 'question' ? s.text : null))).toEqual(['First line', 'x'.repeat(200)]);
  });

  test('step events: both events are known, so neither raises activity-event-unknown; a log without them has no steps key', async () => {
    const r = await readLockSources({ repoRoot: tempRepo([claimLine('ISC-53', 'a:claude:sess-4', '2026-03-08T15:00:00Z'), RED, ASK]) });
    expect(r.diagnostics).toEqual([]);
    expect(r.steps).toHaveLength(2);
    expect('steps' in (await readLockSources({ repoRoot: tempRepo([claimLine('ISC-53', 'a:claude:sess-4', '2026-03-08T15:00:00Z')]) }))).toBe(false);
    expect('steps' in (await readLockSources({ repoRoot: harborWithoutSteps() }))).toBe(false);
  });

  test('step events: harbor carries probe red and green and a question for two tasks, one question without claim, every question followed by a step', async () => {
    const r = await readLockSources({ repoRoot: HARBOR });
    const steps = r.steps ?? [];
    expect(new Set(steps.map((s) => s.task))).toEqual(new Set(['T26', 'T28']));
    expect(new Set(steps.map((s) => (s.event === 'probe' ? `probe-${s.result}` : 'question')))).toEqual(new Set(['probe-red', 'probe-green', 'question']));
    expect(steps.some((s) => s.event === 'question' && s.claim === undefined)).toBe(true);
    steps.forEach((s, i) => {
      if (s.event === 'question') expect(steps.slice(i + 1).some((n) => n.task === s.task)).toBe(true);
    });
  });

  test('step events: the FORMAT.md example lines are harbor lines and parse into steps without a diagnostic', async () => {
    const format = readFileSync(join(FIXTURES, '..', '..', 'FORMAT.md'), 'utf8');
    const block = /From `core\/fixtures\/harbor\/\.spectant\/activity\.jsonl`, the steps[\s\S]*?```json\n([\s\S]*?)```/u.exec(format)?.[1] ?? '';
    const lines = block.split('\n').filter((l) => l !== '');
    const harbor = readFileSync(HARBOR_LOG, 'utf8').split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(harbor).toContain(line);
    const r = await readLockSources({ repoRoot: tempRepo(lines.map((l) => JSON.parse(l) as object)) });
    expect(r.diagnostics).toEqual([]);
    expect(new Set(r.steps?.map((s) => s.event))).toEqual(new Set(['probe', 'question']));
  });
});

// ── spec 015, T6 (ISC-230.1): a step line changes no state ───────────────────────────────────────────────────────────
// Harbor with its step lines and without them, and harbor with a step line put between every two lines, give the same
// task runs (ISC-179), the same item states (spec 040, ISC-223), the same lock list and the same diagnostics.
describe('steps change no state (spec 015, ISC-230.1)', () => {
  const STATE_CLOCKS = [new Date('2026-03-08T15:00:00Z'), new Date('2026-03-08T17:00:00Z')];

  /** Everything a reading decides beyond its steps: locks, task runs, item states, diagnostics without line numbers. */
  function stateOf(reading: LockReading, now: Date) {
    const workspace = { ...readTreeAt(HARBOR), locks: reading };
    const taskRuns = taskRunsOf(workspace.specs, reading, now);
    const items = itemStates({ workspace, dashboard: buildDashboard(workspace), taskRuns, now, abortAfterMs: DEFAULT_ABORT_AFTER_MS });
    return { locks: reading.locks, runs: reading.runs, taskRuns, items, diagnostics: reading.diagnostics?.map((d) => [d.code, d.message, d.claim ?? null]) };
  }

  test('steps change no state: harbor with its step lines reads as harbor without them', async () => {
    const withSteps = await readLockSources({ repoRoot: HARBOR });
    const plain = await readLockSources({ repoRoot: harborWithoutSteps() });
    expect(withSteps.steps?.length ?? 0).toBeGreaterThan(0);
    expect(await runStates(withSteps, ticked002())).toEqual(await runStates(plain, ticked002()));
    for (const now of STATE_CLOCKS) expect(stateOf(withSteps, now)).toEqual(stateOf(plain, now));
  });

  test('steps change no state: a probe and a question between every two harbor lines change no lock, run, state or diagnostic', async () => {
    const plainRepo = harborWithoutSteps();
    const lines = readFileSync(join(plainRepo, '.spectant', 'activity.jsonl'), 'utf8').split('\n').filter((l) => l !== '');
    const steps = [probeLine('T26', 'ISC-73', 'red', '2026-03-08T15:56:00Z'), questionLine('T28', 'Which focus ring?', '2026-03-08T16:34:00Z')].map((l) => JSON.stringify(l));
    const mixed = tempRepo();
    mkdirSync(join(mixed, '.spectant'));
    writeFileSync(join(mixed, '.spectant', 'activity.jsonl'), `${lines.flatMap((l, i) => [l, steps[i % 2] ?? '']).join('\n')}\n`);
    const a = await readLockSources({ repoRoot: mixed });
    const b = await readLockSources({ repoRoot: plainRepo });
    expect(a.steps).toHaveLength(lines.length);
    expect(await runStates(a, ticked002())).toEqual(HARBOR_RUNS);
    for (const now of STATE_CLOCKS) expect(stateOf(a, now)).toEqual(stateOf(b, now));
  });
});
