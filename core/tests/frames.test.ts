// Frames from rounds.jsonl (T17, ISC-87): per round a dispatch frame and a result frame, the worst state per frame,
// task states carried forward, and the re-cut hook T18 (ISC-91) and T19 (ISC-92) build on.
//
// The exact states below are counted by hand from `core/fixtures/harbor/specs/002-web-console/rounds.jsonl` (three
// rounds, a re-cut between R2 and R3 that strikes T33, renumbers T27–T32 and adds T34, which tasks.md strikes after
// R3). The live frame (T21) is built only where the eleven states are counted (T27): the rounds hold nine, the live
// frame adds running and absent. Spec 001's own rounds.jsonl (`spectant-001/`) is compared with its golden.
//
// T18 (`detectRecut`) and T19 (`buildMatrix`) are stubs today: their cases stand below as `test.todo` with the
// assertions written, run with `bun test --todo core/tests/frames.test.ts`; the task that fills a stub turns its
// cases into plain tests.
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { CardState, Frame, FrameCard, MatrixCell, SpecFiles } from '../src/files.ts';
import { buildFrames, CARD_SEVERITY, worstState } from '../src/frames.ts';
import { buildLiveFrame } from '../src/live.ts';
import { readLockSources } from '../src/locks.ts';
import { buildMatrix } from '../src/matrix.ts';
import { detectRecut, recutBetween, sameTask } from '../src/recut.ts';
import { lanesOf } from '../src/tasks.ts';
import { goldenPath } from './helpers/golden.ts';
import { FIXTURES, folders, readTreeAt } from './helpers/read-tree.ts';

function specFiles(tree: string, folder: string): SpecFiles {
  const files = folders(join(FIXTURES, tree, 'specs')).find((f) => f.folder === folder);
  if (!files) throw new Error(`fixture ${tree}/${folder} missing`);
  return files;
}

const harbor = specFiles('harbor', '002-web-console');
const spectant = specFiles('spectant-001', '001-app-skeleton');
const frames = buildFrames(harbor);

/** A frame's cards as `state → ids`, in card order, for exact comparison. */
function byState(frame: Frame | undefined): Partial<Record<CardState, string[]>> {
  const out: Partial<Record<CardState, string[]>> = {};
  for (const card of frame?.cards ?? []) (out[card.state] ??= []).push(card.task);
  return out;
}

const ids = (from: number, to: number): string[] => Array.from({ length: to - from + 1 }, (_, i) => `T${from + i}`);
const card = (frame: Frame | undefined, task: string): FrameCard | undefined => frame?.cards.find((c) => c.task === task);

/** A rounds.jsonl line with the fields the frames read; `tasks` as `[id, text, state]`. */
function line(round: number, dispatched: string[], tasks: Array<[string, string, string]>, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    v: 1,
    round,
    ts: `2026-03-0${round}T10:00:00Z`,
    mode: 'agent',
    width: 2,
    dispatched,
    tasks: tasks.map(([id, text, state]) => ({ id, claim: 'ISC-1', lane: 'core', seam: false, parallel: true, text, paths: [], state, reason: 'r' })),
    claims: { closed: [], open: ['ISC-1'], closed_this_round: [] },
    progress: '0/1',
    ...extra,
  });
}

const synthetic = (...lines: string[]): SpecFiles => ({ folder: '009-synthetic', texts: { rounds: lines.join('\n') } });

describe('harbor 002: frame sequence', () => {
  test('three rounds give six frames, dispatch before result, indexed in time order', () => {
    expect(frames.map((f) => [f.index, f.kind, f.round, f.label])).toEqual([
      [0, 'dispatch', 1, 'R1 dispatch'],
      [1, 'result', 1, 'R1'],
      [2, 'dispatch', 2, 'R2 dispatch'],
      [3, 'result', 2, 'R2'],
      [4, 'dispatch', 3, 'R3 dispatch'],
      [5, 'result', 3, 'R3'],
    ]);
    expect(frames.map((f) => f.ts)).toEqual([
      '2026-03-06T09:10:00Z',
      '2026-03-06T09:10:00Z',
      '2026-03-07T11:20:00Z',
      '2026-03-07T11:20:00Z',
      '2026-03-08T16:30:00Z',
      '2026-03-08T16:30:00Z',
    ]);
  });

  test('no live frame: T21 adds it', () => {
    expect(frames.some((f) => f.kind === 'live')).toBe(false);
  });

  test('the stop reason sits on the stopping round only, both frames', () => {
    expect(frames.map((f) => f.stop ?? null)).toEqual([null, null, null, null, 'a decision only the principal can make', 'a decision only the principal can make']);
  });
});

