// The item state model (spec 040, T7–T10, ISC-221): every item of a fixture tree — spec, idea, review mark,
// code-review mark, claim and task — stands in exactly one of the five states, and the whole assignment equals the
// tree's `<tree>.state.golden.json` (the `state` family, also checked by golden.test.ts). Across the trees every row of
// the stage table (`STAGE_RULES`, rows 1 to 11) holds at least one item; beacon alone covers them all, and its activity
// log carries every run case (core/fixtures/beacon/generate.ts names them). `UPDATE_GOLDEN=1` rewrites the snapshots.
//
// Probe: `bun test core/ -t "item state"`.
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

import { parseClaims } from '../src/claims.ts';
import type { ItemKind, ItemState, ItemStateInfo } from '../src/files.ts';
import { DEFAULT_ABORT_AFTER_MS, DEFAULT_CLAIM_STALE_MS, STATE_TABLE, itemStates, stageRuleOf } from '../src/item-state.ts';
import { LIVE_STALE_MS } from '../src/live.ts';
import { specIdOf } from '../src/spec-ref.ts';
import { STAGE_RULES } from '../src/stage.ts';
import { expectGolden, goldenPath, goldenText } from './helpers/golden.ts';
import { FIXTURES, fixtureTrees } from './helpers/read-tree.ts';
import { stateInputAt, stateModel } from './helpers/state-model.ts';

const UPDATE_COMMAND = 'bun test core/tests/item-state.test.ts';
const STATES: readonly ItemState[] = ['open', 'waiting', 'running', 'aborted', 'done'];
const KINDS: readonly ItemKind[] = ['spec', 'idea', 'review-mark', 'code-review-mark', 'claim', 'task'];
const MIN = 60 * 1000;
const BEACON = join(FIXTURES, 'beacon');
const trees = fixtureTrees();

const keyOf = (item: ItemStateInfo): string => `${item.kind} ${item.spec ?? '-'} ${item.id}`;

/** The one item of `kind` with `id` (and `spec`, for marks, claims and tasks); fails the test when absent. */
function itemOf(items: readonly ItemStateInfo[], kind: ItemKind, id: string, spec?: string): ItemStateInfo {
  const hit = items.find((i) => i.kind === kind && i.id === id && i.spec === spec);
  if (hit === undefined) throw new Error(`no ${kind} item ${spec === undefined ? '' : `${spec} `}${id}`);
  return hit;
}

