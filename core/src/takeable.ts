// The takeable task set (T38, ISC-16), ported from the old SpecRun `plan()`: which tasks the next round may dispatch
// and why the others are held (operator lane, closed, blocked or locked claim, open edge or seam, same file, width,
// not [P]). Without tasks.md the open claims are the units. Tasks come from spec 002's task-line grammar (tasks.ts).
//
// A task is dispatched when its claim is takeable (open, every `after` claim resolved, no lock, and the spec's reviewed
// mark fresh: status.ts gates the partition, ISC-99), every task it names
// in `(after: …)` is done, no task already in the round names one of its files, the width is not reached, and the
// round is not owned by a seam or a task without [P]. The checks run in the old order, so a task held for two reasons
// shows the one the old planner showed.
//
// Pure: parsed claims and tasks in, the plan out. No file system, no Bun API.
import type { Claim } from './claims.ts';
import type { ClaimLock, SpecType, TasksModel } from './files.ts';
import type { MarkState } from './gates.ts';
import { partitionClaims } from './status.ts';
import type { ClaimPartition } from './status.ts';

export interface TakeableInput {
  readonly specType: SpecType | null;
  readonly claims: readonly Claim[];
  /** Parsed tasks.md; null when the spec has none. */
  readonly tasks: TasksModel | null;
  readonly locks?: readonly ClaimLock[];
  /**
   * The spec's reviewed mark (gates.ts `reviewedGate`). Required: without a fresh mark nothing is dispatched and every
   * task of a would-be-takeable claim is held as `spec not reviewed` (ISC-99). A passed `partition` carries its own.
   */
  readonly reviewed: MarkState;
  /** Tasks per round; defaults to 1 for bug, spike and infra, else 4. */
  readonly width?: number;
  /**
   * The claim partition when the caller already holds one (status.ts `partitionClaims`); absent means status.ts
   * `partitionClaims` derives it from `claims`, `locks` and `reviewed`.
   */
  readonly partition?: ClaimPartition;
}

export interface TakeableEntry {
  /** A task id `T12`, or `C1`… for a claim unit when there is no tasks.md. */
  readonly task: string;
  readonly claim: string;
  /** Why it is dispatched or held, one phrase. */
  readonly reason: string;
}

export interface TakeableSet {
  readonly width: number;
  /** Claim IDs takeable now. */
  readonly claims: readonly string[];
  readonly dispatch: readonly TakeableEntry[];
  readonly held: readonly TakeableEntry[];
  readonly tasks: { readonly landed: number; readonly total: number };
  /** Nothing left to dispatch: every unit is done, or every held unit waits on something a round cannot change. */
  readonly exhausted: boolean;
}

/** bug, spike and infra run one task at a time unless the caller asks for more (ImplementSpec § width). */
const SERIAL_TYPES: ReadonlySet<SpecType> = new Set(['bug', 'spike', 'infra']);

/** Hold reasons that no round can clear: the principal, the spec text or another session has to act first. */
const UNCHANGEABLE = /closed|locked|blocked|unknown|operator lane|not reviewed/;

interface Unit {
  readonly id: string;
  readonly claim: string;
  readonly done: boolean;
  readonly parallel: boolean;
  readonly seam: boolean;
  readonly lane: string | null;
  readonly after: readonly string[];
  readonly paths: readonly string[];
}

/** The units a round works: the tasks of tasks.md (struck ones gone), or one per open claim without it. */
function unitsOf(input: TakeableInput): Unit[] {
  if (input.tasks && input.tasks.tasks.length > 0) {
    return input.tasks.tasks
      .filter((t) => t.state !== 'struck')
      .map((t) => ({
        id: t.id,
        claim: t.claim,
        done: t.state === 'done',
        parallel: t.flags.parallel,
        seam: t.flags.seam,
        lane: t.lane,
        after: t.edges,
        paths: t.paths,
      }));
  }
  return input.claims
    .filter((c) => !c.checked && !c.dropped)
    .map((c, i) => ({ id: `C${i + 1}`, claim: c.id, done: false, parallel: false, seam: false, lane: null, after: [], paths: [] }));
}

export function takeableSet(input: TakeableInput): TakeableSet {
  const width = input.width ?? (input.specType !== null && SERIAL_TYPES.has(input.specType) ? 1 : 4);
  const partition = input.partition ?? partitionClaims(input.claims, input.locks ?? [], input.reviewed);
  const takeable = new Set(partition.takeable);
  const closed = new Set(partition.closed);
  const blocked = new Map(partition.blocked.map((b) => [b.id, b.openBlockers]));
  const taken = new Map(partition.taken.map((t) => [t.id, t.session]));
  const gated = new Set(partition.gated);

  const units = unitsOf(input);
  const byId = new Map(units.map((u) => [u.id, u]));
  const dispatch: Array<{ unit: Unit; reason: string }> = [];
  const held: TakeableEntry[] = [];
  const filesThisRound = new Set<string>();

  const holdReason = (u: Unit): string | null => {
    if (u.lane === 'operator') return "operator lane — the principal's own action, never auto-dispatched";
    if (closed.has(u.claim)) return 'claim already closed — task should be [x]; strike or check it';
    const blockers = blocked.get(u.claim);
    if (blockers) return `claim blocked by ${blockers.join(', ')}`;
    const session = taken.get(u.claim);
    if (session !== undefined) return `claim locked by ${session}`;
    if (gated.has(u.claim)) return `spec not reviewed — the reviewed mark is ${partition.reviewed}`;
    if (!takeable.has(u.claim)) return 'claim unknown to the spec';
    const openAfter = u.after.filter((a) => byId.get(a)?.done !== true);
    if (openAfter.length > 0) {
      const seams = openAfter.filter((a) => byId.get(a)?.seam === true);
      return seams.length > 0 ? `behind open seam ${seams.join(', ')}` : `after ${openAfter.join(', ')} still open`;
    }
    const collision = u.paths.find((p) => filesThisRound.has(p));
    if (collision !== undefined) return `same file as a task already in this round: ${collision}`;
    if (dispatch.length >= width) return `width ${width} reached`;
    const first = dispatch[0]?.unit;
    if (!first) return null;
    // A seam is the contract its fan-out waits for: it runs alone, wherever it stands in the file.
    if (u.seam) return 'seam — runs alone, next round';
    if (!u.parallel) return 'not [P] — runs alone, next round';
    if (dispatch.some((d) => !d.unit.parallel)) return `${first.id} owns this round (${first.seam ? 'seam' : 'not [P]'})`;
    return null;
  };

  for (const u of units) {
    if (u.done) continue;
    const reason = holdReason(u);
    if (reason !== null) {
      held.push({ task: u.id, claim: u.claim, reason });
      continue;
    }
    u.paths.forEach((p) => filesThisRound.add(p));
    const why = u.seam ? 'seam — runs alone before its fan-out' : u.parallel ? '[P], claim takeable, edges closed' : 'claim takeable, edges closed';
    dispatch.push({ unit: u, reason: why });
  }

  const open = units.filter((u) => !u.done).length;
  return {
    width,
    claims: [...takeable],
    dispatch: dispatch.map((d) => ({ task: d.unit.id, claim: d.unit.claim, reason: d.reason })),
    held,
    tasks: { landed: units.length - open, total: units.length },
    exhausted: open === 0 || (dispatch.length === 0 && held.every((h) => UNCHANGEABLE.test(h.reason))),
  };
}
