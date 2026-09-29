/**
 * The writes contract (T67, ISC-24 to ISC-27, ISC-86; plan 002 § Interfaces "HTTP", the two writes).
 *
 * The app's only two writes into a registered repository, both user-triggered: the reviewed mark
 * (`specs/NNN-slug/.gates/reviewed.json` plus one line in `events.jsonl`) and one task checkbox (one line of
 * `tasks.md`). This file is what `server/src/writes.ts` (T68), the gate route (T69), the checkbox route (T70), the lock
 * guard (T71), the e2e stub and the web client agree on. It writes nothing; every function is pure.
 *
 * It builds on `spec-routes.contract.ts` and never re-declares it: the routes, the request bodies
 * (`GateReviewedRequest`, `TaskCheckRequest`), the hash headers and the base answers (`GateReviewedResponse`,
 * `TaskCheckResponse`, `Conflict`, `Locked`, `InvalidBody`) live there and keep their names. What this file adds:
 *
 * | route | body (client's sha256) | 200 | 409 `hash-mismatch` | 423 `locked` |
 * |-------|------------------------|-----|---------------------|--------------|
 * | `POST …/:id/gate/reviewed` | `{hashes: {spec, plan, tasks}}`, the `X-Spectant-Reviewed-Hashes` of the rendered page (normalised gate hashes, null = absent file) | `GateReviewedWritten`: `at`, the hashes written, `lockSource`, the `event` appended | `StaleGate`: `files` that changed, `expected` = their hashes now | `{lock: ClaimLock}` |
 * | `POST …/:id/tasks/:tid/check` | `{checked, hash}`, `hash` = the `X-Spectant-Tasks-Hash` (raw sha256 of tasks.md) | `TaskCheckWritten`: task, state, tasks.md's new raw `hash`, `lockSource`, the changed `line` | `StaleTasks`: `files: ['tasks.md']`, `expected.tasks` = raw hash now | `{lock: ClaimLock}` |
 *
 * Decisions (T67):
 * - Error codes stay the API's: `hash-mismatch` and `locked` (already in `API_ERRORS`, already sent by the stub),
 *   not a new `stale`. The 409 adds `files`; the 423's `lock` carries `session` and `source`.
 * - "No agent source" is `lockSource: 'none'`: on the 200 of both writes, and on the read side where it already is
 *   (`SpecPageModel.areas.live.lockSource`, `LiveFrame.lockSource`). No second field; `hasAgentSource` reads it and
 *   `NO_AGENT_SOURCE` is the page's words. With no source the write proceeds under the hash check alone (ISC-86).
 * - The event is `review → build` in the stage table's names (the reviewed mark moves the spec from waiting for review to building, as `derived-stages.ts` derives it), as ISC-24 fixes it (decided 2026-09-29), actor `app`.
 * - Both writes are refused by any lock on the spec (ISC-27 "an open claim on it"); the 423 names the task's own
 *   claim's lock first, then frontier over activity.
 * - A tick to the state the box already holds is a 200 with the unchanged line; the implementation writes nothing.
 *
 * Browser-safe like its base: value imports are `spec-routes.contract.ts` and `core/src/events.ts` only (no Bun, no
 * Node); `core/src/gates.ts` is imported as types, because it hashes with `node:crypto`.
 */
import { validateEventLine } from '../../core/src/events.ts';
import { FILE_KINDS } from '../../core/src/files.ts';
import type { ClaimLock, EventLine, LockSource } from '../../core/src/files.ts';
import type { ReviewedFile, ReviewedMark } from '../../core/src/gates.ts';
import {
  REVIEWED_HASHES_HEADER,
  REVIEWED_HASH_FILES,
  TASKS_HASH_HEADER,
  isGateReviewedRequest,
  isTaskCheckRequest,
  parseReviewedHashes,
  specRoutes,
} from './spec-routes.contract.ts';
import type {
  ApiError,
  Conflict,
  GateReviewedRequest,
  GateReviewedResponse,
  InvalidBody,
  Locked,
  ReviewedHashFile,
  ReviewedHashes,
  SpecRouteName,
  TaskCheckRequest,
  TaskCheckResponse,
} from './spec-routes.contract.ts';

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The two POST routes of `SPEC_ROUTE_TABLE`, in table order. */
export const WRITE_ROUTES = ['gateReviewed', 'taskCheck'] as const satisfies readonly SpecRouteName[];
export type WriteRoute = (typeof WRITE_ROUTES)[number];