describe('harbor 002: exact card states per frame', () => {
  test('R1 dispatch: T1–T10 dispatched, the rest waiting, the operator steps open', () => {
    expect(byState(frames[0])).toEqual({
      dispatched: ids(1, 10),
      waiting: [...ids(11, 30), 'T33'],
      operatorOpen: ['T31', 'T32'],
    });
  });

  test('R1 result: T1–T10 closed', () => {
    expect(byState(frames[1])).toEqual({
      closed: ids(1, 10),
      waiting: [...ids(11, 30), 'T33'],
      operatorOpen: ['T31', 'T32'],
    });
  });

  test('R2 dispatch: R1 carried forward, the ten dispatched', () => {
    expect(byState(frames[2])).toEqual({
      closed: ids(1, 10),
      dispatched: ['T11', 'T14', 'T15', 'T16', 'T17', 'T18', 'T20', 'T22', 'T23', 'T30'],
      waiting: ['T12', 'T13', 'T19', 'T21', 'T24', 'T25', 'T26', 'T27', 'T28', 'T29', 'T33'],
      operatorOpen: ['T31', 'T32'],
    });
  });

  test('R2 result: a fail, concerns, a done, a question', () => {
    expect(byState(frames[3])).toEqual({
      closed: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T15', 'T16', 'T18', 'T20', 'T23'],
      waiting: ['T12', 'T13', 'T19', 'T21', 'T24', 'T25', 'T26', 'T27', 'T28', 'T29', 'T33'],
      fail: ['T14'],
      concerns: ['T17'],
      done: ['T22'],
      question: ['T30'],
      operatorOpen: ['T31', 'T32'],
    });
  });

  test('R3 dispatch: carried where the id kept its task, own line where the re-cut renumbered it', () => {
    expect(byState(frames[4])).toEqual({
      closed: ['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T15', 'T16', 'T18', 'T20', 'T23'],
      dispatched: ['T12', 'T13', 'T14', 'T17', 'T19', 'T21', 'T24', 'T25', 'T26', 'T27'],
      done: ['T22'],
      waiting: ['T28', 'T32', 'T34'],
      question: ['T29'],
      operatorDone: ['T30'],
      operatorOpen: ['T31'],
    });
  });

  test('R3 result: T1–T26 closed, T27 still in flight, one question, one operator step done', () => {
    expect(byState(frames[5])).toEqual({
      closed: ids(1, 26),
      dispatched: ['T27'],
      waiting: ['T28', 'T32', 'T34'],
      question: ['T29'],
      operatorDone: ['T30'],
      operatorOpen: ['T31'],
    });
  });

  test('the frames hold nine of the eleven states; running comes from locks (T21), absent from the re-cut (T18)', () => {
    const found = new Set(frames.flatMap((f) => f.cards.map((c) => c.state)));
    const eleven: CardState[] = ['waiting', 'dispatched', 'running', 'question', 'concerns', 'fail', 'done', 'closed', 'absent', 'operatorOpen', 'operatorDone'];
    expect(eleven.filter((s) => !found.has(s))).toEqual(['running', 'absent']);
    expect([...found].every((s) => eleven.includes(s))).toBe(true);
  });
});

describe('worst state per frame', () => {
  test('the severity order is documented and total over the eleven states', () => {
    expect(CARD_SEVERITY).toEqual(['fail', 'question', 'concerns', 'waiting', 'operatorOpen', 'dispatched', 'running', 'done', 'operatorDone', 'closed', 'absent']);
  });

  test('harbor: waiting until R2 lands a fail, then the question', () => {
    expect(frames.map((f) => f.worst)).toEqual(['waiting', 'waiting', 'waiting', 'fail', 'question', 'question']);
  });

  test('worstState picks by the order and falls back to closed for no cards', () => {
    expect(worstState(['closed', 'done', 'dispatched'])).toBe('dispatched');
    expect(worstState(['operatorDone', 'concerns', 'question'])).toBe('question');
    expect(worstState([])).toBe('closed');
  });

  test('every frame of every card-carrying tree names the worst state its cards hold', () => {
    for (const f of [...frames, ...buildFrames(spectant)]) expect(f.worst).toBe(worstState(f.cards.map((c) => c.state)));
  });
});

