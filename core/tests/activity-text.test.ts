// The activity line planner (spec 031, T9–T11, ISC-227): every line `activity-text.ts` plans for
// `.spectant/activity.jsonl` reads back through the existing readers exactly as the app's, the hooks' and the fixture
// lines do. Claim and release through `activityReading` (locks, releases), run-start and run-end pairs through
// `openRuns` and the item state model (spec 040), the run events through `runStates` (spec 027) and the step events
// through `steps` (spec 015). The planner writes nothing; the plugin CLI appends what it returns.
//
// Probe: `bun test core/tests/activity-text.test.ts`.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  ActivityTextError,
  type ActivityTextErrorCode,
  claimLine,
  newRunId,
  probeLine,
  questionLine,
  releaseLine,
  runEndLine,
  runEventLine,
  runStartLine,
} from '../src/activity-text.ts';
import * as barrel from '../src/index.ts';
import type { ItemStateInfo, LockReading } from '../src/files.ts';
import { itemStates } from '../src/item-state.ts';
import { activityReading, runStates } from '../src/locks.ts';
import { FIXTURES } from './helpers/read-tree.ts';
import { stateInputAt } from './helpers/state-model.ts';

const BEACON = join(FIXTURES, 'beacon');
const fixtureLines = (tree: string): string[] =>
  readFileSync(join(FIXTURES, tree, '.spectant', 'activity.jsonl'), 'utf8').split('\n').filter((l) => l !== '');

/** The first line of `tree`'s activity log that holds `needle`, with its newline; fails the test when there is none. */
function fixtureLine(tree: string, needle: string): string {
  const hit = fixtureLines(tree).find((l) => l.includes(needle));
  if (hit === undefined) throw new Error(`${tree}: no activity line holds ${needle}`);
  return `${hit}\n`;
}

/** The keys of one planned line, in the order written. */
const keysOf = (line: string): string[] => Object.keys(JSON.parse(line) as Record<string, unknown>);

const MIN = 60 * 1000;

/** Beacon's item states with the open runs of `text`'s reading, at `now`. */
function beaconStates(text: string, now: number): readonly ItemStateInfo[] {
  const input = stateInputAt(BEACON);
  const openRuns = activityReading(text).openRuns ?? [];
  const locks = { ...(input.workspace.locks as LockReading), openRuns };
  return itemStates({ ...input, workspace: { ...input.workspace, locks }, now });
}

const stateOf = (items: readonly ItemStateInfo[], kind: 'spec' | 'idea', id: string): ItemStateInfo => {
  const hit = items.find((i) => i.kind === kind && i.id === id && i.spec === undefined);
  if (hit === undefined) throw new Error(`no ${kind} item ${id}`);
  return hit;
};

describe('activity text: the shape of each line', () => {
  test('claim and release reproduce harbor\'s lines byte for byte, one line each with its newline', () => {
    expect(claimLine({ claim: 'ISC-53', task: 'T4', session: 'a:claude:sess-2/T4', worktree: 'wt-1', ts: '2026-03-06T09:12:00Z' })).toBe(fixtureLine('harbor', '"event":"claim","claim":"ISC-53"'));
    expect(releaseLine({ claim: 'ISC-53', task: 'T4', session: 'a:claude:sess-2/T4', ts: '2026-03-06T09:58:00Z' })).toBe(fixtureLine('harbor', '"event":"release","claim":"ISC-53"'));
  });

  test('run-start and run-end reproduce beacon\'s lines byte for byte: the same run id, outcome on the end only', () => {
    const start = { run: 'r-0308-1230', target: '002-status-page', command: '/spec-plan 002', session: 'a:claude:sess-21' };
    expect(runStartLine({ ...start, ts: '2026-03-08T12:30:00Z' })).toBe(fixtureLine('beacon', '"run-start","run":"r-0308-1230"'));
    expect(runEndLine({ ...start, outcome: 'error', ts: '2026-03-08T12:41:00Z' })).toBe(fixtureLine('beacon', '"run-end","run":"r-0308-1230"'));
    const idea = { run: 'r-0308-1445', target: 'uptime-badges', command: '/spec new uptime-badges', session: 'a:claude:sess-71', ts: '2026-03-08T14:45:00Z' };
    expect(runStartLine(idea)).toBe(fixtureLine('beacon', '"run":"r-0308-1445"'));
  });

  test('the run-end matches the app\'s release line in key order, only the outcome differs', () => {
    const end = runEndLine({ run: 'r-1', target: '003', command: '/spec tasks 003', session: 'a:claude:s-1', outcome: 'ok', ts: '2026-03-08T13:00:00Z' });
    expect(keysOf(end)).toEqual(['ts', 'event', 'run', 'command', 'session', 'spec', 'outcome']);
  });

  test('run and step events keep the key order of the skill\'s activity writer: ts, event, claim, task, session, then the rest', () => {
    expect(keysOf(runEventLine({ event: 'patch', claim: 'ISC-73', task: 'T26', session: 'a:claude:sess-2/T26', worktree: 'wt-8', ts: '2026-03-08T16:10:00Z' }))).toEqual(['ts', 'event', 'claim', 'task', 'session', 'worktree']);
    expect(keysOf(probeLine({ claim: 'ISC-73', task: 'T26', result: 'red', session: 'a:claude:sess-2/T26', ts: '2026-03-08T15:58:00Z' }))).toEqual(['ts', 'event', 'claim', 'task', 'session', 'result']);
    expect(keysOf(questionLine({ task: 'T28', text: 'Tab order?', session: 'a:claude:spec-002/T28', ts: '2026-03-08T16:37:00Z' }))).toEqual(['ts', 'event', 'task', 'session', 'text']);
  });
});

