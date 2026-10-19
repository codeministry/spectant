import type { CardState, Frame, FrameCard, LiveCard, TaskRun } from '../../../../../../../core/src/files';
import {
  blockerTitles,
  heldWait,
  laneSpecWait,
  laneView,
  specWaitOf,
  boardSection,
  buildLanes,
  frameEvents,
  laneOrder,
  matchesQuery,
  needsYouOf,
  parseList,
  recutMarkers,
  resolveFrameIndex,
  runChanges,
  runCounts,
  runOf,
  runStates,
  scrubberStops,
  stateCounts,
} from './board-model';

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

const frame = (index: number, kind: Frame['kind'], cards: readonly FrameCard[], extra: Partial<Frame> = {}): Frame => ({
  index,
  kind,
  round: 1,
  ts: '2026-03-08T10:00:00Z',
  label: kind === 'live' ? 'Live' : `R${String(index)}`,
  worst: 'waiting',
  cards,
  progress: { claims: { closed: 0, total: 1 }, tasks: { landed: 0, total: 1 } },
  ...extra,
});

describe('laneOrder', () => {
  it('keeps constitution order, appends lanes only the cards name, and puts operator last', () => {
    const cards = [card('T1', 'waiting', { lane: 'operator' }), card('T2', 'waiting', { lane: 'docs' }), card('T3', 'waiting', { lane: 'api' }), card('T4', 'waiting')];
    expect(laneOrder(['web', 'api', 'core', 'operator'], cards)).toEqual(['web', 'api', 'docs', 'operator']);
  });

  it('drops constitution lanes without a card in the frame', () => {
    expect(laneOrder(['core', 'web'], [card('T1', 'done')])).toEqual(['web']);
  });
});

describe('boardSection', () => {
  it('maps every card state to one of the four sections', () => {
    expect(boardSection('question')).toBe('needsYou');
    expect(boardSection('concerns')).toBe('needsYou');
    expect(boardSection('fail')).toBe('needsYou');
    expect(boardSection('operatorOpen')).toBe('needsYou');
    expect(boardSection('dispatched')).toBe('inFlight');
    expect(boardSection('running')).toBe('inFlight');
    expect(boardSection('waiting')).toBe('waiting');
    expect(boardSection('done')).toBe('landed');
    expect(boardSection('closed')).toBe('landed');
    expect(boardSection('operatorDone')).toBe('landed');
    expect(boardSection('absent')).toBe('landed');
  });
});

describe('buildLanes', () => {
  it('sorts cards into sections and groups waiting cards by reason in first-seen order, none lost', () => {
    const cards = [
      card('T1', 'closed'),
      card('T2', 'waiting', { reason: 'after T1 still open' }),
      card('T3', 'running', { lock: { source: 'activity', session: 's-1' } }),
      card('T4', 'waiting', { reason: 'width 10 reached' }),
      card('T5', 'waiting', { reason: 'after T1 still open' }),
      card('T6', 'waiting'),
      card('T7', 'question'),
      card('T8', 'operatorOpen', { lane: 'operator' }),
    ];
    const lanes = buildLanes(['web', 'operator'], cards);
    expect(lanes.map((l) => l.name)).toEqual(['web', 'operator']);
    const web = lanes[0];
    expect(web.needsYou.map((c) => c.task)).toEqual(['T7']);
    expect(web.inFlight.map((c) => c.task)).toEqual(['T3']);
    expect(web.waiting.map((g) => [g.reason, g.cards.map((c) => c.task)])).toEqual([
      ['after T1 still open', ['T2', 'T5']],
      ['width 10 reached', ['T4']],
      [null, ['T6']],
    ]);
    expect(web.landed.map((c) => c.task)).toEqual(['T1']);
    expect(web.total).toBe(7);
    expect(web.landedCount).toBe(1);
    const shown = lanes.reduce((sum, lane) => sum + lane.total, 0);
    expect(shown).toBe(cards.length);
  });

  it('counts absent cards in the lane but not as landed', () => {
    const [lane] = buildLanes(['web'], [card('T1', 'absent'), card('T2', 'done')]);
    expect(lane.landed.map((c) => c.task)).toEqual(['T1', 'T2']);
    expect(lane.landedCount).toBe(1);
  });
});

describe('stateCounts', () => {
  it('counts states in catalogue order, leaving out states with no card', () => {
    expect(stateCounts([card('T1', 'done'), card('T2', 'waiting'), card('T3', 'waiting')])).toEqual([
      { state: 'waiting', count: 2 },
      { state: 'done', count: 1 },
    ]);
  });
});

