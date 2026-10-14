// The live frame (T21, ISC-90): the board as it stands now, from three layers applied in this order.
//
//   1. carry-forward  the last result frame's cards (frames.ts), as the round left them.
//   2. tasks.md       the current task lines decide which cards exist and in which order (tasks.md order):
//                     - a task on the last board with the same id and text keeps its card; a box checked since then
//                       flips a card that had not landed to `done`, or `closed` once spec.md checks its claim
//                       (`operatorDone` in the operator lane), keeping builder, tries and note; while an open spec
//                       edge holds the task or its claim, a carried `waiting`, `dispatched` or `operatorOpen` card
//                       reads `waits on NNN` instead of the round's reason (`dispatched` as `waiting`, ISC-163);
//                       once the edge is met the round's card stands again;
//                     - a task not on the last board (new, or renumbered / reworded: no state is carried, ISC-91)
//                       gets a fresh card: landed when its box is checked, else `waiting` (`operatorOpen` in the
//                       operator lane) with the reason takeable.ts gives it, when spec.md is there to compute one
//                       (without a fresh reviewed mark that reason is `spec not reviewed`, ISC-99);
//                     - a struck task still on the last board is `absent` with its strike note; any other struck task
//                       and any task gone from tasks.md has no card. Without task lines the carried cards stand.
//   3. locks          every card not landed, not absent and outside the operator lane whose claim a session holds is
//                     `running`, with the lock's source and session, `since`, `elapsedMs` (now − since) and `stale`
//                     (no release for longer than `staleAfterMs`, 45 minutes by default). Only locks on this spec's
//                     claims count; a claim held in both sources shows the frontier lock (the reading lists it last).
//                     Who works it (spec 008, T66, ISC-131.1) comes from that lock's actor: `agent` the agent session
//                     (`a:<kind>:<id>`, a sub-agent's parent id), `subagent` the `a:<kind>:<id>/<task>` ref when it
//                     names this card's task. Every other card, and a person's or legacy session's lock, has both null.
//   4. runs           (spec 027, ISC-179.1) every card but an `absent` one whose task a run event of this spec names
//                     carries `run`, the TaskRun `runStates` (locks.ts) folds from the reading's run lines: `apply`
//                     reads `applied` once tasks.md checks the task, else `applied-open`. The log is repository-wide
//                     and keyed by task id, so a run line counts here only for a task of this spec (a tasks.md line,
//                     else a carried card) and, when it names a claim, only when that claim is the task's own. The run
//                     is additive: the card's state stays what layers 1–3 made it. A card without a run has no `run`.
//
// The frame adds the agents rail (one entry per session holding a lock here, oldest lock first), the Needs you list
// (question, concerns, open operator steps) and the round group `inRound`: the cards with a run whose task tasks.md has
// not ticked, furthest along first, with their counts per lane and in total. A ticked card keeps its run (`applied`),
// but its landed state wins and it has left the group. Only this frame carries runs; frames.ts's frames never do.
// Claims progress comes from spec.md's boxes, tasks progress from the cards.
//
// Pure: texts, frames, a lock reading and the clock in, the frame out. No file system, no clock of its own, no Bun or
// node API of its own (the reviewed mark's digest is gates.ts's `node:crypto` hash); the server reads the lock
// sources (locks.ts) and passes `now`.
import { parseActor } from './actor.ts';
import type { Claim } from './claims.ts';
import { countProgress, parseClaims } from './claims.ts';
import type { ActorRef, AgentLockSource, CardState, ClaimLock, FrameCard, LiveAgent, LiveCard, LiveFrame, LiveFrameInput, LiveRound, LockReading, RunCounts, RunState, SpecEdge, TaskRow, TaskRun } from './files.ts';
import { buildFrames, worstState } from './frames.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { reviewedGate } from './gates.ts';
import type { MarkState } from './gates.ts';
import { runStates } from './locks.ts';
import { heldLocks } from './status.ts';
import { specEdgeHold, takeableSet } from './takeable.ts';
import { parseTaskLines } from './tasks.ts';

/** A lock held this long without a release is shown stale: the session may have died (design § Live). */
export const LIVE_STALE_MS = 45 * 60 * 1000;

