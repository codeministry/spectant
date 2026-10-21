import type { CardState, Frame, FrameCard, LiveCard, LiveFrame, RunCounts, RunState, SpecWait, TaskRun } from '../../../../../../../core/src/files';
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

/** The lane dots in constitution order: the cyan, violet, yellow, green, orange. */
export const LANE_COLORS = ['var(--color-primary)', 'var(--color-secondary)', 'var(--conc)', 'var(--color-success)', 'var(--color-warning)'] as const;

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

/**
 * The run states (spec 027, ISC-179.1) in run order: the toolbar's counters and a lane's round line read them so.
 * `applied` is a ticked task's run, which never shows a chip (its landed card state wins).
 */
export const RUN_ORDER: readonly RunState[] = ['dispatched', 'building', 'patched', 'applied', 'applied-open'];
/** The group "In round n" sorts furthest along first, as core's `LiveRound.cards`. */
const ROUND_RANK: readonly RunState[] = ['applied-open', 'patched', 'building', 'dispatched'];

/**
 * The run a card shows a chip for: its task's last run event while tasks.md has not ticked it, so exactly the cards
 * of the live frame's `inRound`; null for a ticked task (`applied`), a card without a run and every history frame.
 */
export function runOf(card: FrameCard | LiveCard): TaskRun | null {
  const run = 'run' in card ? card.run : undefined;
  return run !== undefined && run !== null && run.state !== 'applied' ? run : null;
}

export interface RunCount {
  readonly state: RunState;
  readonly count: number;
}

/** Core's counts in run order, the zeros left out (the toolbar's counters, a lane's round line). */
export function runCounts(counts: RunCounts | undefined): RunCount[] {
  return RUN_ORDER.map((state) => ({ state, count: counts?.[state] ?? 0 })).filter((c) => c.count > 0);
}

/** Every card's chip-worthy run state by task; the input of `runChanges`. */
export function runStates(cards: ReadonlyArray<FrameCard | LiveCard>): Map<string, RunState> {
  const states = new Map<string, RunState>();
  for (const card of cards) {
    const run = runOf(card);
    if (run !== null) states.set(card.task, run.state);
  }
  return states;
}

/**
 * What one refresh moved, for the single polite announcement of that tick: each task whose run chip is new or shows
 * another state than before, in the order of `after`. Nothing before the first read (`before` null).
 */
export function runChanges(
  before: ReadonlyMap<string, RunState> | null,
  after: ReadonlyMap<string, RunState>,
): Array<{ readonly task: string; readonly state: RunState }> {
  if (before === null) return [];
  return [...after].filter(([task, state]) => before.get(task) !== state).map(([task, state]) => ({ task, state }));
}

export interface LaneView<C extends FrameCard = FrameCard> {
  readonly name: string;
  /** The lane's cards of the round in flight (spec 027), furthest along first; empty unless the lanes are built with it. */
  readonly inRound: readonly C[];
  /** Their run counts in run order, the zeros left out. */
  readonly runCounts: readonly RunCount[];
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

/**
 * One lane: its cards by section, the waiting ones grouped by reason in first-seen order; board order within each.
 * With `round`, a card with a run chip (`runOf`) sits in the group "In round n" instead of its card state's section.
 */
export function laneView<C extends FrameCard>(name: string, cards: readonly C[], round = false): LaneView<C> {
  const inRound: C[] = [];
  const needsYou: C[] = [];
  const inFlight: C[] = [];
  const landed: C[] = [];
  const groups = new Map<string | null, C[]>();
  for (const c of cards) {
    const section = boardSection(c.state);
    if (round && runOf(c) !== null) inRound.push(c);
    else if (section === 'needsYou') needsYou.push(c);
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
  const rank = (c: C): number => ROUND_RANK.indexOf(runOf(c)?.state ?? 'dispatched');
  inRound.sort((a, b) => rank(a) - rank(b));
  const counts: Partial<Record<RunState, number>> = {};
  for (const c of inRound) {
    const state = runOf(c)?.state;
    if (state !== undefined) counts[state] = (counts[state] ?? 0) + 1;
  }
  return {
    name,
    inRound,
    runCounts: runCounts(counts),
    needsYou,
    inFlight,
    waiting,
    landed,
    total: cards.length,
    landedCount: cards.filter((c) => isLanded(c.state)).length,
  };
}

/**
 * The lanes in `order`, each with the cards whose lane it is; a card in no listed lane is not dropped (it gets its own).
 * `round`: the Lanes view's group "In round n" (spec 027); Flow keeps every card in its card state's column.
 */
export function buildLanes<C extends FrameCard>(order: readonly string[], cards: readonly C[], round = false): Array<LaneView<C>> {
  const names = [...order];
  for (const c of cards) if (!names.includes(c.lane)) names.splice(names.includes(OPERATOR_LANE) ? names.length - 1 : names.length, 0, c.lane);
  return names.map((name) => laneView(name, cards.filter((c) => c.lane === name), round)).filter((lane) => lane.total > 0);
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

/**
 * Spec 025 (T25, ISC-163): the specs a hold reason waits on. Core writes a spec-edge hold as `waits on 002` or
 * `waits on 002, 042` (`waitsOnReason`, takeable.ts) on the held card and on the task row; any other reason is null.
 */
const SPEC_WAIT_REASON = /^waits on (\d{3}(?:, \d{3})*)$/;
export function specWaitOf(reason: string | null | undefined): readonly string[] | null {
  const match = SPEC_WAIT_REASON.exec(reason ?? '');
  return match === null ? null : match[1].split(', ');
}

/**
 * The specs a whole lane waits on (spec 025, T25): every open card of the lane is held by a spec edge, so nothing
 * needs the principal, nothing is in flight or in the round, and every waiting group is a `waits on NNN` group. The
 * blockers of all its groups, ascending; null when an open card waits on something else, or nothing waits.
 */
export function laneSpecWait(lane: LaneView): readonly string[] | null {
  if (lane.needsYou.length > 0 || lane.inFlight.length > 0 || lane.inRound.length > 0 || lane.waiting.length === 0) return null;
  const blockers = new Set<string>();
  for (const group of lane.waiting) {
    const specs = specWaitOf(group.reason);
    if (specs === null) return null;
    for (const id of specs) blockers.add(id);
  }
  return [...blockers].sort();
}

/** A spec row as the shell knows it, active or archived: enough to name and link a blocker. */
export interface KnownSpec {
  readonly id: string;
  readonly title: string;
}

/**
 * The `SpecWait` a held claim or a waiting lane shows through `ui-waits-chip` (spec 025, T25/T26): its blockers, those
 * no known spec carries as `unknownBlockers` (drawn unlinked), and `full` so the chip names no partial scope.
 */
export function heldWait(spec: string, blockers: readonly string[], known: readonly KnownSpec[]): SpecWait {
  const ids = new Set(known.map((row) => row.id));
  const unknown = blockers.filter((id) => !ids.has(id));
  return { spec, blockers, ...(unknown.length > 0 ? { unknownBlockers: unknown } : {}), heldTasks: 0, readyTasks: 0, openTasks: 0, full: true };
}

/** The blocker titles by number, for the chip's accessible name and the group's spec line; unknown numbers left out. */
export function blockerTitles(blockers: readonly string[], known: readonly KnownSpec[]): Readonly<Record<string, string>> {
  return Object.fromEntries(blockers.flatMap((id) => known.filter((row) => row.id === id).slice(0, 1).map((row) => [id, row.title] as const)));
}