describe('resolveFrameIndex', () => {
  it('reads ?frame as the frame index and falls back to live', () => {
    expect(resolveFrameIndex(null, 6)).toBe(6);
    expect(resolveFrameIndex('2', 6)).toBe(2);
    expect(resolveFrameIndex('0', 6)).toBe(0);
    expect(resolveFrameIndex('9', 6)).toBe(6);
    expect(resolveFrameIndex('-1', 6)).toBe(6);
    expect(resolveFrameIndex('x', 6)).toBe(6);
  });
});

describe('scrubberStops and recutMarkers', () => {
  const frames = [
    frame(0, 'dispatch', [card('T1', 'dispatched')], { label: 'R1 dispatch' }),
    frame(1, 'result', [card('T1', 'fail')], { worst: 'fail', label: 'R1' }),
    frame(2, 'dispatch', [card('T2', 'dispatched')], { label: 'R2 dispatch', round: 2, recut: { struck: ['T1'], added: ['T2'], changed: [] } }),
    frame(3, 'result', [card('T2', 'done')], { worst: 'done', label: 'R2', round: 2 }),
    frame(4, 'live', [card('T2', 'done')]),
  ];

  it('gives one stop per frame: dispatch hollow, result in its worst tone, live ring', () => {
    const stops = scrubberStops(frames, false);
    expect(stops.map((s) => s.kind)).toEqual(['dispatch', 'result', 'dispatch', 'result', 'live']);
    expect(stops[1].tone).toBe('error');
    expect(stops[3].tone).toBe('success');
    expect(stops.map((s) => s.caption ?? null)).toEqual([null, 'R1', null, 'R2', 'Live']);
  });

  it('labels only every second result tick at compact, the live ring always', () => {
    const stops = scrubberStops(frames, true);
    expect(stops.map((s) => s.caption ?? null)).toEqual([null, 'R1', null, null, 'Live']);
  });

  it('puts a labelled re-cut marker before the frame that carries the re-cut', () => {
    expect(recutMarkers(frames, 're-cut')).toEqual([{ before: 2, label: 're-cut' }]);
  });
});

describe('frameEvents', () => {
  it('lists the cards that are new or changed state since the previous frame', () => {
    const before = frame(0, 'dispatch', [card('T1', 'dispatched'), card('T2', 'waiting')]);
    const after = frame(1, 'result', [card('T1', 'done'), card('T2', 'waiting'), card('T3', 'waiting')]);
    expect(frameEvents(before, after).map((c) => c.task)).toEqual(['T1', 'T3']);
    expect(frameEvents(null, before).map((c) => c.task)).toEqual(['T1', 'T2']);
  });
});

describe('needsYouOf', () => {
  it('takes the live model list as it is and applies the same rule to history frames', () => {
    const live = { ...frame(1, 'live', [card('T1', 'question')]), needsYou: [card('T1', 'question')] };
    expect(needsYouOf(live).map((c) => c.task)).toEqual(['T1']);
    const history = frame(0, 'result', [card('T1', 'fail'), card('T2', 'operatorOpen'), card('T3', 'question'), card('T4', 'concerns')]);
    expect(needsYouOf(history).map((c) => c.task)).toEqual(['T3', 'T4', 'T2']);
  });
});

describe('matchesQuery and parseList', () => {
  it('matches id, claim and text case-insensitively; an empty query matches all', () => {
    const c = card('T14', 'waiting', { text: 'Tag table renders' });
    expect(matchesQuery(c, '')).toBe(true);
    expect(matchesQuery(c, 't14')).toBe(true);
    expect(matchesQuery(c, 'isc-14')).toBe(true);
    expect(matchesQuery(c, 'TABLE')).toBe(true);
    expect(matchesQuery(c, 'nope')).toBe(false);
  });

  it('splits a comma list param, dropping empties', () => {
    expect(parseList(null)).toEqual([]);
    expect(parseList('web,,api')).toEqual(['web', 'api']);
  });
});