describe('item state', () => {
  test.each(trees)('%s: exactly one state per item, equal to its golden', (tree) => {
    const root = join(FIXTURES, tree);
    const input = stateInputAt(root);
    const items = itemStates(input);
    const keys = items.map(keyOf);
    expect(new Set(keys).size).toBe(keys.length);
    expect(items.filter((i) => !STATES.includes(i.state))).toEqual([]);
    // Every spec row, idea, review mark, claim and task of the workspace has its item.
    const rows = input.dashboard.specs;
    expect(items.filter((i) => i.kind === 'spec').map((i) => i.id)).toEqual(rows.map((r) => r.id).sort());
    expect(items.filter((i) => i.kind === 'review-mark').map((i) => i.id)).toEqual(rows.map((r) => r.id).sort());
    expect(items.filter((i) => i.kind === 'idea').map((i) => i.id)).toEqual(input.dashboard.ideas.list.map((i) => i.slug));
    for (const files of input.workspace.specs) {
      if (files.texts.spec === undefined) continue;
      const id = specIdOf(files.folder) ?? files.folder;
      expect({ id, claims: items.filter((i) => i.kind === 'claim' && i.spec === id).map((i) => i.id) }).toEqual({ id, claims: parseClaims(files.texts.spec).claims.map((c) => c.id) });
    }
    expectGolden(goldenPath(tree, 'state'), goldenText(items), UPDATE_COMMAND);
  });

  test('every row of the stage table holds an item across the fixture trees', () => {
    const covered = new Set<number>();
    for (const tree of trees) {
      const input = stateInputAt(join(FIXTURES, tree));
      const items = itemStates(input);
      for (const row of input.dashboard.specs) {
        itemOf(items, 'spec', row.id);
        covered.add(STAGE_RULES.indexOf(stageRuleOf(row)) + 1);
      }
      if (items.some((i) => i.kind === 'idea')) covered.add(1);
    }
    expect([...covered].sort((a, b) => a - b)).toEqual(STAGE_RULES.map((_, i) => i + 1));
  });

  test('beacon alone covers every row of the stage table', () => {
    const input = stateInputAt(BEACON);
    const rows = new Set(input.dashboard.specs.map((row) => STAGE_RULES.indexOf(stageRuleOf(row)) + 1));
    if (input.dashboard.ideas.list.length > 0) rows.add(1);
    expect([...rows].sort((a, b) => a - b)).toEqual(STAGE_RULES.map((_, i) => i + 1));
  });

  test('every stage rule names the state it yields without a run (T8)', () => {
    expect(STAGE_RULES.map((r) => [r.stage, r.state])).toEqual([
      ['idea', 'open'],
      ['done', 'done'],
      ['plan', 'open'],
      ['tasks', 'open'],
      ['review', 'open'],
      ['build', 'open'],
      ['done', 'done'],
      ['close-pending', 'waiting'],
      ['code-review', 'open'],
      ['close', 'open'],
      ['blocked', 'waiting'],
    ]);
    // An open row names the command that lies with the user.
    expect(STAGE_RULES.filter((r) => r.state === 'open' && r.next === null)).toEqual([]);
  });

  test('beacon: an open run makes its spec or idea running, the newest of two decides, past the age it is aborted', () => {
    const items = stateModel(BEACON);
    const tasks = itemOf(items, 'spec', '003');
    expect(tasks).toMatchObject({ state: 'running', stage: 'tasks', run: { run: 'r-0308-1452', command: '/spec-tasks 003', since: '2026-03-08T14:52:00Z', elapsedMs: 8 * MIN, openRuns: 1, source: 'run' } });
    expect(tasks.run?.actor.raw).toBe('a:claude:sess-32');
    expect(itemOf(items, 'spec', '006')).toMatchObject({ state: 'aborted', run: { command: '/spec-code-review 006', elapsedMs: 200 * MIN, openRuns: 1 } });
    expect(itemOf(items, 'spec', '005')).toMatchObject({ state: 'running', stage: 'build', run: { run: 'r-0308-1440', command: '/spec-implement 005', openRuns: 2 } });
    expect(itemOf(items, 'idea', 'uptime-badges')).toMatchObject({ state: 'running', stage: 'idea', run: { command: '/spec new uptime-badges', elapsedMs: 15 * MIN } });
    expect(itemOf(items, 'idea', 'digest-emails')).toMatchObject({ state: 'open', stage: 'idea', command: '/spec new digest-emails' });
    // A run that ended (error, ok, released) leaves the stage table's state.
    expect(itemOf(items, 'spec', '002')).toMatchObject({ state: 'open', stage: 'plan', command: '/spec-plan 002' });
    expect(itemOf(items, 'spec', '004')).toMatchObject({ state: 'open', stage: 'review', command: '/spec-review 004', reason: 'the reviewed mark is stale' });
    expect(itemOf(items, 'spec', '001')).toMatchObject({ state: 'done', stage: 'done' });
    expect(itemOf(items, 'spec', '010')).toMatchObject({ state: 'done', stage: 'done' });
    expect(itemOf(items, 'spec', '009')).toMatchObject({ state: 'open', stage: 'close', command: '/spec-complete 009' });
    expect(itemOf(items, 'spec', '007')).toMatchObject({ state: 'waiting', stage: 'close-pending', waits: { specs: [], claims: [], siblings: ['008'] } });
    expect(itemOf(items, 'spec', '011')).toMatchObject({ state: 'waiting', stage: 'blocked', waits: { specs: ['002'], siblings: [] } });
  });

  test('beacon: the review and code-review marks', () => {
    const items = stateModel(BEACON);
    expect(itemOf(items, 'review-mark', '004', '004')).toMatchObject({ state: 'open', command: '/spec-review 004' });
    expect(itemOf(items, 'review-mark', '002', '002')).toMatchObject({ state: 'waiting', waits: { specs: ['002'] } });
    expect(itemOf(items, 'review-mark', '005', '005').state).toBe('done');
    expect(itemOf(items, 'review-mark', '005', '005').doneAt).toBeString();
    expect(itemOf(items, 'code-review-mark', '006', '006')).toMatchObject({ state: 'aborted', run: { command: '/spec-code-review 006' } });
    expect(itemOf(items, 'code-review-mark', '007', '007')).toMatchObject({ state: 'waiting', waits: { siblings: ['008'] } });
    expect(itemOf(items, 'code-review-mark', '005', '005')).toMatchObject({ state: 'waiting', waits: { specs: ['005'] } });
    // `bug` has `code_review: none` in beacon's workflow: no code-review mark item.
    expect(items.some((i) => i.kind === 'code-review-mark' && i.spec === '009')).toBe(false);
  });

  test('beacon: the claims and tasks of 005', () => {
    const items = stateModel(BEACON);
    const claim = (id: string) => itemOf(items, 'claim', id, '005');
    const task = (id: string) => itemOf(items, 'task', id, '005');
    expect(claim('ISC-13').state).toBe('done');
    expect(claim('ISC-15')).toMatchObject({ state: 'running', detail: 'taken', run: { command: '/spec-implement 005', source: 'lock', elapsedMs: 30 * MIN } });
    expect(claim('ISC-16')).toMatchObject({ state: 'aborted', run: { source: 'lock', elapsedMs: 80 * MIN } });
    expect(claim('ISC-17')).toMatchObject({ state: 'waiting', waits: { claims: ['ISC-18'] } });
    expect(claim('ISC-18')).toMatchObject({ state: 'open', command: '/spec-implement 005' });
    expect(claim('ISC-19')).toMatchObject({ state: 'done', closedAs: 'dropped' });
    expect(task('T1')).toMatchObject({ state: 'done', doneAt: '2026-03-08T14:14:00Z' });
    expect(task('T3')).toMatchObject({ state: 'running', detail: 'building', run: { source: 'task-run' } });
    expect(task('T4')).toMatchObject({ state: 'aborted', run: { source: 'task-run' } });
    expect(task('T5')).toMatchObject({ state: 'running', detail: 'patched' });
    expect(task('T6')).toMatchObject({ state: 'running', detail: 'applied-open' });
    expect(task('T7')).toMatchObject({ state: 'waiting', waits: { claims: ['ISC-18'] } });
    expect(task('T8')).toMatchObject({ state: 'done', closedAs: 'struck' });
  });

  test('the abort age decides between running and aborted, with now as a Date or in milliseconds', () => {
    const input = stateInputAt(BEACON);
    const spec = (items: readonly ItemStateInfo[], id: string) => itemOf(items, 'spec', id).state;
    const wide = itemStates({ ...input, abortAfterMs: 300 * MIN });
    expect([spec(wide, '006'), spec(wide, '003')]).toEqual(['running', 'running']);
    const narrow = itemStates({ ...input, now: new Date('2026-03-08T15:00:00Z').getTime(), abortAfterMs: 5 * MIN });
    expect([spec(narrow, '006'), spec(narrow, '003'), spec(narrow, '005')]).toEqual(['aborted', 'aborted', 'aborted']);
    // With one running and one aborted run on 005, the running one decides and counts alone.
    const mixed = itemOf(itemStates({ ...input, abortAfterMs: 30 * MIN }), 'spec', '005');
    expect(mixed).toMatchObject({ state: 'running', run: { run: 'r-0308-1440', openRuns: 1 } });
    expect(goldenText(itemStates({ ...input, now: new Date('2026-03-08T15:00:00Z').getTime() }))).toBe(goldenText(itemStates(input)));
  });

  test('the defaults: 120 minutes to abort a run, the live frame stale age for a claim lock', () => {
    expect(DEFAULT_ABORT_AFTER_MS).toBe(120 * MIN);
    expect(DEFAULT_CLAIM_STALE_MS).toBe(LIVE_STALE_MS);
  });

  test('the state table has one row per item kind and state, each with its meaning, entry and exit', () => {
    expect(STATE_TABLE.map((r) => `${r.kind} ${r.state}`)).toEqual(KINDS.flatMap((kind) => STATES.map((state) => `${kind} ${state}`)));
    expect(STATE_TABLE.filter((r) => [r.meaning, r.entered, r.left].some((text) => text.trim() === ''))).toEqual([]);
  });
});
