import type { CardState, Frame, FrameCard, LiveFrame } from '../../../../../../../core/src/files';
import { CARD_STATES, glyphSpec } from '../../../../shared/ui/glyph/states';
import type { ScrubberFrame } from '../../../../shared/ui/scrubber/scrubber';

/**
 * The board's pure view helpers (T81, ISC-87 to ISC-93). The frames are core's (`Frame[]` from `…/frames`, the
 * `LiveFrame` from `…/live`) and are never re-derived here: these helpers only order, group, filter and label the
 * cards the model already carries. Lanes (T81) and Flow (T82) read the same sections, so a card sits in the same
 * place in both views.
 */

/** The four places a card can sit: the rows of a lane (Lanes view) and the columns of Flow. */
export type BoardSection = 'needsYou' | 'inFlight' | 'waiting' | 'landed';

export const SECTION_ORDER: readonly BoardSection[] = ['needsYou', 'inFlight', 'waiting', 'landed'];

export const OPERATOR_LANE = 'operator';

/**
 * Where each of the eleven card states sits. `absent` (a struck task still on the last board) is settled, not waiting
 * on anything, so it sits with the landed cards; it is not counted as landed.
 */
const SECTION_OF: Readonly<Record<CardState, BoardSection>> = {
  question: 'needsYou',
  concerns: 'needsYou',
  fail: 'needsYou',
  operatorOpen: 'needsYou',
  dispatched: 'inFlight',
  running: 'inFlight',
  waiting: 'waiting',
  done: 'landed',
  closed: 'landed',
  operatorDone: 'landed',
  absent: 'landed',
};

const LANDED: ReadonlySet<CardState> = new Set<CardState>(['done', 'closed', 'operatorDone']);

/** The Needs you list rule of core's live.ts, applied to history frames: question, concerns, open operator steps. */
const NEEDS_YOU: readonly CardState[] = ['question', 'concerns', 'operatorOpen'];

export const boardSection = (state: CardState): BoardSection => SECTION_OF[state];
export const isLanded = (state: CardState): boolean => LANDED.has(state);

export interface WaitingGroup<C extends FrameCard = FrameCard> {
  /** The card's `reason` as the model wrote it; null when it gave none. */
  readonly reason: string | null;
  readonly cards: readonly C[];
}

export interface LaneView<C extends FrameCard = FrameCard> {
  readonly name: string;
  readonly needsYou: readonly C[];
  readonly inFlight: readonly C[];
  readonly waiting: ReadonlyArray<WaitingGroup<C>>;
  readonly landed: readonly C[];
  /** Cards in the lane (every section). */
  readonly total: number;
  /** Cards done, closed or a done operator step. */
  readonly landedCount: number;
}

/**
 * Lane order (design.md § Live): the constitution's lanes in table order, then lanes only the cards name (first seen),
 * `operator` last. Only lanes with a card in the frame are kept, so no empty lane is drawn.
 */
export function laneOrder(constitution: readonly string[], cards: ReadonlyArray<Pick<FrameCard, 'lane'>>): string[] {
  const present = new Set(cards.map((c) => c.lane));
  const order = constitution.filter((lane) => lane !== OPERATOR_LANE && present.has(lane));
  for (const c of cards) if (c.lane !== OPERATOR_LANE && !order.includes(c.lane)) order.push(c.lane);
  if (present.has(OPERATOR_LANE)) order.push(OPERATOR_LANE);
  return order;
}

/** One lane: its cards by section, the waiting ones grouped by reason in first-seen order; board order within each. */
export function laneView<C extends FrameCard>(name: string, cards: readonly C[]): LaneView<C> {
  const needsYou: C[] = [];
  const inFlight: C[] = [];
  const landed: C[] = [];
  const groups = new Map<string | null, C[]>();
  for (const c of cards) {
    const section = boardSection(c.state);
    if (section === 'needsYou') needsYou.push(c);
    else if (section === 'inFlight') inFlight.push(c);
    else if (section === 'landed') landed.push(c);
    else {
      const reason = c.reason === undefined || c.reason === '' ? null : c.reason;
      const group = groups.get(reason) ?? [];
      group.push(c);
      groups.set(reason, group);
    }
  }
  const waiting = [...groups].map(([reason, grouped]) => ({ reason, cards: grouped }));
  // A card without a reason goes last, after every named reason.
  waiting.sort((a, b) => Number(a.reason === null) - Number(b.reason === null));
  return { name, needsYou, inFlight, waiting, landed, total: cards.length, landedCount: cards.filter((c) => isLanded(c.state)).length };
}