describe('run chips (spec 027)', () => {
  const run = (task: string, state: TaskRun['state']): TaskRun => ({ task, state, session: 'a:claude:sess-9', worktree: '.claude/worktrees/agent-a1b2', ts: '2026-03-08T10:00:00Z' });
  const live = (task: string, state: CardState, runState: TaskRun['state'] | null): LiveCard =>
    ({ ...card(task, state), run: runState === null ? null : run(task, runState) }) as LiveCard;

  it('shows a run chip only while tasks.md has not ticked the task, never on a history card', () => {
    expect(runOf(card('T1', 'waiting'))).toBeNull();
    expect(runOf(live('T1', 'done', 'applied'))).toBeNull();
    expect(runOf(live('T2', 'waiting', null))).toBeNull();
    expect(runOf(live('T3', 'waiting', 'applied-open'))?.state).toBe('applied-open');
  });

  it('groups the round furthest along first, out of the card-state sections, with its counts in run order; Flow does not', () => {
    const cards = [
      live('T1', 'waiting', 'dispatched'),
      live('T2', 'running', 'building'),
      live('T3', 'waiting', 'applied-open'),
      live('T4', 'done', 'applied'),
      live('T5', 'waiting', null),
      live('T6', 'waiting', 'patched'),
    ];
    const [lane] = buildLanes(['web'], cards, true);
    expect(lane.inRound.map((c) => c.task)).toEqual(['T3', 'T6', 'T2', 'T1']);
    expect(lane.runCounts).toEqual([
      { state: 'dispatched', count: 1 },
      { state: 'building', count: 1 },
      { state: 'patched', count: 1 },
      { state: 'applied-open', count: 1 },
    ]);
    expect(lane.inFlight).toEqual([]);
    expect(lane.landed.map((c) => c.task)).toEqual(['T4']);
    expect(lane.waiting.flatMap((g) => g.cards.map((c) => c.task))).toEqual(['T5']);
    expect(lane.total).toBe(6);

    const [flow] = buildLanes(['web'], cards);
    expect(flow.inRound).toEqual([]);
    expect(flow.inFlight.map((c) => c.task)).toEqual(['T2']);
  });

  it("counts core's round in run order and leaves out the zeros", () => {
    expect(runCounts({ 'applied-open': 1, dispatched: 2, building: 0 })).toEqual([
      { state: 'dispatched', count: 2 },
      { state: 'applied-open', count: 1 },
    ]);
    expect(runCounts(undefined)).toEqual([]);
  });

  it('names the runs a refresh moved, and nothing on the first read', () => {
    const before = runStates([live('T1', 'waiting', 'dispatched'), live('T2', 'waiting', 'patched')]);
    const after = runStates([live('T1', 'running', 'building'), live('T2', 'waiting', 'patched'), live('T3', 'waiting', 'dispatched'), live('T4', 'done', 'applied')]);
    expect(runChanges(null, after)).toEqual([]);
    expect(runChanges(before, after)).toEqual([
      { task: 'T1', state: 'building' },
      { task: 'T3', state: 'dispatched' },
    ]);
  });
});

describe('spec waits on the live board (spec 025, T25, ISC-163)', () => {
  const held = (task: string, reason: string, lane = 'web') => card(task, 'waiting', { lane, reason });

  it('reads the blockers from core\'s "waits on NNN" reason and nothing else', () => {
    expect(specWaitOf('waits on 006')).toEqual(['006']);
    expect(specWaitOf('waits on 002, 042')).toEqual(['002', '042']);
    expect(specWaitOf('after T26')).toBeNull();
    expect(specWaitOf(null)).toBeNull();
  });

  it('groups held cards in one wgroup per reason; a lane whose open work all waits on a spec carries the chip', () => {
    const lane = laneView('web', [held('T27', 'waits on 006'), held('T28', 'waits on 006'), card('T1', 'done', { lane: 'web' })]);
    expect(lane.waiting.map((g) => [g.reason, g.cards.length])).toEqual([['waits on 006', 2]]);
    expect(laneSpecWait(lane)).toEqual(['006']);
  });

  it('gives a partly waiting lane no lane-head chip', () => {
    expect(laneSpecWait(laneView('web', [held('T27', 'waits on 006'), card('T30', 'waiting', { lane: 'web', reason: 'after T27' })]))).toBeNull();
    expect(laneSpecWait(laneView('web', [held('T27', 'waits on 006'), card('T31', 'running', { lane: 'web' })]))).toBeNull();
    expect(laneSpecWait(laneView('web', [card('T1', 'done', { lane: 'web' })]))).toBeNull();
  });

  it('links a known blocker by its title and leaves an unknown one unlinked; a met edge leaves nothing', () => {
    const known = [{ id: '006', title: 'Registry webhooks' }];
    expect(heldWait('002', ['006', '042'], known)).toEqual({ spec: '002', blockers: ['006', '042'], unknownBlockers: ['042'], heldTasks: 0, readyTasks: 0, openTasks: 0, full: true });
    expect(blockerTitles(['006', '042'], known)).toEqual({ '006': 'Registry webhooks' });
    expect(laneSpecWait(laneView('web', [card('T27', 'waiting', { lane: 'web', reason: '' })]))).toBeNull();
  });
});
