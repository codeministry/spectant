/**
 * The answers of the writes contract (part of `contracts/writes.contract.ts`): the 200, 409, 422 and 423 bodies by
 * write, `WriteAnswer`, and the conflict and lock builders the server answers with.
 *
 * Decisions (T67):
 * - Error codes stay the API's: `hash-mismatch` and `locked` (already in `API_ERRORS`, already sent by the stub),
 *   not a new `stale`. The 409 adds `files`; the 423's `lock` carries `session` and `source`.
 * - "No agent source" is `lockSource: 'none'`: on the 200 of both writes, and on the read side where it already is
 *   (`SpecPageModel.areas.live.lockSource`, `LiveFrame.lockSource`). No second field; `hasAgentSource` reads it and
 *   `NO_AGENT_SOURCE` is the page's words. With no source the write proceeds under the hash check alone (ISC-86).
 * - Both writes are refused by any lock on the spec (ISC-27 "an open claim on it"); the 423 names the task's own
 *   claim's lock first, then frontier over activity.
 * - A tick to the state the box already holds is a 200 with the unchanged line; the implementation writes nothing.
 *
 * The run lock (spec 040, T30, ISC-225): while a run on the write's item is `running` (core's `runLockOf`, the decision
 * `itemStates` takes; a run on the spec for the first three, a run on the story for the allocation), the write is
 * refused with 423 `RunLocked`: `{error: 'run-locked', run, command, actor, since}` of the newest running run, nothing
 * written. An `aborted` run (older than the `runAbortMinutes` setting) locks nothing. The checks keep one order:
 * 400 → 404 → 409 → 423 (a claim lock's `locked` first, then the run's `run-locked`) → 422 → 200, so a stale hash is
 * still the plain 409 while a run is open. The allocation's 423 is reachable through the run alone: a story has no claim.
 */
import type { ActorRef, ClaimLock, EventLine, ItemRun, LockSource } from '../../../../core/src/files.ts';
import { REVIEWED_HASH_FILES } from '../spec-routes.contract.ts';
import type {
  AllocateRefused,
  BacklogRefused,
  BacklogWritten,
  Conflict,
  GateReviewedResponse,
  IdeaAllocated,
  InvalidBody,
  Locked,
  ReviewedHashes,
  RunReleaseRefused,
  RunReleased,
  TaskCheckResponse,
  TransitionRefused,
  TransitionWritten,
} from '../spec-routes.contract.ts';
import { HASH_FILES } from './write-events.ts';
import { ACTIVITY_PATH } from './writes-table.ts';
import type { ReviewedFile, WriteOperation } from './writes-table.ts';

// ─── Answers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** 200 of the gate write: the base answer plus the event line appended. */
export interface GateReviewedWritten extends GateReviewedResponse {
  readonly event: EventLine;
}

/** 200 of the checkbox write: the base answer plus the task's line as it now stands (1-based, no newline). */
export interface TaskCheckWritten extends TaskCheckResponse {
  readonly line: { readonly number: number; readonly text: string };
}

/** 409 of the gate write: which files changed since render, and what all three hash to now. Nothing was written. */
export interface StaleGate extends Conflict<ReviewedHashes> {
  readonly files: readonly ReviewedFile[];
  readonly expected: ReviewedHashes;
}

/** 409 of the checkbox write: tasks.md changed since render; its raw hash now. Nothing was written. */
export interface StaleTasks extends Conflict<{ readonly tasks: string }> {
  readonly files: readonly ['tasks.md'];
  readonly expected: { readonly tasks: string };
}

/** 409 of the transition: spec.md changed since render; its raw hash now. Nothing was written. */
export interface StaleSpec extends Conflict<{ readonly spec: string }> {
  readonly files: readonly ['spec.md'];
  readonly expected: { readonly spec: string };
}

/** 409 of the backlog write: `specs/backlog.md` changed since render; its raw hash now. Nothing was written. */
export interface StaleBacklog extends Conflict<{ readonly backlog: string }> {
  readonly files: readonly ['specs/backlog.md'];
  readonly expected: { readonly backlog: string };
}

/** 409 of the run release: `.spectant/activity.jsonl` changed since render; its raw hash now. Nothing was written. */
export interface StaleActivity extends Conflict<{ readonly activity: string }> {
  readonly files: readonly ['.spectant/activity.jsonl'];
  readonly expected: { readonly activity: string };
}

/** 409 of the allocation: the story file changed since render; its path and raw hash now. Nothing was written. */
export interface StaleIdea extends Conflict<{ readonly idea: string }> {
  readonly files: readonly [string];
  readonly expected: { readonly idea: string };
}

export interface WriteOk {
  gateReviewed: GateReviewedWritten;
  taskCheck: TaskCheckWritten;
  transition: TransitionWritten;
  allocate: IdeaAllocated;
  backlog: BacklogWritten;
  runRelease: RunReleased;
}

export interface WriteStale {
  gateReviewed: StaleGate;
  taskCheck: StaleTasks;
  transition: StaleSpec;
  allocate: StaleIdea;
  backlog: StaleBacklog;
  runRelease: StaleActivity;
}