const OPERATOR = 'operator';
const LANDED: ReadonlySet<CardState> = new Set<CardState>(['done', 'operatorDone', 'closed']);
/** The Needs you list, in this order. */
const NEEDS_YOU: readonly CardState[] = ['question', 'concerns', 'operatorOpen'];

const byClaim = (a: string, b: string): number => a.localeCompare(b, 'en', { numeric: true });

export function buildLiveFrame(input: LiveFrameInput): LiveFrame {
  const { files, locks: reading } = input;
  const now = input.now.getTime();
  const staleAfterMs = input.staleAfterMs ?? LIVE_STALE_MS;
  const frames = input.frames ?? buildFrames(files);
  const last = frames.filter((f) => f.kind === 'result').at(-1) ?? null;
  const base = last?.cards ?? [];

  const spec = files.texts.spec;
  const claims: readonly Claim[] = spec === undefined ? [] : parseClaims(spec).claims;
  const rows = files.texts.tasks === undefined ? [] : parseTaskLines({ tasks: files.texts.tasks, ...(files.texts.constitution === undefined ? {} : { constitution: files.texts.constitution }) }).tasks;

  // Only locks on this spec's claims; one per claim, the reading's last entry (frontier) winning.
  const ours = new Set([...claims.map((c) => c.id), ...rows.map((r) => r.claim), ...base.map((c) => c.claim)]);
  const locks = heldLocks(reading.locks, ours);
  const held = new Map(locks.map((l) => [l.claim, l]));

  const overlaid = rows.length === 0 ? [...base] : overlayTasks(base, rows, claims, locks, spec, reviewedGate(files.texts).check.state, input.specEdges ?? []);
  /** Layer 3: a held lock puts a card in flight. */
  const lockLayer = (card: FrameCard): LiveCard => {
    const lock = held.get(card.claim);
    if (lock === undefined || LANDED.has(card.state) || card.state === 'absent' || card.lane === OPERATOR) return { ...card, agent: null, subagent: null };
    const elapsedMs = elapsed(now, lock.since);
    // In flight: the session is the reason, so a waiting or dispatch reason is dropped.
    return ordered({ ...card, state: 'running', lock: { source: lock.source, session: lock.session }, since: lock.since, elapsedMs, stale: elapsedMs > staleAfterMs, ...workersOf(lock.actor, card.task) }, 'reason');
  };
  // Layer 4: the run, after every other field (CARD_KEYS order).
  const ticked = new Set(rows.filter((r) => r.state === 'done').map((r) => r.id));
  const runs = specRuns(reading, rows, overlaid, ticked);
  const cards: LiveCard[] = overlaid.map((card): LiveCard => {
    const live = lockLayer(card);
    const run = card.state === 'absent' ? undefined : runs.get(card.task);
    return run === undefined ? live : { ...live, run };
  });

  const present = cards.filter((c) => c.state !== 'absent');
  const claimProgress = claims.length > 0 ? countProgress(claims) : (last?.progress.claims ?? { closed: 0, total: 0 });
  return {
    index: frames.length,
    kind: 'live',
    round: last?.round ?? null,
    ts: input.now.toISOString(),
    label: 'Live',
    worst: worstState(cards.map((c) => c.state)),
    cards,
    progress: {
      claims: { closed: claimProgress.closed, total: claimProgress.total },
      tasks: { landed: present.filter((c) => LANDED.has(c.state)).length, total: present.length },
    },
    closedClaims: [],
    lockSource: reading.source,
    locks,
    agents: agentsOf(locks, now, staleAfterMs),
    needsYou: NEEDS_YOU.flatMap((state) => cards.filter((c) => c.state === state)),
    staleAfterMs,
    inRound: roundOf(cards.filter((c) => c.run && !ticked.has(c.task)), last?.round ?? null),
  };
}

/**
 * Layer 4: this spec's runs by task id. A run line counts for a task of this spec (a tasks.md line, else a carried
 * card) and, when it names a claim, only when that claim is the task's own, so another spec's `T26` stays out; a line
 * without a claim is matched by its task id alone. tasks.md's checked boxes decide `applied` over `applied-open`.
 */
