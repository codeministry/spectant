// Frames from rounds.jsonl (T17, ISC-87): per round a dispatch frame and a result frame, the worst state per frame,
// task states carried forward.
//
// One rounds.jsonl line is the whole board after that round. From it:
//
//   dispatch frame  the board as the round started: the tasks the line lists, in its order; a task in `dispatched` is
//                   `dispatched`; any other task carries its card from the previous result frame when its id names the
//                   same task (same text) on both lines, else it shows the state its own line records.
//   result frame    the line's recorded end states.
//
// Identity is the id together with its text. A re-cut of tasks.md between two lines (an id struck, added, or kept
// with a different text) sets `recut` on the dispatch frame that follows it, and breaks the chain for every changed
// id: no state, try count or note of the old task is attributed to the renumbered id (ISC-91). T18 (`recut.ts`)
// turns the flag into scrubber markers and struck-as-absent; T19 (`matrix.ts`) the matrix cells; T21 (`live.ts`)
// appends the live frame. This module builds neither `running` (locks, T21) nor `absent` (re-cut, T18) cards.
//
// Pure over the text the caller read: no `node:*`, no clock, no file system. Lines are read by timeline.ts's
// `roundLines` (one reader for rounds.jsonl); a line whose `ts` does not parse is skipped, and lines are ordered by
// their instant, file order among equals.
import type { CardState, Frame, FrameCard, FrameRecut, SpecFiles } from './files.ts';
import { roundLines } from './timeline.ts';
import type { RoundLine } from './timeline.ts';

/**
 * Severity of the card states, worst first. A frame's `worst` is the first state of this list that one of its cards
 * holds. Problems (fail, question, concerns) before work not started (waiting, then the principal's open operator
 * steps) before work in flight (dispatched, running) before landed work (done, operator done, closed); a struck task
 * (absent) counts least. The fixtures' `held` and `skipped` are `waiting` here.
 */
export const CARD_SEVERITY: readonly CardState[] = [
  'fail',
  'question',
  'concerns',
  'waiting',
  'operatorOpen',
  'dispatched',
  'running',
  'done',
  'operatorDone',
  'closed',
  'absent',
];

const RANK: ReadonlyMap<CardState, number> = new Map(CARD_SEVERITY.map((state, i) => [state, i]));

/** The worst of `states` by `CARD_SEVERITY`; `closed` for none (a frame without cards has nothing outstanding). */
export function worstState(states: Iterable<CardState>): CardState {
  let worst: CardState = 'closed';
  for (const state of states) if ((RANK.get(state) ?? 0) < (RANK.get(worst) ?? 0)) worst = state;
  return worst;
}

/** The card states that count as landed work in a frame's task progress. */
const LANDED: ReadonlySet<CardState> = new Set<CardState>(['done', 'operatorDone', 'closed']);

/** The rounds.jsonl task words and the card state each reads as, outside the operator lane. */
const STATE_WORDS: Readonly<Record<string, CardState>> = {
  held: 'waiting',
  skipped: 'waiting',
  waiting: 'waiting',
  dispatched: 'dispatched',
  question: 'question',
  concerns: 'concerns',
  fail: 'fail',
  done: 'done',
  closed: 'closed',
};

/** One task object of a line, with the fields a card reads. */
interface LineTask {
  readonly id: string;
  readonly claim: string;
  readonly lane: string;
  readonly text: string;
  readonly parallel: boolean;
  readonly seam: boolean;
  readonly state: string;
  readonly reason?: string;
  readonly note?: string;
  readonly builder?: string;
  readonly reader?: string;
  readonly verdict?: string;
}

/** A card's state and the payload that travels with it; identity fields come from the line. */
interface CardBody {
  readonly state: CardState;
  readonly tries: number;
  readonly builder?: string;
  readonly reader?: string;
  readonly verdict?: string;
  readonly reason?: string;
  readonly note?: string;
}

/** The board of the previous line: text and result card per id. */
interface Board {
  readonly order: readonly string[];
  readonly text: ReadonlyMap<string, string>;
  readonly cards: ReadonlyMap<string, FrameCard>;
}

export function buildFrames(files: SpecFiles): Frame[] {
  const lines = roundLines(files.texts.rounds)
    .map((line, seq) => ({ line, seq, at: Date.parse(line.ts) }))
    .filter((entry) => Number.isFinite(entry.at))
    .sort((a, b) => a.at - b.at || a.seq - b.seq)
    .map((entry) => entry.line);

  const frames: Frame[] = [];
  let previous: Board | null = null;
  for (const line of lines) {
    const tasks = tasksOf(line);
    const dispatched = new Set(strings(line.dispatched));
    const recut = previous === null ? null : recutBetween(previous, tasks);

    /** The previous result card of the same task: same id and same text, else none. */
    const carried = (task: LineTask): FrameCard | undefined =>
      previous?.text.get(task.id) === task.text ? previous.cards.get(task.id) : undefined;

    const resultCards = tasks.map((task) => {
      const before = carried(task)?.tries ?? 0;
      return cardOf(task, { ...recorded(task), tries: before + (dispatched.has(task.id) ? 1 : 0) });
    });
    const dispatchCards = tasks.map((task, i) => {
      const before = carried(task);
      if (dispatched.has(task.id)) {
        const tries = (before?.tries ?? 0) + 1;
        return cardOf(task, {
          state: 'dispatched',
          tries,
          ...(task.builder === undefined ? {} : { builder: task.builder }),
          ...(task.reason === undefined ? {} : { reason: task.reason }),
          // A retry's note names what to change: that is the dispatch. A first dispatch's note is its result.
          ...(tries > 1 && task.note !== undefined ? { note: task.note } : {}),
        });
      }
      return before === undefined ? (resultCards[i] as FrameCard) : cardOf(task, before);
    });

    const claims = claimCounts(line);
    const stop = typeof line.stop === 'string' && line.stop !== '' ? line.stop : undefined;
    const shared = { round: line.round, ts: line.ts, ...(stop === undefined ? {} : { stop }) };

    frames.push(
      frameOf(frames.length, 'dispatch', shared, dispatchCards, {
        closed: Math.max(0, claims.closed - claims.closedThisRound.length),
        total: claims.total,
      }, [], recut),
      frameOf(frames.length + 1, 'result', shared, resultCards, { closed: claims.closed, total: claims.total }, claims.closedThisRound, null),
    );
    previous = {
      order: tasks.map((task) => task.id),
      text: new Map(tasks.map((task) => [task.id, task.text])),
      cards: new Map(resultCards.map((card) => [card.task, card])),
    };
  }
  return frames;
}