describe('carry-forward and card payloads', () => {
  test('a waiting card keeps the hold reason the line gives', () => {
    expect(card(frames[0], 'T11')?.reason).toBe('width 10 reached');
    expect(card(frames[0], 'T12')?.reason).toBe('after T11 still open');
    expect(card(frames[0], 'T31')?.reason).toBe("operator lane — the principal's own action, never auto-dispatched");
  });

  test('a done card of R2 shows done at R3 dispatch, although the R3 line records it closed', () => {
    expect(card(frames[3], 'T22')?.state).toBe('done');
    expect(card(frames[4], 'T22')?.state).toBe('done');
    expect(card(frames[5], 'T22')?.state).toBe('closed');
  });

  test('the fail and the concerns carry note, reader and verdict as the line has them', () => {
    expect(card(frames[3], 'T14')).toMatchObject({ state: 'fail', builder: 'Engineer', tries: 1, note: 'probe exit 1 — `bun run e2e -- tag-table -g narrow` · the digest column overflows at 390 px' });
    expect(card(frames[3], 'T17')).toMatchObject({ state: 'concerns', builder: 'Engineer', reader: 'Forge', verdict: 'concerns', tries: 1 });
    expect(card(frames[3], 'T30')?.note).toBe('question: should the empty state link to the sync docs or to the settings page?');
  });

  test('a retry counts its tries and carries its retry note into the dispatch frame', () => {
    expect(card(frames[4], 'T14')).toMatchObject({ state: 'dispatched', tries: 2, builder: 'Anvil', note: 'retry with: probe exit 1 — wrap the digest column below 480 px' });
    expect(card(frames[5], 'T14')).toMatchObject({ state: 'closed', tries: 2, builder: 'Anvil', reader: 'Forge', verdict: 'pass' });
    expect(card(frames[5], 'T17')?.tries).toBe(2);
    // a first dispatch carries no result payload: the R2 question text is not on the R2 dispatch card
    expect(card(frames[2], 'T30')).toMatchObject({ state: 'dispatched', tries: 1 });
    expect(card(frames[2], 'T30')?.note).toBeUndefined();
  });

  test('a never-dispatched card has zero tries and no builder', () => {
    expect(card(frames[0], 'T11')).toMatchObject({ tries: 0 });
    expect(card(frames[0], 'T11')?.builder).toBeUndefined();
  });

  test('lane, claim, text and flags come from the line', () => {
    expect(card(frames[0], 'T1')).toMatchObject({ claim: 'ISC-51', lane: 'api', seam: true, parallel: false, text: 'history endpoint contract: run, repository, digest, failure' });
  });
});

describe('progress and closed claims', () => {
  test('result frames read progress; dispatch frames count the claims closed before the round', () => {
    expect(frames.map((f) => [f.progress.claims.closed, f.progress.claims.total, f.progress.tasks.landed, f.progress.tasks.total])).toEqual([
      [0, 30, 0, 33],
      [9, 30, 10, 33],
      [9, 30, 10, 33],
      [15, 30, 17, 33],
      [15, 30, 18, 33],
      [25, 30, 27, 33],
    ]);
  });

  test('closedClaims: the claims a result frame closed; none on a dispatch frame', () => {
    expect(frames.map((f) => f.closedClaims?.length)).toEqual([0, 9, 0, 6, 0, 10]);
    expect(frames[3]?.closedClaims).toEqual(['ISC-60', 'ISC-62', 'ISC-63', 'ISC-65', 'ISC-67', 'ISC-70']);
  });
});