function specRuns(reading: LockReading, rows: readonly TaskRow[], cards: readonly FrameCard[], ticked: ReadonlySet<string>): Map<string, TaskRun> {
  const claimOf = new Map<string, string>(rows.length === 0 ? cards.map((c) => [c.task, c.claim]) : rows.map((r) => [r.id, r.claim]));
  const ours = (reading.runs ?? []).filter((r) => claimOf.has(r.task) && (r.claim === undefined || r.claim === claimOf.get(r.task)));
  return new Map(runStates({ ...reading, runs: ours }, ticked).map((run) => [run.task, run]));
}

/** The run states the round counts, in run order; the group lists them reversed, furthest along first. */
const ROUND_STATES: readonly RunState[] = ['dispatched', 'building', 'patched', 'applied-open'];

/** The group "in round n" over `cards` (board order): `round` is the round after the last recorded one. */
function roundOf(cards: readonly LiveCard[], lastRound: number | null): LiveRound {
  const stateOf = (c: LiveCard): RunState | undefined => c.run?.state;
  const counts = (of: readonly LiveCard[]): RunCounts => Object.fromEntries(ROUND_STATES.map((s) => [s, of.filter((c) => stateOf(c) === s).length] as const).filter(([, n]) => n > 0));
  const lanes = [...new Set(cards.map((c) => c.lane))];
  return {
    round: cards.length === 0 ? null : (lastRound ?? 0) + 1,
    cards: [...ROUND_STATES].reverse().flatMap((s) => cards.filter((c) => stateOf(c) === s)),
    lanes: Object.fromEntries(lanes.map((lane) => [lane, counts(cards.filter((c) => c.lane === lane))])),
    total: counts(cards),
  };
}

/**
 * The carried card states an open spec edge rewrites to `waits on NNN` (ISC-163): work the round left not started.
 * A problem (fail, question, concerns) keeps the round's word, a landed card stays landed, and a card in flight is
 * layer 3's (its lock), never this layer's.
 */
const EDGE_HOLDABLE: ReadonlySet<CardState> = new Set<CardState>(['waiting', 'dispatched', 'operatorOpen']);

/** Layer 2: tasks.md's lines over the carried cards. */
function overlayTasks(base: readonly FrameCard[], rows: readonly TaskRow[], claims: readonly Claim[], locks: readonly ClaimLock[], spec: string | undefined, reviewed: MarkState, specEdges: readonly SpecEdge[]): FrameCard[] {
  const carried = new Map(base.map((c) => [c.task, c]));
  const sameText = boardTexts(base);
  const checked = new Set(claims.filter((c) => c.checked).map((c) => c.id));
  const reasons = spec === undefined ? new Map<string, string>() : takeableReasons(spec, claims, rows, locks, reviewed, specEdges);
  const landedState = (row: TaskRow): CardState => (row.lane === OPERATOR ? 'operatorDone' : checked.has(row.claim) ? 'closed' : 'done');
  const edgeHold = specEdgeHold(specEdges);

  return rows.flatMap((row): FrameCard[] => {
    const before = carried.get(row.id);
    if (row.state === 'struck') {
      if (before === undefined) return [];
      return [ordered({ ...identity(row, before.text), state: 'absent', tries: before.tries, ...(row.note === null ? {} : { note: row.note }) })];
    }
    if (before !== undefined && sameText.get(row.id) === row.text) {
      if (row.state !== 'done' || LANDED.has(before.state)) {
        // An open spec edge holds a carried card the round left waiting or dispatched (ISC-163); met, the card is back.
        const waits = EDGE_HOLDABLE.has(before.state) ? edgeHold(row.id, row.claim) : null;
        return [waits === null ? before : ordered({ ...before, state: before.state === 'dispatched' ? 'waiting' : before.state, reason: waits })];
      }
      // Landed: the hold or dispatch reason of the round no longer applies.
      return [ordered({ ...before, state: landedState(row) }, 'reason')];
    }
    if (row.state === 'done') return [ordered({ ...identity(row), state: landedState(row), tries: 0 })];
    const reason = reasons.get(row.id);
    return [ordered({ ...identity(row), state: row.lane === OPERATOR ? 'operatorOpen' : 'waiting', tries: 0, ...(reason === undefined ? {} : { reason }) })];
  });
}

/**
 * The carried cards' texts as the task-line grammar reads them (edges and a path column removed), by id: a round line
 * may carry either spelling, and identity is decided on the one tasks.ts gives the current line.
 */
