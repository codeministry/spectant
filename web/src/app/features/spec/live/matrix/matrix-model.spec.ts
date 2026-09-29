import type { CardState, Frame, FrameCard } from '../../../../../../../core/src/files';
import { boardQuery, glyphOf, laneGroups, matrixOf } from './matrix-model';

const card = (task: string, state: CardState, lane = 'web'): FrameCard => ({
  task,
  claim: `ISC-${task.slice(1)}`,
  lane,
  text: `text of ${task}`,
  parallel: false,
  seam: false,
  state,
  tries: 0,
});

const frame = (index: number, kind: Frame['kind'], cards: FrameCard[], extra: Partial<Frame> = {}): Frame => ({
  index,
  kind,
  round: 1,
  ts: '2026-03-01T10:00:00Z',
  label: kind === 'live' ? 'Live' : 'R1',
  worst: 'waiting',
  cards,
  progress: { claims: { closed: 0, total: 1 }, tasks: { landed: 0, total: cards.length } },
  ...extra,
});

describe('matrix model', () => {
  const frames = [
    frame(0, 'dispatch', [card('T1', 'dispatched'), card('T2', 'operatorOpen', 'operator'), card('T3', 'waiting', 'api')]),
    frame(1, 'result', [card('T1', 'done'), card('T2', 'operatorOpen', 'operator')]),
    frame(2, 'live', [card('T1', 'closed'), card('T2', 'operatorDone', 'operator'), card('T4', 'running')], {
      recut: { struck: ['T3'], added: ['T4'], changed: [] },
    }),
  ];
  const matrix = matrixOf(frames, ['api', 'web']);

  it('groups the rows by lane in constitution order, operator last', () => {
    expect(laneGroups(matrix).map((g) => [g.lane, g.rows.map((r) => r.detail.task)])).toEqual([
      ['api', ['T3']],
      ['web', ['T1', 'T4']],
      ['operator', ['T2']],
    ]);
  });

  it('draws the state, the dashed absent after a card, nothing before the first', () => {
    const row = (task: string) => laneGroups(matrix).flatMap((g) => g.rows).find((r) => r.detail.task === task)?.cells ?? [];
    expect(row('T3').map(glyphOf)).toEqual(['waiting', 'absent', null, 'absent']);
    expect(row('T4').map(glyphOf)).toEqual([null, null, null, 'running']);
    expect(row('T4')[2]?.recut).toBe('added');
  });

  it('sets ?frame for a history cell, nothing for live, and no link on a re-cut cell', () => {
    expect(matrix.columns.map(boardQuery)).toEqual([{ frame: '0' }, { frame: '1' }, null, {}]);
  });
});