describe('recut hook (ISC-91, completed by T18)', () => {
  test('harbor: the R3 dispatch frame carries the re-cut: T33 struck, T34 added, T27–T32 renumbered', () => {
    expect(frames.map((f) => f.recut !== undefined)).toEqual([false, false, false, false, true, false]);
    expect(frames[4]?.recut).toEqual({ struck: ['T33'], added: ['T34'], changed: ['T27', 'T28', 'T29', 'T30', 'T31', 'T32'] });
  });

  test('harbor: no state attributed to a renumbered id', () => {
    const before = frames[3];
    const after = frames[4];
    // old T30 held the question; new T30 is the operator step, done on its own line
    expect(card(before, 'T30')?.state).toBe('question');
    expect(card(after, 'T30')).toMatchObject({ state: 'operatorDone', tries: 0, lane: 'operator' });
    expect(card(after, 'T30')?.note).toBeUndefined();
    // old T27 waited; new T27 is dispatched for the first time
    expect(card(after, 'T27')).toMatchObject({ state: 'dispatched', tries: 1, claim: 'ISC-74' });
    // no card of the recut frame carries the previous frame's text for its id
    for (const id of after?.recut?.changed ?? []) expect(card(after, id)?.text).not.toBe(card(before, id)?.text);
    // the struck id is gone from every later frame
    for (const f of frames.slice(4)) expect(card(f, 'T33')).toBeUndefined();
  });

  test('spectant-001: nine rounds, eighteen frames, the re-cut before R5', () => {
    const own = buildFrames(spectant);
    expect(own.length).toBe(18);
    expect(own.map((f) => f.round)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9]);
    expect(own.filter((f) => f.recut).map((f) => [f.index, f.label])).toEqual([[8, 'R5 dispatch']]);
    expect(own[8]?.recut?.struck).toEqual(ids(84, 97));
    expect(own[8]?.recut?.added).toEqual([]);
    expect(own.map((f) => f.cards.length)).toEqual([97, 97, 97, 97, 97, 97, 97, 97, 83, 83, 83, 83, 83, 83, 83, 83, 83, 83]);
    expect(own.at(-1)?.progress.claims).toEqual({ closed: 14, total: 47 });
  });

  test('synthetic: a text change breaks the chain, tries restart and the old state stays behind', () => {
    const built = buildFrames(
      synthetic(
        line(1, ['T1', 'T2'], [['T1', 'parse', 'fail'], ['T2', 'render', 'question']]),
        line(2, ['T2'], [['T1', 'parse', 'fail'], ['T2', 'render the table', 'held']]),
      ),
    );
    expect(built[2]?.recut).toEqual({ struck: [], added: [], changed: ['T2'] });
    expect(card(built[2], 'T1')).toMatchObject({ state: 'fail', tries: 1 });
    expect(card(built[2], 'T2')).toMatchObject({ state: 'dispatched', tries: 1 });
    expect(card(built[3], 'T2')).toMatchObject({ state: 'waiting', tries: 1 });
  });

  test('synthetic: an added id is a re-cut too, and gets its own line state', () => {
    const built = buildFrames(synthetic(line(1, ['T1'], [['T1', 'a', 'done']]), line(2, [], [['T1', 'a', 'closed'], ['T2', 'b', 'held']])));
    expect(built[2]?.recut).toEqual({ struck: [], added: ['T2'], changed: [] });
    expect(card(built[2], 'T1')?.state).toBe('done');
    expect(card(built[2], 'T2')?.state).toBe('waiting');
  });
});

