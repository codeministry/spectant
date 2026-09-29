import type { TaskCheckResult } from '../../../../core/api.service';
import { type CheckState, checkBlock, checkedFromLine, IDLE, landedDelta, nextCheckState, rowChecked, withCheck } from './checkbox';
import type { TaskRowView } from './tasks-tab';

const row = (over: Partial<TaskRowView> = {}): TaskRowView =>
  ({
    id: 'T31',
    claim: 'ISC-77',
    flags: { parallel: false, seam: false },
    lane: 'operator',
    state: 'open',
    status: 'open',
    edges: [],
    paths: [],
    text: 'screen-reader pass',
    line: 49,
    round: null,
    builder: null,
    reason: null,
    note: null,
    pathNote: null,
    ...over,
  });

const ok = (checked: boolean, text: string): TaskCheckResult => ({
  kind: 'ok',
  body: { task: 'T31', checked, hash: 'b'.repeat(64), lockSource: 'none', line: { number: 49, text } },
});
const conflict: TaskCheckResult = { kind: 'conflict', body: { error: 'hash-mismatch', expected: { tasks: 'c'.repeat(64) } } };
const locked: TaskCheckResult = {
  kind: 'locked',
  body: { error: 'locked', lock: { source: 'frontier', claim: 'ISC-77', session: 'spec-002-ISC-77', since: '2026-09-01T08:00:00Z' } },
};

describe('checkbox state machine', () => {
  it('a tick from idle is saving with the state wanted', () => {
    expect(nextCheckState(IDLE, { type: 'tick', checked: true })).toEqual({ kind: 'saving', checked: true });
  });

  it('a second tick while saving is ignored', () => {
    const saving: CheckState = { kind: 'saving', checked: true };
    expect(nextCheckState(saving, { type: 'tick', checked: false })).toBe(saving);
  });

  it('a 200 is written, the checkbox taken from the answer line', () => {
    const saving: CheckState = { kind: 'saving', checked: true };
    expect(nextCheckState(saving, { type: 'answer', result: ok(true, '- [x] T31 · ISC-77 · operator — pass') })).toEqual({
      kind: 'written',
      checked: true,
      line: 49,
    });
    // The line wins over the echoed flag: it is what tasks.md now holds.
    expect(nextCheckState(saving, { type: 'answer', result: ok(true, '- [ ] T31 · ISC-77 · operator — pass') })).toEqual({
      kind: 'written',
      checked: false,
      line: 49,
    });
  });

  it('a 409 is a conflict and applies nothing; reload returns to idle', () => {
    const state = nextCheckState({ kind: 'saving', checked: true }, { type: 'answer', result: conflict });
    expect(state).toEqual({ kind: 'conflict' });
    expect(nextCheckState(state, { type: 'reload' })).toBe(IDLE);
  });

  it('a 423 is locked with the session the answer names', () => {
    expect(nextCheckState({ kind: 'saving', checked: false }, { type: 'answer', result: locked })).toEqual({
      kind: 'locked',
      session: 'spec-002-ISC-77',
    });
  });

  it('any other answer is failed with its status, and a new tick retries', () => {
    const failed = nextCheckState({ kind: 'saving', checked: true }, { type: 'answer', result: { kind: 'error', status: 0 } });
    expect(failed).toEqual({ kind: 'failed', status: 0 });
    expect(nextCheckState(failed, { type: 'tick', checked: true })).toEqual({ kind: 'saving', checked: true });
    expect(nextCheckState({ kind: 'locked', session: 's' }, { type: 'tick', checked: true })).toEqual({ kind: 'saving', checked: true });
  });

  it('an answer outside saving (the list reloaded meanwhile) changes nothing', () => {
    expect(nextCheckState(IDLE, { type: 'answer', result: conflict })).toBe(IDLE);
  });
});

describe('checkedFromLine', () => {
  it('reads the box of a task line, null for anything else', () => {
    expect(checkedFromLine('- [x] T1 · ISC-1 · web — a')).toBe(true);
    expect(checkedFromLine('- [X] T1 · ISC-1 · web — a')).toBe(true);
    expect(checkedFromLine('  - [ ] T1 · ISC-1 · web — a')).toBe(false);
    expect(checkedFromLine('## Tasks')).toBeNull();
  });
});

describe('row view', () => {
  it('shows the wanted state while saving, the written one after, the file otherwise', () => {
    expect(rowChecked(row(), IDLE)).toBe(false);
    expect(rowChecked(row(), { kind: 'saving', checked: true })).toBe(true);
    expect(rowChecked(row({ state: 'done' }), { kind: 'conflict' })).toBe(true);
  });

  it('a written tick marks the row done, an untick open; the landed count follows', () => {
    const written: CheckState = { kind: 'written', checked: true, line: 49 };
    expect(withCheck(row(), written)).toMatchObject({ state: 'done', status: 'done' });
    expect(withCheck(row({ state: 'done', status: 'closed' }), { kind: 'written', checked: false, line: 49 })).toMatchObject({
      state: 'open',
      status: 'open',
    });
    const same = row({ state: 'done', status: 'closed' });
    expect(withCheck(same, { kind: 'written', checked: true, line: 49 })).toBe(same);
    expect(landedDelta(row(), written)).toBe(1);
    expect(landedDelta(row({ state: 'done' }), { kind: 'written', checked: false, line: 49 })).toBe(-1);
    expect(landedDelta(row(), IDLE)).toBe(0);
  });

  it('blocks the box while saving, under a lock on its claim, and without a hash; operator rows are not blocked', () => {
    const lock = { claim: 'ISC-77', session: 'spec-002-ISC-77' };
    expect(checkBlock(row(), IDLE, null, 'h')).toBeNull();
    expect(checkBlock(row({ lane: 'operator' }), IDLE, { claim: 'ISC-1', session: 'x' }, 'h')).toBeNull();
    expect(checkBlock(row(), { kind: 'saving', checked: true }, null, 'h')).toEqual({ kind: 'saving' });
    expect(checkBlock(row(), IDLE, lock, 'h')).toEqual({ kind: 'locked', session: 'spec-002-ISC-77' });
    expect(checkBlock(row(), IDLE, null, null)).toEqual({ kind: 'no-hash' });
  });
});