describe('activity text: round trip through the readers', () => {
  const session = 'a:claude:sess-9/T3';

  test('a planned claim is held, its planned release frees it and is kept as a release', () => {
    const claim = claimLine({ claim: 'ISC-227', task: 'T3', session, ts: '2026-03-08T10:00:00Z' });
    const held = activityReading(claim);
    expect(held.diagnostics).toEqual([]);
    expect(held.locks).toMatchObject([{ claim: 'ISC-227', session, since: '2026-03-08T10:00:00Z', source: 'activity' }]);
    const freed = activityReading(claim + releaseLine({ claim: 'ISC-227', task: 'T3', session, ts: '2026-03-08T10:20:00Z' }));
    expect(freed.diagnostics).toEqual([]);
    expect(freed.locks).toEqual([]);
    expect(freed.releases).toMatchObject([{ claim: 'ISC-227', session, ts: '2026-03-08T10:20:00Z', task: 'T3' }]);
  });

  test('a run-start alone is an open run on its spec, its idea, or the repository for init', () => {
    const base = { command: '/spec plan 003', session: 'a:claude:sess-1', ts: '2026-03-08T12:00:00Z' };
    const text = [
      runStartLine({ ...base, run: 'r-a', target: '003' }),
      runStartLine({ ...base, run: 'r-b', target: '003-alert-rules' }),
      runStartLine({ ...base, run: 'r-c', target: 'digest-emails', command: '/spec new digest-emails' }),
      runStartLine({ ...base, run: 'r-d', target: 'init', command: '/spec init' }),
    ].join('');
    const reading = activityReading(text);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.openRuns?.map((r) => [r.run, r.spec, r.idea])).toEqual([
      ['r-a', '003', undefined],
      ['r-b', '003-alert-rules', undefined],
      ['r-c', undefined, 'digest-emails'],
      // `init` works on the repository, not on one spec or idea: it is written as the spec `init`, a name no spec folder
      // can carry, so it pairs like any run and puts no item into running.
      ['r-d', 'init', undefined],
    ]);
  });

  test('repo docs (spec 074): the doc and tldr runs work on the repository like init, written as spec, touching no item', () => {
    const since = Date.parse('2026-03-08T12:00:00Z');
    const base = { session: 'a:claude:sess-1', ts: '2026-03-08T12:00:00Z' };
    const doc = runStartLine({ ...base, run: 'r-doc', target: 'doc', command: '/spec doc' });
    const tldr = runStartLine({ ...base, run: 'r-tldr', target: 'tldr', command: '/spec tldr' });
    expect(JSON.parse(doc)).toMatchObject({ spec: 'doc' });
    expect(JSON.parse(doc)).not.toHaveProperty('idea');
    expect(JSON.parse(tldr)).toMatchObject({ spec: 'tldr' });
    expect(JSON.parse(tldr)).not.toHaveProperty('idea');
    const ended = runEndLine({ ...base, run: 'r-doc', target: 'doc', command: '/spec doc', outcome: 'ok', ts: '2026-03-08T12:05:00Z' });
    expect(JSON.parse(ended)).toMatchObject({ spec: 'doc', outcome: 'ok' });
    const reading = activityReading(doc + tldr);
    expect(reading.diagnostics).toEqual([]);
    expect(reading.openRuns?.map((r) => [r.run, r.spec, r.idea])).toEqual([
      ['r-doc', 'doc', undefined],
      ['r-tldr', 'tldr', undefined],
    ]);
    expect(activityReading(doc + tldr + ended).openRuns?.map((r) => r.run)).toEqual(['r-tldr']);
    const strip = (items: readonly ItemStateInfo[]) => items.map((i) => [i.kind, i.spec, i.id, i.state]);
    expect(strip(beaconStates(doc + tldr, since + 5 * MIN))).toEqual(strip(beaconStates('', since + 5 * MIN)));
  });

  test('a start and its end with the same run id leave no open run, for every outcome the planner writes', () => {
    for (const outcome of ['ok', 'error'] as const) {
      const run = { run: `r-${outcome}`, target: '003', command: '/spec tasks 003', session: 'a:claude:sess-1' };
      const text = runStartLine({ ...run, ts: '2026-03-08T12:00:00Z' }) + runEndLine({ ...run, outcome, ts: '2026-03-08T12:05:00Z' });
      const reading = activityReading(text);
      expect(reading.diagnostics).toEqual([]);
      expect(reading.openRuns).toEqual([]);
    }
  });

  test('item state (spec 040): a start alone runs, aborts past the age; a pair ending in error reads the stage\'s own state', () => {
    const since = Date.parse('2026-03-08T12:00:00Z');
    const run = { run: newRunId({ ts: '2026-03-08T12:00:00Z', session: 'a:claude:sess-1', command: '/spec tasks 003', target: '003' }), target: '003', command: '/spec tasks 003', session: 'a:claude:sess-1' };
    const start = runStartLine({ ...run, ts: '2026-03-08T12:00:00Z' });
    const without = stateOf(beaconStates('', since + 10 * MIN), 'spec', '003').state;
    expect(stateOf(beaconStates(start, since + 10 * MIN), 'spec', '003').state).toBe('running');
    expect(stateOf(beaconStates(start, since + 180 * MIN), 'spec', '003').state).toBe('aborted');
    const failed = start + runEndLine({ ...run, outcome: 'error', ts: '2026-03-08T12:03:00Z' });
    const item = stateOf(beaconStates(failed, since + 10 * MIN), 'spec', '003');
    expect(item.state).toBe(without);
    expect(item.run).toBeUndefined();
  });

  test('item state: a run on an idea runs the idea; the init run touches no item', () => {
    const since = Date.parse('2026-03-08T12:00:00Z');
    const base = { session: 'a:claude:sess-1', ts: '2026-03-08T12:00:00Z' };
    const idea = runStartLine({ ...base, run: 'r-idea', target: 'digest-emails', command: '/spec new digest-emails' });
    expect(stateOf(beaconStates(idea, since + 5 * MIN), 'idea', 'digest-emails').state).toBe('running');
    const init = runStartLine({ ...base, run: 'r-init', target: 'init', command: '/spec init' });
    const strip = (items: readonly ItemStateInfo[]) => items.map((i) => [i.kind, i.spec, i.id, i.state]);
    expect(strip(beaconStates(init, since + 5 * MIN))).toEqual(strip(beaconStates('', since + 5 * MIN)));
  });

  test('planned run events fold into the task run states; planned steps are steps', () => {
    const s = 'a:claude:sess-2/T26';
    const text = [
      runEventLine({ event: 'dispatch', claim: 'ISC-73', task: 'T26', session: s, ts: '2026-03-08T15:54:00Z' }),
      runEventLine({ event: 'build', claim: 'ISC-73', task: 'T26', session: s, ts: '2026-03-08T15:55:00Z' }),
      probeLine({ claim: 'ISC-73', task: 'T26', result: 'red', session: s, worktree: 'wt-8', ts: '2026-03-08T15:58:00Z' }),
      questionLine({ claim: 'ISC-73', task: 'T26', text: 'Accent or neutral?\nsecond line', session: s, ts: '2026-03-08T16:02:00Z' }),
      probeLine({ claim: 'ISC-73', task: 'T26', result: 'green', session: s, worktree: 'wt-8', ts: '2026-03-08T16:06:00Z' }),
      runEventLine({ event: 'patch', claim: 'ISC-73', task: 'T26', session: s, worktree: 'wt-8', ts: '2026-03-08T16:10:00Z' }),
    ].join('');
    const reading = activityReading(text);
    expect(reading.diagnostics).toEqual([]);
    expect(runStates(reading, new Set())).toMatchObject([{ task: 'T26', state: 'patched', worktree: 'wt-8', session: s }]);
    expect(reading.steps?.map((step) => [step.event, step.event === 'probe' ? step.result : step.text])).toEqual([
      ['probe', 'red'],
      ['question', 'Accent or neutral?'],
      ['probe', 'green'],
    ]);
    const applied = activityReading(text + runEventLine({ event: 'apply', claim: 'ISC-73', task: 'T26', session: s, worktree: 'wt-8', ts: '2026-03-08T16:12:00Z' }));
    expect(runStates(applied, new Set(['T26']))).toMatchObject([{ task: 'T26', state: 'applied' }]);
  });
});