describe('reading rounds.jsonl', () => {
  test('no rounds file, an empty one: no frames', () => {
    expect(buildFrames({ folder: '009-x', texts: {} })).toEqual([]);
    expect(buildFrames(synthetic('', '  '))).toEqual([]);
  });

  test('a malformed line, one without round or ts, one with an unparseable ts: skipped', () => {
    const good = line(1, [], [['T1', 'a', 'held']]);
    const built = buildFrames(synthetic('{not json', JSON.stringify({ ts: '2026-03-01T00:00:00Z' }), JSON.stringify({ round: 2 }), JSON.stringify({ round: 3, ts: 'soon' }), good));
    expect(built.map((f) => f.round)).toEqual([1, 1]);
  });

  test('lines sort by their instant, not by file position', () => {
    const built = buildFrames(synthetic(line(2, [], [['T1', 'a', 'held']]), line(1, [], [['T1', 'a', 'held']])));
    expect(built.map((f) => [f.index, f.round])).toEqual([
      [0, 1],
      [1, 1],
      [2, 2],
      [3, 2],
    ]);
  });

  test('state words: held and skipped wait, operator lane maps to operator open/done, an unknown word waits', () => {
    const tasks = [
      { id: 'T1', claim: 'ISC-1', lane: 'core', text: 'a', state: 'skipped', reason: 'held for 001' },
      { id: 'T2', claim: 'ISC-1', lane: 'operator', text: 'b', state: 'held' },
      { id: 'T3', claim: 'ISC-1', lane: 'operator', text: 'c', state: 'closed' },
      { id: 'T4', claim: 'ISC-1', lane: 'core', text: 'd', state: 'wobbly' },
    ];
    const built = buildFrames(synthetic(JSON.stringify({ round: 1, ts: '2026-03-01T00:00:00Z', dispatched: [], tasks, claims: {}, progress: 'x' })));
    expect(built[1]?.cards.map((c) => [c.task, c.state, c.reason ?? null])).toEqual([
      ['T1', 'waiting', 'held for 001'],
      ['T2', 'operatorOpen', null],
      ['T3', 'operatorDone', null],
      ['T4', 'waiting', 'state "wobbly"'],
    ]);
    // no progress string and no claim lists: zero of zero, not a throw
    expect(built[1]?.progress.claims).toEqual({ closed: 0, total: 0 });
  });
});

describe('purity', () => {
  test('same input twice gives deep-equal output, and the input is untouched', () => {
    const texts = { ...harbor.texts };
    const snapshot = JSON.stringify(harbor);
    const a = buildFrames(harbor);
    const b = buildFrames(harbor);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
    expect(JSON.stringify(harbor)).toBe(snapshot);
    expect(harbor.texts).toEqual(texts);
  });
});

// ── T27: the live frame on harbor 002, spec 001's own rounds against the golden, re-cut and matrix cases ──────────

const LIVE_NOW = new Date('2026-03-08T15:00:00Z');
const harborConstitution = readTreeAt(join(FIXTURES, 'harbor')).constitution;
const harborLive = buildLiveFrame({
  files: { ...harbor, texts: { ...harbor.texts, ...(harborConstitution === null ? {} : { constitution: harborConstitution }) } },
  locks: await readLockSources({ repoRoot: join(FIXTURES, 'harbor') }),
  frames,
  now: LIVE_NOW,
});
const spectantFrames = buildFrames(spectant);

/** The golden frames of one spec folder, as the golden test wrote them. */
function goldenFrames(tree: string, folder: string): unknown {
  const all = JSON.parse(readFileSync(goldenPath(tree, 'frames'), 'utf8')) as Record<string, unknown>;
  return all[`specs/${folder}`];
}