/** The builders of the write routes; the same functions as `specRoutes`. */
export const writeRoutes = {
  gateReviewed: specRoutes.gateReviewed,
  taskCheck: specRoutes.taskCheck,
} as const satisfies Record<WriteRoute, (...args: never[]) => string>;

/** The statuses `WriteAnswer` types; 403, 404 and 405 are the route layer's, as on every spec route. */
export const WRITE_STATUSES = [200, 400, 409, 423] as const;

/** The error codes only a write sends, all in `API_ERRORS`. */
export const WRITE_ERRORS = ['invalid-body', 'hash-mismatch', 'locked'] as const satisfies readonly ApiError[];

/** The GET header each write's hash comes from, on the answer the client rendered. */
export const WRITE_HASH_HEADER = {
  gateReviewed: REVIEWED_HASHES_HEADER,
  taskCheck: TASKS_HASH_HEADER,
} as const satisfies Record<WriteRoute, string>;

/** The files the writes touch, relative to the spec folder. */
export const REVIEWED_MARK_PATH = FILE_KINDS.gateReviewed.path;
export const EVENTS_PATH = FILE_KINDS.events.path;
export const TASKS_PATH = FILE_KINDS.tasks.path;

// ─── Requests ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WriteRequests {
  gateReviewed: GateReviewedRequest;
  taskCheck: TaskCheckRequest;
}

/** The gate body from the `X-Spectant-Reviewed-Hashes` value the page was rendered with; null when malformed. */
export function gateReviewedRequestFromHeader(header: string | null): GateReviewedRequest | null {
  const hashes = parseReviewedHashes(header);
  return hashes === null ? null : { hashes };
}

/** The checkbox body: the raw tasks.md hash (`X-Spectant-Tasks-Hash`) and the state wanted. */
export function taskCheckRequest(hash: string, checked: boolean): TaskCheckRequest {
  return { checked, hash };
}

export type ParsedWriteBody<R extends WriteRoute> =
  | { readonly ok: true; readonly body: WriteRequests[R] }
  | { readonly ok: false; readonly error: InvalidBody };

/** The request text as the route's body, or the 400 `invalid-body` answer. Never throws. */
export function parseWriteBody<R extends WriteRoute>(route: R, text: string): ParsedWriteBody<R> {
  const invalid = { ok: false, error: { error: 'invalid-body' } } as const;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return invalid;
  }
  const valid = route === 'gateReviewed' ? isGateReviewedRequest(data) : isTaskCheckRequest(data);
  return valid ? { ok: true, body: data as WriteRequests[R] } : invalid;
}

// ─── The reviewed mark and its event ─────────────────────────────────────────────────────────────────────────────

const HASH_FILES = Object.keys(REVIEWED_HASH_FILES) as ReviewedHashFile[];

/** The hashes keyed by file name, in `REVIEWED_FILES` order: the mark's `files`. */
function markFiles(hashes: ReviewedHashes): ReviewedMark['files'] {
  const files: Partial<Record<ReviewedFile, string | null>> = {};
  for (const key of HASH_FILES) files[REVIEWED_HASH_FILES[key] as ReviewedFile] = hashes[key];
  return files as ReviewedMark['files'];
}

/**
 * The bytes of `.gates/reviewed.json`, exactly as the old skill's SpecGate `mark` writes them:
 * `JSON.stringify({gate, at, files}, null, 2) + "\n"`, so `readGateMark` and the old tool read it alike. The hashes
 * are the server's own recomputation (equal to the client's, or it is a 409). The app never touches `.gitignore`.
 */
export function reviewedMarkText(at: string, hashes: ReviewedHashes): string {
  const mark: ReviewedMark = { gate: 'reviewed', at, files: markFiles(hashes) };
  return `${JSON.stringify(mark, null, 2)}\n`;
}

/** The transition the gate write records, in the stage table's names (ISC-24). */
export const REVIEWED_EVENT = { from: 'review', to: 'build' } as const;

/** Who the app's event lines name. */
export const WRITE_ACTOR = 'app';

/** The event's `command`: the app's action, not a skill command it did not run. */
export function reviewedEventCommand(specId: string): string {
  return `spectant mark-reviewed ${specId}`;
}