function boardTexts(cards: readonly FrameCard[]): Map<string, string> {
  const lines = cards.map((c) => `- [ ] ${c.task} · ISC-0 · x — ${c.text.replace(/\s*\n\s*/g, ' ')}`).join('\n');
  return new Map(parseTaskLines({ tasks: lines }).tasks.map((t) => [t.id, t.text]));
}

/**
 * takeable.ts's dispatch or hold reason per open task, as the next round would plan it now; an open spec edge of
 * `specEdges` holds its task, or every task of its claim, with `waits on NNN` (spec 025, ISC-163).
 */
function takeableReasons(spec: string, claims: readonly Claim[], rows: readonly TaskRow[], locks: readonly ClaimLock[], reviewed: MarkState, specEdges: readonly SpecEdge[]): Map<string, string> {
  const plan = takeableSet({
    reviewed,
    specType: parseFrontmatter(spec).data.specType,
    claims,
    tasks: { tasks: rows, probeMapping: [] },
    locks,
    specEdges,
  });
  return new Map([...plan.dispatch, ...plan.held].map((e) => [e.task, e.reason]));
}

/** The identity fields of a card from its task line. */
function identity(row: TaskRow, text = row.text): Pick<FrameCard, 'task' | 'claim' | 'lane' | 'text' | 'parallel' | 'seam'> {
  return { task: row.id, claim: row.claim, lane: row.lane, text: text === '' ? row.text : text, parallel: row.flags.parallel, seam: row.flags.seam };
}

/** A card in frames.ts's field order, then the live fields (stable JSON for the golden snapshots); `drop` left out. */
function ordered<C extends FrameCard>(card: C, drop?: keyof LiveCard): C {
  const fields = card as unknown as Partial<Record<keyof LiveCard, unknown>>;
  const out: Record<string, unknown> = {};
  for (const key of CARD_KEYS) if (key !== drop && fields[key] !== undefined) out[key] = fields[key];
  return out as unknown as C;
}

/**
 * Who works a card under `lock` (T66): the agent session and, when the lock's actor is a sub-agent on this very task,
 * that sub-agent. A sub-agent's parent is its own `id` (`a:<kind>:<id>`, actor.ts), read through the same grammar. A
 * person or a legacy session is no agent, and a sub-agent on another task of the claim leaves `subagent` null here.
 */
function workersOf(actor: ActorRef, task: string): Pick<LiveCard, 'agent' | 'subagent'> {
  if (actor.kind === 'agent') return { agent: actor, subagent: null };
  if (actor.kind === 'subagent') return { agent: parseActor(actor.id), subagent: actor.task === task ? actor : null };
  return { agent: null, subagent: null };
}

const CARD_KEYS: ReadonlyArray<keyof LiveCard> = [
  'task',
  'claim',
  'lane',
  'text',
  'parallel',
  'seam',
  'state',
  'builder',
  'reader',
  'verdict',
  'tries',
  'reason',
  'note',
  'lock',
  'since',
  'elapsedMs',
  'stale',
  'agent',
  'subagent',
  'run',
];

/** `now − since` in milliseconds; 0 for a timestamp that does not parse or lies ahead of the clock. */
function elapsed(now: number, since: string): number {
  const at = Date.parse(since);
  return Number.isFinite(at) ? Math.max(0, now - at) : 0;
}

/** One rail entry per session and source, holding its claims here; oldest lock first, then by session. */
function agentsOf(locks: readonly ClaimLock[], now: number, staleAfterMs: number): LiveAgent[] {
  const groups = new Map<string, { session: string; source: AgentLockSource; claims: string[]; since: string }>();
  for (const lock of locks) {
    const key = `${lock.source}\u0000${lock.session}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, { session: lock.session, source: lock.source, claims: [lock.claim], since: lock.since });
      continue;
    }
    group.claims.push(lock.claim);
    if (Date.parse(lock.since) < Date.parse(group.since)) group.since = lock.since;
  }
  return [...groups.values()]
    .map((g): LiveAgent => {
      const elapsedMs = elapsed(now, g.since);
      return { session: g.session, source: g.source, claims: [...g.claims].sort(byClaim), since: g.since, elapsedMs, stale: elapsedMs > staleAfterMs };
    })
    .sort((a, b) => b.elapsedMs - a.elapsedMs || a.session.localeCompare(b.session) || a.source.localeCompare(b.source));
}