describe('harbor 002: the live frame completes the eleven states (T21 over T17)', () => {
  test('the first frame each state appears in: nine from the rounds, running and absent from the live frame', () => {
    const first = new Map<CardState, number>();
    for (const f of [...frames, harborLive]) for (const c of f.cards) if (!first.has(c.state)) first.set(c.state, f.index);
    expect(Object.fromEntries([...first].sort(([a], [b]) => a.localeCompare(b)))).toEqual({
      absent: 6,
      closed: 1,
      concerns: 3,
      dispatched: 0,
      done: 3,
      fail: 3,
      operatorDone: 4,
      operatorOpen: 0,
      question: 3,
      running: 6,
      waiting: 0,
    });
    expect([...first.keys()].sort()).toEqual([...CARD_SEVERITY].sort());
  });

  test('T34, held in R3 and struck after it, is absent live with its strike note; T33 of the re-cut has no card', () => {
    expect(card(frames[5], 'T34')).toMatchObject({ state: 'waiting', reason: 'after T31 still open', tries: 0 });
    expect(card(harborLive, 'T34')).toMatchObject({ state: 'absent', tries: 0, note: "struck 2026-03-08: covered by T32's keyboard probe" });
    expect(card(harborLive, 'T34')?.reason).toBeUndefined();
    expect(card(harborLive, 'T33')).toBeUndefined();
  });

  test('T27 runs under its session; the released T25 does not', () => {
    expect(card(harborLive, 'T27')).toMatchObject({ state: 'running', lock: { source: 'activity', session: 'spec-002-ISC-74' } });
    expect(card(harborLive, 'T25')?.state).toBe('closed');
  });

  test('worst state per frame, the live frame included: absent counts least', () => {
    expect([...frames, harborLive].map((f) => f.worst)).toEqual(['waiting', 'waiting', 'waiting', 'fail', 'question', 'question', 'question']);
    expect(harborLive.worst).toBe(worstState(harborLive.cards.map((c) => c.state)));
    // nothing outstanding: a frame of landed and struck cards reads closed, as one without cards does
    expect(worstState(['absent', 'closed'])).toBe('closed');
    expect(worstState(['absent'])).toBe('closed');
  });

  test('the live frame keeps the absent card on the board but out of the task progress', () => {
    expect(harborLive.index).toBe(frames.length);
    expect(harborLive.cards.length).toBe(33);
    expect(harborLive.progress.tasks.total).toBe(32);
  });

  test('harbor 002 frames equal the golden', () => {
    expect(JSON.parse(JSON.stringify(frames))).toEqual(goldenFrames('harbor', '002-web-console') as Frame[]);
  });
});

describe("spectant-001: this repository's own rounds.jsonl", () => {
  test('the frames equal the golden', () => {
    expect(JSON.parse(JSON.stringify(spectantFrames))).toEqual(goldenFrames('spectant-001', '001-app-skeleton') as Frame[]);
  });

  test('the ids struck in the R5 re-cut have a card up to R4 and none from R5 on', () => {
    for (const id of ids(84, 97)) {
      expect(spectantFrames.slice(0, 8).every((f) => card(f, id) !== undefined)).toBe(true);
      expect(spectantFrames.slice(8).some((f) => card(f, id) !== undefined)).toBe(false);
    }
  });

  test('a renumbered id of the R5 re-cut carries no try count across it', () => {
    const changed = spectantFrames[8]?.recut?.changed ?? [];
    expect(changed.length).toBeGreaterThan(0);
    for (const id of changed) {
      const after = card(spectantFrames[8], id);
      expect(after?.tries).toBe(after?.state === 'dispatched' ? 1 : 0);
    }
  });
});

