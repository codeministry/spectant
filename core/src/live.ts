// The live frame (T21, ISC-90): the board as it stands now, from three layers applied in this order.
//
//   1. carry-forward  the last result frame's cards (frames.ts), as the round left them.
//   2. tasks.md       the current task lines decide which cards exist and in which order (tasks.md order):
//                     - a task on the last board with the same id and text keeps its card; a box checked since then
//                       flips a card that had not landed to `done`, or `closed` once spec.md checks its claim
//                       (`operatorDone` in the operator lane), keeping builder, tries and note;
//                     - a task not on the last board (new, or renumbered / reworded: no state is carried, ISC-91)
//                       gets a fresh card: landed when its box is checked, else `waiting` (`operatorOpen` in the
//                       operator lane) with the reason takeable.ts gives it, when spec.md is there to compute one;
//                     - a struck task still on the last board is `absent` with its strike note; any other struck task
//                       and any task gone from tasks.md has no card. Without task lines the carried cards stand.
//   3. locks          every card not landed, not absent and outside the operator lane whose claim a session holds is
//                     `running`, with the lock's source and session, `since`, `elapsedMs` (now − since) and `stale`
//                     (no release for longer than `staleAfterMs`, 45 minutes by default). Only locks on this spec's
//                     claims count; a claim held in both sources shows the frontier lock (the reading lists it last).
//
// The frame adds the agents rail (one entry per session holding a lock here, oldest lock first) and the Needs you list
// (question, concerns, open operator steps). Claims progress comes from spec.md's boxes, tasks progress from the cards.
//
// Pure: texts, frames, a lock reading and the clock in, the frame out. No file system, no clock of its own, no Bun or
// node API; the server reads the lock sources (locks.ts) and passes `now`.
import type { Claim } from './claims.ts';
import { countProgress, parseClaims } from './claims.ts';
import type { AgentLockSource, CardState, ClaimLock, FrameCard, LiveAgent, LiveCard, LiveFrame, LiveFrameInput, TaskRow } from './files.ts';
import { buildFrames, worstState } from './frames.ts';
import { parseFrontmatter } from './frontmatter.ts';
import { takeableSet } from './takeable.ts';
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
  const held = new Map<string, ClaimLock>();
  for (const lock of reading.locks) if (ours.has(lock.claim)) held.set(lock.claim, lock);
  const locks = [...held.values()].sort((a, b) => byClaim(a.claim, b.claim));

  const overlaid = rows.length === 0 ? [...base] : overlayTasks(base, rows, claims, locks, spec);
  const cards: LiveCard[] = overlaid.map((card) => {
    const lock = held.get(card.claim);
    if (lock === undefined || LANDED.has(card.state) || card.state === 'absent' || card.lane === OPERATOR) return card;
    const elapsedMs = elapsed(now, lock.since);
    // In flight: the session is the reason, so a waiting or dispatch reason is dropped.
    return ordered({ ...card, state: 'running', lock: { source: lock.source, session: lock.session }, since: lock.since, elapsedMs, stale: elapsedMs > staleAfterMs }, 'reason');
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
  };
}

/** Layer 2: tasks.md's lines over the carried cards. */
function overlayTasks(base: readonly FrameCard[], rows: readonly TaskRow[], claims: readonly Claim[], locks: readonly ClaimLock[], spec: string | undefined): FrameCard[] {
  const carried = new Map(base.map((c) => [c.task, c]));
  const sameText = boardTexts(base);
  const checked = new Set(claims.filter((c) => c.checked).map((c) => c.id));
  const reasons = spec === undefined ? new Map<string, string>() : takeableReasons(spec, claims, rows, locks);
  const landedState = (row: TaskRow): CardState => (row.lane === OPERATOR ? 'operatorDone' : checked.has(row.claim) ? 'closed' : 'done');

  return rows.flatMap((row): FrameCard[] => {
    const before = carried.get(row.id);
    if (row.state === 'struck') {
      if (before === undefined) return [];
      return [ordered({ ...identity(row, before.text), state: 'absent', tries: before.tries, ...(row.note === null ? {} : { note: row.note }) })];
    }
    if (before !== undefined && sameText.get(row.id) === row.text) {
      if (row.state !== 'done' || LANDED.has(before.state)) return [before];
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

/** takeable.ts's dispatch or hold reason per open task, as the next round would plan it now. */
function takeableReasons(spec: string, claims: readonly Claim[], rows: readonly TaskRow[], locks: readonly ClaimLock[]): Map<string, string> {
  const plan = takeableSet({
    specType: parseFrontmatter(spec).data.specType,
    claims,
    tasks: { tasks: rows, probeMapping: [] },
    locks,
  });
  return new Map([...plan.dispatch, ...plan.held].map((e) => [e.task, e.reason]));
}

/** The identity fields of a card from its task line. */
function identity(row: TaskRow, text = row.text): Pick<FrameCard, 'task' | 'claim' | 'lane' | 'text' | 'parallel' | 'seam'> {
  return { task: row.id, claim: row.claim, lane: row.lane, text: text === '' ? row.text : text, parallel: row.flags.parallel, seam: row.flags.seam };
}

/** A card in frames.ts's field order, then the live fields (stable JSON for the golden snapshots); `drop` left out. */
function ordered(card: LiveCard, drop?: keyof LiveCard): LiveCard {
  const out: Record<string, unknown> = {};
  for (const key of CARD_KEYS) if (key !== drop && card[key] !== undefined) out[key] = card[key];
  return out as unknown as LiveCard;
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