describe('activity text: run ids', () => {
  const input = { ts: '2026-03-08T12:00:00.123Z', session: 'a:claude:sess-1', command: '/spec tasks 003', target: '003' };

  test('newRunId is deterministic over its inputs and differs when any of them does', () => {
    expect(newRunId(input)).toBe(newRunId({ ...input }));
    expect(newRunId(input)).toMatch(/^r-20260308T120000123Z-[0-9a-f]{8}$/);
    const others = [{ ...input, ts: '2026-03-08T12:00:00.124Z' }, { ...input, session: 'a:claude:sess-2' }, { ...input, command: '/spec plan 003' }, { ...input, target: '004' }];
    expect(new Set([input, ...others].map(newRunId)).size).toBe(5);
  });

  test('two commands started in the same second by two sessions read as two open runs, no duplicate', () => {
    const lines = ['a:claude:sess-1', 'a:claude:sess-2'].map((session) => runStartLine({ ...input, session, run: newRunId({ ...input, session }) }));
    const reading = activityReading(lines.join(''));
    expect(reading.diagnostics).toEqual([]);
    expect(reading.openRuns).toHaveLength(2);
  });
});

describe('activity text: refused input', () => {
  const run = { run: 'r-1', target: '003', command: '/spec tasks 003', session: 'a:claude:sess-1', ts: '2026-03-08T12:00:00Z' };
  const refused = (plan: () => string, code: ActivityTextErrorCode) => {
    let caught: unknown;
    try {
      plan();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ActivityTextError);
    expect((caught as ActivityTextError).code).toBe(code);
  };

  test('a session outside the actor grammar, a bad claim or task, a bad time, a multi-line field are refused', () => {
    refused(() => runStartLine({ ...run, session: 'spec-002-ISC-75' }), 'bad-session');
    refused(() => claimLine({ claim: 'claim-1', session: 'a:claude:s', ts: run.ts }), 'bad-claim');
    refused(() => claimLine({ claim: 'ISC-1', task: '3', session: 'a:claude:s', ts: run.ts }), 'bad-task');
    refused(() => runStartLine({ ...run, ts: 'yesterday' }), 'bad-ts');
    refused(() => runStartLine({ ...run, command: '/spec tasks\n003' }), 'multi-line');
    refused(() => runStartLine({ ...run, run: '' }), 'bad-input');
  });

  test('a target that is neither a spec, an idea slug nor init, an unknown outcome, a patch without worktree are refused', () => {
    refused(() => runStartLine({ ...run, target: 'Not A Slug' }), 'bad-target');
    refused(() => runEndLine({ ...run, outcome: 'maybe' as 'ok' }), 'bad-outcome');
    refused(() => runEventLine({ event: 'patch', task: 'T1', session: 'a:claude:s', ts: run.ts }), 'bad-input');
    refused(() => questionLine({ task: 'T1', text: '  ', session: 'a:claude:s', ts: run.ts }), 'bad-input');
  });

  test('a task id other than T<k> or C<k> is refused (spec 056)', () => {
    for (const task of ['c1', 'C', 'X1', 'TC1', 'C1a']) {
      refused(() => probeLine({ claim: 'ISC-1', task, result: 'red', session: 'a:claude:s', ts: run.ts }), 'bad-task');
    }
  });
});