function frameOf(
  index: number,
  kind: 'dispatch' | 'result',
  shared: { readonly round: number; readonly ts: string; readonly stop?: string },
  cards: FrameCard[],
  claims: { readonly closed: number; readonly total: number },
  closedClaims: readonly string[],
  recut: FrameRecut | null,
): Frame {
  return {
    index,
    kind,
    round: shared.round,
    ts: shared.ts,
    label: kind === 'dispatch' ? `R${shared.round} dispatch` : `R${shared.round}`,
    worst: worstState(cards.map((card) => card.state)),
    cards,
    progress: {
      claims,
      tasks: { landed: cards.filter((card) => LANDED.has(card.state)).length, total: cards.length },
    },
    closedClaims,
    ...(shared.stop === undefined ? {} : { stop: shared.stop }),
    ...(recut === null ? {} : { recut }),
  };
}

/** A card from the line's identity fields and a state body, in one fixed field order (golden snapshots). */
function cardOf(task: LineTask, body: CardBody): FrameCard {
  return {
    task: task.id,
    claim: task.claim,
    lane: task.lane,
    text: task.text,
    parallel: task.parallel,
    seam: task.seam,
    state: body.state,
    ...(body.builder === undefined ? {} : { builder: body.builder }),
    ...(body.reader === undefined ? {} : { reader: body.reader }),
    ...(body.verdict === undefined ? {} : { verdict: body.verdict }),
    tries: body.tries,
    ...(body.reason === undefined ? {} : { reason: body.reason }),
    ...(body.note === undefined ? {} : { note: body.note }),
  };
}

/** The state and payload a line records for a task (tries filled in by the caller). */
function recorded(task: LineTask): Omit<CardBody, 'tries'> {
  const known = STATE_WORDS[task.state];
  let state: CardState = known ?? 'waiting';
  if (task.lane === 'operator' && state === 'waiting') state = 'operatorOpen';
  if (task.lane === 'operator' && (state === 'done' || state === 'closed')) state = 'operatorDone';
  const reason = known === undefined ? [`state "${task.state}"`, ...(task.reason === undefined ? [] : [task.reason])].join(' · ') : task.reason;
  return {
    state,
    ...(task.builder === undefined ? {} : { builder: task.builder }),
    ...(task.reader === undefined ? {} : { reader: task.reader }),
    ...(task.verdict === undefined ? {} : { verdict: task.verdict }),
    ...(reason === undefined ? {} : { reason }),
    ...(task.note === undefined ? {} : { note: task.note }),
  };
}

/** Struck, added and changed ids between the previous board and this line's tasks; null when tasks.md is unchanged. */
function recutBetween(previous: Board, tasks: readonly LineTask[]): FrameRecut | null {
  const current = new Set(tasks.map((task) => task.id));
  const struck = previous.order.filter((id) => !current.has(id));
  const added = tasks.filter((task) => !previous.text.has(task.id)).map((task) => task.id);
  const changed = tasks.filter((task) => previous.text.has(task.id) && previous.text.get(task.id) !== task.text).map((task) => task.id);
  return struck.length + added.length + changed.length === 0 ? null : { struck, added, changed };
}

/** Claims closed and total from `progress` ("M/N"), else from the claim lists; plus `closed_this_round`. */
function claimCounts(line: RoundLine): { closed: number; total: number; closedThisRound: string[] } {
  const lists = isRecord(line.claims) ? line.claims : {};
  const closedThisRound = strings(lists.closed_this_round);
  const progress = typeof line.progress === 'string' ? /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(line.progress) : null;
  if (progress) return { closed: Number(progress[1]), total: Number(progress[2]), closedThisRound };
  const closed = strings(lists.closed).length;
  return { closed, total: closed + strings(lists.open).length, closedThisRound };
}

/** The task objects of a line that carry a string id; other fields default to empty. */
function tasksOf(line: RoundLine): LineTask[] {
  if (!Array.isArray(line.tasks)) return [];
  return (line.tasks as unknown[]).filter(isRecord).flatMap((task): LineTask[] => {
    if (typeof task.id !== 'string' || task.id === '') return [];
    return [
      {
        id: task.id,
        claim: text(task.claim) ?? '',
        lane: text(task.lane) ?? '',
        text: text(task.text) ?? '',
        parallel: task.parallel === true,
        seam: task.seam === true,
        state: text(task.state) ?? '',
        ...optional('reason', task.reason),
        ...optional('note', task.note),
        ...optional('builder', task.builder),
        ...optional('reader', task.reader),
        ...optional('verdict', task.verdict),
      },
    ];
  });
}

/** `{ [key]: value }` for a non-empty string value, else nothing. */
function optional<K extends string>(key: K, value: unknown): Partial<Record<K, string>> {
  const v = text(value);
  return v === undefined ? {} : ({ [key]: v } as Record<K, string>);
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