describe('re-cut markers (T18, detectRecut)', () => {
  test('harbor: one marker before frame 4, R2 → R3, T33 struck, T34 added, T27–T32 changed', () => {
    expect(detectRecut(frames)).toEqual([{ beforeFrame: 4, fromRound: 2, toRound: 3, struck: ['T33'], added: ['T34'], changed: ids(27, 32) }]);
  });

  test('spectant-001: one marker before frame 8, R4 → R5, T84–T97 struck', () => {
    const markers = detectRecut(spectantFrames);
    expect(markers.map((m) => [m.beforeFrame, m.fromRound, m.toRound])).toEqual([[8, 4, 5]]);
    expect(markers[0]?.struck).toEqual(ids(84, 97));
    expect(markers[0]?.changed).toEqual(spectantFrames[8]?.recut?.changed ?? []);
  });

  test('every marker equals the recut its frame carries: one rule, no second reading', () => {
    for (const built of [frames, spectantFrames]) {
      const markers = detectRecut(built);
      expect(markers.map((m) => m.beforeFrame)).toEqual(built.filter((f) => f.recut).map((f) => f.index));
      for (const m of markers) expect(built[m.beforeFrame]?.recut).toEqual({ struck: m.struck, added: m.added, changed: m.changed });
    }
    expect(detectRecut([])).toEqual([]);
    expect(detectRecut([...frames, harborLive])).toEqual(detectRecut(frames));
  });

  test('spectant-001: a text that moved to another id in the R5 re-cut takes no state or try with it', () => {
    const before = spectantFrames[7];
    const after = spectantFrames[8];
    const moved = (before?.cards ?? []).flatMap((old) => {
      const now = after?.cards.find((c) => c.text === old.text && c.task !== old.task);
      return now === undefined ? [] : [{ old, now }];
    });
    expect(moved.length).toBeGreaterThan(0);
    for (const { old, now } of moved) {
      // the old id is struck or changed, the new one added or changed: never the same task
      expect([...(after?.recut?.struck ?? []), ...(after?.recut?.changed ?? [])]).toContain(old.task);
      expect([...(after?.recut?.added ?? []), ...(after?.recut?.changed ?? [])]).toContain(now.task);
      expect(now.tries).toBe(now.state === 'dispatched' ? 1 : 0);
    }
  });

  test('recutBetween: the five cases of the one rule', () => {
    const board = [
      { id: 'T1', text: 'parse' },
      { id: 'T2', text: 'render' },
      { id: 'T3', text: 'ship' },
    ];
    expect(recutBetween(board, board)).toBeNull();
    // same text under a new id: renumbered, the old id struck and the new one added
    expect(recutBetween(board, [...board.slice(0, 2), { id: 'T4', text: 'ship' }])).toEqual({ struck: ['T3'], added: ['T4'], changed: [] });
    // same id with another text: changed; a missing id: struck; a new id with a new text: added
    expect(recutBetween(board, [{ id: 'T1', text: 'parse the header' }, { id: 'T3', text: 'ship' }, { id: 'T5', text: 'docs' }])).toEqual({
      struck: ['T2'],
      added: ['T5'],
      changed: ['T1'],
    });
    expect(sameTask({ id: 'T1', text: 'parse' }, { id: 'T1', text: 'parse' })).toBe(true);
    expect(sameTask({ id: 'T1', text: 'parse' }, { id: 'T9', text: 'parse' })).toBe(false);
  });

  test('synthetic: a renumbered text starts fresh under its new id', () => {
    const built = buildFrames(synthetic(line(1, ['T1'], [['T1', 'parse', 'fail']]), line(2, [], [['T2', 'parse', 'held']])));
    expect(built[2]?.recut).toEqual({ struck: ['T1'], added: ['T2'], changed: [] });
    expect(card(built[2], 'T2')).toMatchObject({ state: 'waiting', tries: 0 });
    expect(card(built[2], 'T1')).toBeUndefined();
  });
});

