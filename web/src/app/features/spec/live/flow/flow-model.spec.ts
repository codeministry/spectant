import type { CardState, FrameCard } from '../../../../../../../core/src/files';
import { buildLanes } from '../board/board-model';
import { type CardPlace, FLOW_COLUMNS, flipMoves, flowBands, flowCounts, resolveColumn } from './flow-model';

const card = (task: string, state: CardState, extra: Partial<FrameCard> = {}): FrameCard => ({
  task,
  claim: `ISC-${task.slice(1)}`,
  lane: 'web',
  text: `text of ${task}`,
  parallel: false,
  seam: false,
  state,
  tries: 1,
  ...extra,
});

describe('FLOW_COLUMNS', () => {
  it('reads Waiting · In flight · Needs you · Landed, the design order', () => {
    expect(FLOW_COLUMNS).toEqual(['waiting', 'inFlight', 'needsYou', 'landed']);
  });
});

describe('flowBands', () => {
  it('keeps the lane order and puts every card of a lane in its section column exactly once', () => {
    const cards = [
      card('T1', 'done', { lane: 'api' }),
      card('T2', 'waiting', { lane: 'web', reason: 'after T1' }),
      card('T3', 'running', { lane: 'web' }),
      card('T4', 'question', { lane: 'web' }),
      card('T5', 'waiting', { lane: 'web' }),
      card('T6', 'waiting', { lane: 'web', reason: 'after T1' }),
      card('T7', 'absent', { lane: 'api' }),
    ];
    const bands = flowBands(buildLanes(['web', 'api'], cards));
    expect(bands.map((b) => b.name)).toEqual(['web', 'api']);
    const web = bands[0];
    // Waiting keeps the reason groups' order (named reasons first), flattened into one column.
    expect(web.columns.waiting.map((c) => c.task)).toEqual(['T2', 'T6', 'T5']);
    expect(web.columns.inFlight.map((c) => c.task)).toEqual(['T3']);
    expect(web.columns.needsYou.map((c) => c.task)).toEqual(['T4']);
    expect(web.columns.landed).toEqual([]);
    expect(bands[1].columns.landed.map((c) => c.task)).toEqual(['T1', 'T7']);
    // n/m: landed counts done/closed/operatorDone, not absent.
    expect([web.landedCount, web.total]).toEqual([0, 5]);
    expect([bands[1].landedCount, bands[1].total]).toEqual([1, 2]);
    const all = bands.flatMap((b) => FLOW_COLUMNS.flatMap((col) => b.columns[col])).map((c) => c.task);
    expect(all.sort()).toEqual(cards.map((c) => c.task).sort());
  });
});

describe('flowCounts and resolveColumn', () => {
  const bands = flowBands(buildLanes(['web'], [card('T1', 'done'), card('T2', 'running'), card('T3', 'dispatched')]));

  it('counts the cards of each column over every band', () => {
    expect(flowCounts(bands)).toEqual({ waiting: 0, inFlight: 2, needsYou: 0, landed: 1 });
  });

  it('takes a valid ?flow column as it is, else the first column that holds cards, else Waiting', () => {
    const counts = flowCounts(bands);
    expect(resolveColumn('landed', counts)).toBe('landed');
    expect(resolveColumn('waiting', counts)).toBe('waiting');
    expect(resolveColumn(null, counts)).toBe('inFlight');
    expect(resolveColumn('bogus', counts)).toBe('inFlight');
    expect(resolveColumn(null, { waiting: 0, inFlight: 0, needsYou: 0, landed: 0 })).toBe('waiting');
  });
});

describe('flipMoves', () => {
  const place = (x: number, y: number, column: string): CardPlace => ({ x, y, column });

  it('returns the inverse offset of every card that moved, flagging a column change', () => {
    const before = new Map([
      ['T1', place(0, 0, 'waiting')],
      ['T2', place(0, 80, 'waiting')],
      ['T3', place(240, 0, 'inFlight')],
    ]);
    const after = new Map([
      ['T1', place(480, 0, 'needsYou')],
      ['T2', place(0, 0, 'waiting')],
      ['T3', place(240, 0, 'inFlight')],
      ['T4', place(720, 0, 'landed')],
    ]);
    expect(flipMoves(before, after)).toEqual([
      { task: 'T1', dx: -480, dy: 0, moved: true },
      { task: 'T2', dx: 0, dy: 80, moved: false },
    ]);
  });

  it('moves nothing on a first render', () => {
    expect(flipMoves(new Map(), new Map([['T1', place(0, 0, 'waiting')]]))).toEqual([]);
  });
});
