// The holder of a lock in the actor grammar (spec 008, T63, ISC-119). `readLockSources` runs every `session` it reads
// through `parseActor` and carries the result as `ClaimLock.actor`; a session outside the grammar is legacy: read,
// counted like any other, and flagged with one `actor-legacy` warning per file — once for `.spectant/activity.jsonl`,
// at its first legacy line, and once per frontier lock file. Harbor's log carries only grammar sessions.
//
// The run events (spec 027, ISC-179): `dispatch`, `build`, `patch` and `apply` beside `claim` and `release`, folded per
// task into its last run state; an unknown event is one `activity-event-unknown` warning per file (`activity-events`).
//
// Every tree here is a fresh temp dir with synthetic sessions; no real state directory or session enters the tree.
import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseActor } from '../src/actor.ts';
import type { LockReading, RunState, TaskRun } from '../src/files.ts';
import { readLockSources } from '../src/locks.ts';
import { parseTaskLines } from '../src/tasks.ts';
import { FIXTURES } from './helpers/read-tree.ts';

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
    const of = (task: string) => events.filter((e) => e.task === task && e.event !== 'claim' && e.event !== 'release').map((e) => e.event);
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

  test('activity-events: a run event without task, session or worktree is malformed and skipped; a claim-only log has no runs', async () => {
    const without = (line: object, key: string) => Object.fromEntries(Object.entries(line).filter(([k]) => k !== key));
    const r = await readLockSources({
      repoRoot: tempRepo([
        runLine('dispatch', 'T6', '2026-03-06T09:01:00Z'),
        without(runLine('build', 'T6', '2026-03-06T09:02:00Z'), 'worktree'),
        without(runLine('patch', 'T6', '2026-03-06T09:03:00Z'), 'task'),
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