/** The lanes in `order`, each with the cards whose lane it is; a card in no listed lane is not dropped (it gets its own). */
export function buildLanes<C extends FrameCard>(order: readonly string[], cards: readonly C[]): Array<LaneView<C>> {
  const names = [...order];
  for (const c of cards) if (!names.includes(c.lane)) names.splice(names.includes(OPERATOR_LANE) ? names.length - 1 : names.length, 0, c.lane);
  return names.map((name) => laneView(name, cards.filter((c) => c.lane === name))).filter((lane) => lane.total > 0);
}

export interface StateCount {
  readonly state: CardState;
  readonly count: number;
}

/** How many cards carry each state, in the catalogue's order; states without a card are left out. */
export function stateCounts(cards: ReadonlyArray<Pick<FrameCard, 'state'>>): StateCount[] {
  return CARD_STATES.map((state) => ({ state, count: cards.filter((c) => c.state === state).length })).filter((s) => s.count > 0);
}

/** `?frame=<index>` → the frame shown; absent, malformed or past the end is the live frame (the last index). */
export function resolveFrameIndex(param: string | null, liveIndex: number): number {
  if (param === null || !/^\d+$/.test(param)) return liveIndex;
  const index = Number(param);
  return index > liveIndex ? liveIndex : index;
}

/**
 * The scrubber's stops, one per frame: dispatch hollow, result filled in its worst state's tone, live the lime ring.
 * Result ticks and the live ring carry a visible caption; at compact only every second result tick does.
 */
export function scrubberStops(frames: readonly Frame[], compact: boolean): ScrubberFrame[] {
  let results = 0;
  return frames.map((frame) => {
    if (frame.kind === 'dispatch') return { kind: 'dispatch', label: frame.label, tone: 'neutral' };
    if (frame.kind === 'live') return { kind: 'live', label: frame.label, caption: frame.label };
    const labelled = !compact || results % 2 === 0;
    results += 1;
    return { kind: 'result', label: frame.label, tone: glyphSpec(frame.worst, 'card').tone, ...(labelled ? { caption: frame.label } : {}) };
  });
}

/** The re-cut markers (ISC-91) are `live/recut.ts`'s, the one web-side mapping of a frame's `recut`. */
export { recutMarkers } from '../recut';

/** "This frame": the cards new in this frame or in another state than in the previous one, board order. */
export function frameEvents<C extends FrameCard>(previous: Frame | null, current: { readonly cards: readonly C[] }): C[] {
  if (previous === null) return [...current.cards];
  const before = new Map(previous.cards.map((c) => [c.task, c.state]));
  return current.cards.filter((c) => before.get(c.task) !== c.state);
}

/** "Needs you": the live frame's own list as the model gives it; a history frame by the same rule. */
export function needsYouOf(frame: Frame | LiveFrame): readonly FrameCard[] {
  if ('needsYou' in frame) return frame.needsYou;
  return NEEDS_YOU.flatMap((state) => frame.cards.filter((c) => c.state === state));
}

/** Search over the id, the claim and the text, case-insensitive; an empty query matches every card. */
export function matchesQuery(card: Pick<FrameCard, 'task' | 'claim' | 'text'>, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return [card.task, card.claim, card.text].some((field) => field.toLowerCase().includes(q));
}

/** A comma list query param (`?hide=done,closed`) → its entries, empties dropped. */
export function parseList(param: string | null): string[] {
  return param === null ? [] : param.split(',').filter((entry) => entry !== '');
}