/** The one event the gate write appends. `ts` is the mark's `at`. */
export function reviewedEvent(ts: string, specId: string): EventLine {
  return { ts, ...REVIEWED_EVENT, command: reviewedEventCommand(specId), actor: WRITE_ACTOR };
}

/**
 * The bytes appended to `events.jsonl` (null or `''` = no file yet): one JSON line and its newline, preceded by a
 * newline when the file does not end in one, so the new event never fuses with the last line.
 */
export function eventAppendBytes(existing: string | null, event: EventLine): string {
  const lead = existing !== null && existing !== '' && !existing.endsWith('\n') ? '\n' : '';
  return `${lead}${JSON.stringify(event)}\n`;
}

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

export interface WriteOk {
  gateReviewed: GateReviewedWritten;
  taskCheck: TaskCheckWritten;
}

export interface WriteStale {
  gateReviewed: StaleGate;
  taskCheck: StaleTasks;
}

/** Every answer a write's own logic gives, by status. A `switch (answer.status)` needs no default. */
export type WriteAnswer<R extends WriteRoute> =
  | { readonly status: 200; readonly body: WriteOk[R] }
  | { readonly status: 400; readonly body: InvalidBody }
  | { readonly status: 409; readonly body: WriteStale[R] }
  | { readonly status: 423; readonly body: Locked };

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

/** The page's words when no lock source is present (ISC-86). */
export const NO_AGENT_SOURCE = 'no agent source';

/** False for `lockSource: 'none'`: the page shows `NO_AGENT_SOURCE` and a write runs under the hash check alone. */
export function hasAgentSource(source: LockSource): boolean {
  return source !== 'none';
}

// ─── Answer validators (the client's side) ───────────────────────────────────────────────────────────────────────

const HEX64 = /^[0-9a-f]{64}$/;
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHex = (v: unknown): boolean => typeof v === 'string' && HEX64.test(v);
const isLockSource = (v: unknown): v is LockSource => v === 'frontier' || v === 'activity' || v === 'none';
const isHashes = (v: unknown): v is ReviewedHashes => isGateReviewedRequest({ hashes: v });
const isFileList = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((f) => (Object.values(REVIEWED_HASH_FILES) as unknown[]).includes(f));

function isReviewedEvent(v: unknown): boolean {
  if (!isRec(v)) return false;
  const check = validateEventLine(JSON.stringify(v));
  return check.ok && v.from === REVIEWED_EVENT.from && v.to === REVIEWED_EVENT.to && v.actor === WRITE_ACTOR;
}

function isClaimLock(v: unknown): v is ClaimLock {
  return (
    isRec(v) &&
    (v.source === 'frontier' || v.source === 'activity') &&
    typeof v.claim === 'string' &&
    typeof v.session === 'string' &&
    typeof v.since === 'string'
  );
}

function isOk(route: WriteRoute, b: Rec): boolean {
  if (!isLockSource(b.lockSource)) return false;
  if (route === 'gateReviewed') return typeof b.at === 'string' && isHashes(b.hashes) && isReviewedEvent(b.event);
  const line = b.line;
  return (
    typeof b.task === 'string' &&
    typeof b.checked === 'boolean' &&
    isHex(b.hash) &&
    isRec(line) &&
    Number.isInteger(line.number) &&
    (line.number as number) >= 1 &&
    typeof line.text === 'string' &&
    !line.text.includes('\n')
  );
}

function isStale(route: WriteRoute, b: Rec): boolean {
  if (b.error !== 'hash-mismatch' || !isFileList(b.files) || !isRec(b.expected)) return false;
  if (route === 'gateReviewed') return isHashes(b.expected);
  return (b.files as unknown[]).length === 1 && (b.files as unknown[])[0] === TASKS_PATH && isHex(b.expected.tasks);
}

/** The answer typed by its status when the body fits it; null for any other status or a body that does not fit. */
export function writeAnswerOf<R extends WriteRoute>(route: R, status: number, body: unknown): WriteAnswer<R> | null {
  if (!isRec(body)) return null;
  const fits =
    (status === 200 && isOk(route, body)) ||
    (status === 400 && body.error === 'invalid-body') ||
    (status === 409 && isStale(route, body)) ||
    (status === 423 && body.error === 'locked' && isClaimLock(body.lock));
  return fits ? ({ status, body } as unknown as WriteAnswer<R>) : null;
}