describe('activity text: a frontier claim unit C<k> of a spec without tasks.md (spec 056, ISC-347)', () => {
  const ts = '2026-03-08T12:00:00Z';
  const session = 'a:claude:spec-056/C1';

  test('every line that names a task takes C<k> like T<k>, from a sub-agent session on C<k>', () => {
    expect(JSON.parse(probeLine({ claim: 'ISC-1', task: 'C1', result: 'red', session, ts }))).toMatchObject({ task: 'C1', session });
    expect(JSON.parse(questionLine({ task: 'C1', text: 'Which unit?', session, ts }))).toMatchObject({ task: 'C1', session });
    expect(JSON.parse(claimLine({ claim: 'ISC-1', task: 'C1', session, ts }))).toMatchObject({ task: 'C1', session });
    expect(JSON.parse(releaseLine({ claim: 'ISC-1', task: 'C1', session, ts }))).toMatchObject({ task: 'C1', session });
    expect(JSON.parse(runEventLine({ event: 'dispatch', task: 'C1', claim: 'ISC-1', session, ts }))).toMatchObject({ task: 'C1', session });
  });
});

test('the planners ride the browser-safe barrel', () => {
  for (const name of ['claimLine', 'releaseLine', 'runStartLine', 'runEndLine', 'runEventLine', 'probeLine', 'questionLine', 'newRunId', 'ActivityTextError']) {
    expect(name in barrel).toBe(true);
  }
});