/** The 422 of the three writes the workflow, the index or the backlog's rules may refuse. */
export interface WriteRefused {
  transition: TransitionRefused;
  allocate: AllocateRefused;
  backlog: BacklogRefused;
  runRelease: RunReleaseRefused;
}

/**
 * Every answer a write's own logic gives, by status. A `switch (answer.status)` needs no default; the 422 arm exists
 * only for a refusable write, so `WriteAnswer<WriteRoute>` carries it for the transition alone. The 423 arm stays on
 * the backlog write's type for `runWrite`'s sake, but `writeBacklog` never answers it and `writeAnswerOf` never fits it.
 */
export type WriteAnswer<R extends WriteOperation> =
  | { readonly status: 200; readonly body: WriteOk[R] }
  | { readonly status: 400; readonly body: InvalidBody }
  | { readonly status: 409; readonly body: WriteStale[R] }
  | { readonly status: 423; readonly body: Locked }
  | (R extends keyof WriteRefused ? { readonly status: 422; readonly body: WriteRefused[R] } : never);

/** The files whose hash differs between what the client rendered and what the server reads now. */
export function staleFiles(sent: ReviewedHashes, now: ReviewedHashes): ReviewedFile[] {
  return HASH_FILES.filter((key) => sent[key] !== now[key]).map((key) => REVIEWED_HASH_FILES[key] as ReviewedFile);
}

/** The gate write's 409, or null when every hash matches. */
export function gateConflict(sent: ReviewedHashes, now: ReviewedHashes): StaleGate | null {
  const files = staleFiles(sent, now);
  return files.length === 0 ? null : { error: 'hash-mismatch', files, expected: now };
}

/** The checkbox write's 409 (raw tasks.md hashes), or null when they match. */
export function tasksConflict(sent: string, now: string): StaleTasks | null {
  return sent === now ? null : { error: 'hash-mismatch', files: ['tasks.md'], expected: { tasks: now } };
}

/** The transition's 409 (raw spec.md hashes), or null when they match. */
export function specConflict(sent: string, now: string): StaleSpec | null {
  return sent === now ? null : { error: 'hash-mismatch', files: ['spec.md'], expected: { spec: now } };
}

/** The allocation's 409 for the story file at `path` (`specs/ideas/<slug>.md`), or null when the raw hashes match. */
export function ideaConflict(path: string, sent: string, now: string): StaleIdea | null {
  return sent === now ? null : { error: 'hash-mismatch', files: [path], expected: { idea: now } };
}

/** The backlog write's 409 (raw `specs/backlog.md` hashes), or null when they match. */
export function backlogConflict(sent: string, now: string): StaleBacklog | null {
  return sent === now ? null : { error: 'hash-mismatch', files: ['specs/backlog.md'], expected: { backlog: now } };
}

/** The run release's 409 (raw `.spectant/activity.jsonl` hashes), or null when they match. */
export function activityConflict(sent: string, now: string): StaleActivity | null {
  return sent === now ? null : { error: 'hash-mismatch', files: [ACTIVITY_PATH], expected: { activity: now } };
}

/**
 * The 423 for the locks held on this spec's claims (the live reading's `locks`), or null when none is held. Any lock
 * blocks either write; the answer names the lock on `claim` (the task's claim; null for the gate) first, then a
 * frontier lock before an activity one, then file order.
 */
export function blockingLock(locks: readonly ClaimLock[], claim: string | null): Locked | null {
  const rank = (l: ClaimLock): number => (l.claim === claim ? 0 : 2) + (l.source === 'frontier' ? 0 : 1);
  let best: ClaimLock | null = null;
  for (const l of locks) if (best === null || rank(l) < rank(best)) best = l;
  return best === null ? null : { error: 'locked', lock: best };
}

/**
 * 423 while a run on the write's item is `running` (spec 040, ISC-225): the newest running run's id, command, actor
 * and start, as core's `runLockOf` gives them. Nothing was written. The web client reads it from spec 040's T56 on;
 * until then `writeAnswerOf` does not fit it, so a client that cannot show it takes it as an unknown failure.
 */
export interface RunLocked {
  readonly error: 'run-locked';
  readonly run: string;
  /** `ItemRun.command`: a run line always names one (locks.ts skips a line without), so null only by the model's type. */
  readonly command: string | null;
  readonly actor: ActorRef;
  readonly since: string;
}

/** The 423 for the run that locks the write's item (core's `runLockOf`), or null when no run is running on it. */
export function runLockedOf(run: Pick<ItemRun, 'run' | 'command' | 'actor' | 'since'> | null): RunLocked | null {
  return run === null ? null : { error: 'run-locked', run: run.run, command: run.command, actor: run.actor, since: run.since };
}

/** The page's words when no lock source is present (ISC-86). */
export const NO_AGENT_SOURCE = 'no agent source';

/** False for `lockSource: 'none'`: the page shows `NO_AGENT_SOURCE` and a write runs under the hash check alone. */
export function hasAgentSource(source: LockSource): boolean {
  return source !== 'none';
}
