// Who a spec is assigned to (spec 008, T65, ISC-131): derived on every read, never stored. The actor of the spec's
// newest open claim lock wins, since a session holding a claim is working on the spec now; without one, the actor of
// the spec's last event, who moved it last; without either, nobody (null). A legacy actor (`principal`) is an
// assignee like any other, carried with `legacy: true`, as every reader keeps legacy values (actor.ts).
//
// Read by `dashboard.ts` (`DashboardSpecRow.assignee`), `spec.ts` (`SpecHead.assignee`, the row's value) and
// `planning.ts` (`PlanningHolder.assignee`), so the three surfaces cannot disagree over the same input.
//
// Pure over what the caller read: the spec's claim ids, the repository's locks as `readLockSources` delivers them and
// the spec's validated events. Browser-safe: no `node:` import, it rides the barrel.
import { parseActor } from './actor.ts';
import type { ActorRef, ClaimLock, EventLine } from './files.ts';

export interface AssigneeInput {
  /** The claim ids the spec's spec.md lists; a lock on any other claim belongs to another spec and is ignored. */
  readonly claims: Iterable<string>;
  /**
   * The repository's open locks, as `readLockSources` delivers them (`LockReading.locks`: activity entries first,
   * frontier entries last, each held, released claims already gone); absent without a lock source.
   */
  readonly locks?: readonly ClaimLock[];
  /** The spec's events in file order, as `parseEvents` validated them; absent without `events.jsonl`. */
  readonly events?: readonly EventLine[];
}

/** A lock's `since` as a number; a time that does not parse sorts before every other. */
const sinceOf = (lock: ClaimLock): number => {
  const ms = Date.parse(lock.since);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
};

/**
 * The spec's assignee: the actor of its newest open claim lock (latest `since`; on a tie the later entry, so a frontier
 * lock beats an activity one as everywhere else), else the actor of its last event, else null.
 */
export function assigneeOf(input: AssigneeInput): ActorRef | null {
  const claims = new Set(input.claims);
  let newest: ClaimLock | null = null;
  for (const lock of input.locks ?? []) {
    if (!claims.has(lock.claim)) continue;
    if (newest === null || sinceOf(lock) >= sinceOf(newest)) newest = lock;
  }
  if (newest !== null) return newest.actor;
  const last = input.events?.at(-1);
  if (last === undefined) return null;
  return last.actorRef ?? parseActor(last.actor);
}