describe('matrix cells (T19, buildMatrix)', () => {
  /** Every frame column's cell holds that frame's card state for the row's task, null where the task has no card. */
  function expectCellsFollowFrames(built: readonly Frame[]): void {
    const matrix = buildMatrix(built);
    matrix.rows.forEach((task, r) => {
      matrix.columns.forEach((column, c) => {
        const cell = matrix.cells[r]?.[c];
        expect(cell?.task).toBe(task);
        expect(cell?.column).toBe(c);
        expect(cell?.frame).toBe(column.frame);
        if (column.kind !== 'recut') expect(cell?.state).toBe(card(built[column.frame ?? -1], task)?.state ?? null);
      });
    });
  }

  const harborLanes = harborConstitution === null ? [] : lanesOf(harborConstitution);
  const withLive: readonly Frame[] = [...frames, harborLive];

  test('spectant-001: one column per frame in scrubber order, plus one re-cut column before R5', () => {
    const matrix = buildMatrix(spectantFrames);
    const frameColumns = matrix.columns.filter((c) => c.kind !== 'recut');
    expect(frameColumns.map((c) => c.frame)).toEqual(spectantFrames.map((f) => f.index));
    expect(frameColumns.map((c) => c.label)).toEqual(spectantFrames.map((f) => f.label));
    expect(matrix.columns.findIndex((c) => c.kind === 'recut')).toBe(8);
    expectCellsFollowFrames(spectantFrames);
  });

  test('spectant-001: a struck task is dashed (null, gap absent) in every column after the re-cut', () => {
    const matrix = buildMatrix(spectantFrames);
    const row = matrix.rows.indexOf('T97');
    const after = matrix.columns.flatMap((c, i) => (c.frame !== null && c.frame >= 8 ? [i] : []));
    expect(after.map((i) => matrix.cells[row]?.[i]?.state)).toEqual(after.map(() => null));
    expect(after.map((i) => matrix.cells[row]?.[i]?.gap)).toEqual(after.map(() => 'absent'));
  });

  test('harbor 002: cells follow the frames, the re-cut column sits before R3 dispatch', () => {
    const matrix = buildMatrix(frames);
    expect(matrix.columns.map((c) => c.kind)).toEqual(['dispatch', 'result', 'dispatch', 'result', 'recut', 'dispatch', 'result']);
    expect(matrix.columns[4]).toEqual({ kind: 'recut', frame: null, label: 'R2 → R3' });
    expectCellsFollowFrames(frames);
  });

  test('harbor 002 with the live frame: a live column last, T34 none before R3 and absent live, T33 absent after R2', () => {
    const matrix = buildMatrix(withLive, [], harborLanes);
    expect(matrix.columns.at(-1)).toEqual({ kind: 'live', frame: 6, label: 'Live' });
    const cells = (task: string): readonly MatrixCell[] => matrix.cells[matrix.rows.indexOf(task)] ?? [];
    expect(cells('T34').map((c) => c.state)).toEqual([null, null, null, null, null, 'waiting', 'waiting', 'absent']);
    expect(cells('T34').map((c) => c.gap)).toEqual(['none', 'none', 'none', 'none', undefined, undefined, undefined, undefined]);
    expect(cells('T33').map((c) => c.state)).toEqual(['waiting', 'waiting', 'waiting', 'waiting', null, null, null, null]);
    expect(cells('T33').map((c) => c.gap)).toEqual([undefined, undefined, undefined, undefined, undefined, 'absent', 'absent', 'absent']);
    expectCellsFollowFrames(withLive);
  });

  test('harbor 002: the re-cut column marks each row the re-cut touched, and nothing else', () => {
    const matrix = buildMatrix(frames);
    const marks = Object.fromEntries(
      matrix.rows.flatMap((task, r) => {
        const mark = matrix.cells[r]?.[4]?.recut;
        return mark === undefined ? [] : [[task, mark]];
      }),
    );
    expect(marks).toEqual({ T27: 'changed', T28: 'changed', T29: 'changed', T30: 'changed', T31: 'changed', T32: 'changed', T33: 'struck', T34: 'added' });
    expect(matrix.cells.every((row) => row[4]?.state === null && row[4].gap === undefined)).toBe(true);
  });

  test('rows: every task that ever had a card, by lane in constitution order, operator last, first seen within a lane', () => {
    const matrix = buildMatrix(withLive, [], harborLanes);
    expect(matrix.details.map((d) => d.task)).toEqual([...matrix.rows]);
    expect(matrix.rows).toEqual(['T1', ...ids(2, 29), 'T32', 'T33', 'T34', 'T30', 'T31']);
    expect([...new Set(matrix.details.map((d) => d.lane))]).toEqual(['api', 'web', 'operator']);
    expect(harborLanes.indexOf('api')).toBeLessThan(harborLanes.indexOf('web'));
    // a row carries its latest card's claim, lane and text: T30 moved into the operator lane in the R3 re-cut
    const last = (task: string): FrameCard | undefined => withLive.flatMap((f) => f.cards).filter((c) => c.task === task).at(-1);
    for (const d of matrix.details) expect([d.claim, d.lane, d.text]).toEqual([last(d.task)?.claim ?? '', last(d.task)?.lane ?? '', last(d.task)?.text ?? '']);
  });

  test('without a constitution, lanes come first seen and operator last; a re-cut marker alone adds its column', () => {
    const plain = frames.map((frame): Frame => ({ ...frame, recut: undefined }));
    const matrix = buildMatrix(plain, [{ beforeFrame: 4, fromRound: 2, toRound: 3, struck: ['T33'], added: ['T34'], changed: [] }]);
    expect([...new Set(matrix.details.map((d) => d.lane))].at(-1)).toBe('operator');
    expect(matrix.columns.map((c) => c.kind)).toEqual(['dispatch', 'result', 'dispatch', 'result', 'recut', 'dispatch', 'result']);
    expect(matrix.cells[matrix.rows.indexOf('T27')]?.[4]?.recut).toBeUndefined();
    expect(matrix.cells[matrix.rows.indexOf('T33')]?.[4]?.recut).toBe('struck');
    expect(buildMatrix([])).toEqual({ rows: [], details: [], columns: [], cells: [] });
  });
});
