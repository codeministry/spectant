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
 * - The event is `review → build` in the stage table's names (the reviewed mark moves the spec from waiting for review to building, as `derived-stages.ts` derives it), as ISC-24 fixes it (decided 2026-09-29). Its actor is the viewer's `u:` id, `VIEWER_ACTOR_FALLBACK` without one (spec 008, T80; `app` before, now legacy).
 * - Both writes are refused by any lock on the spec (ISC-27 "an open claim on it"); the 423 names the task's own
 *   claim's lock first, then frontier over activity.
 * - A tick to the state the box already holds is a 200 with the unchanged line; the implementation writes nothing.
 *
 * Spec 008 (T81) adds two writes, declared here and served by later tasks (`WRITE_TABLE`, `WRITE_PATHS`):
 *
 * | write | trigger | client's hash | 200 | 409 `hash-mismatch` | 422 | 423 `locked` |
 * |-------|---------|---------------|-----|---------------------|-----|--------------|
 * | reviewed mark | `POST …/:id/gate/reviewed` | normalised gate hashes | `GateReviewedWritten` | `StaleGate` | — | `Locked` |
 * | task checkbox | `POST …/:id/tasks/:tid/check` | raw tasks.md | `TaskCheckWritten` | `StaleTasks` | — | `Locked` |
 * | transition | `POST …/:id/transition` (T83) | raw spec.md, `X-Spectant-Spec-Hash` | `TransitionWritten` | `StaleSpec` | `TransitionRefused` | `Locked` |
 * | allocate | `POST …/ideas/:slug/allocate` (T87) | raw story file, `IdeaPage.hash` | `IdeaAllocated` | `StaleIdea` | `AllocateRefused` | `Locked` |
 *
 * These four are every write the app makes on a user's action. The feature-level code-review mark
 * (`.gates/code-reviewed.json` in each folder of a main feature, plus one event line each) is the fifth write path,
 * `WRITE_PATHS.codeReviewFeature`, but it has no route: the skill triggers it through the CLI (`spectant gate
 * code-reviewed F<n>`, T93, `feature-gate.ts`), never the UI, so it is not in this table. The token measurement
 * (`specs/tokens.jsonl`, once per repository) is the sixth, `WRITE_PATHS.tokens`, written in place only by the CLI
 * `spectant tokens --yes` (spec 009, `tokens-cli.ts`) and likewise without a route or a row here.
 *
 * Where a write lands (spec 027, T22, ISC-181; `WRITE_TABLE[op].root`): the three writes on an existing spec (reviewed
 * mark, task checkbox, transition) resolve their `WRITE_PATHS` against the spec's read source, the main checkout or,
 * when `specs/NNN-slug/` is tracked and the spec has a worktree of its own, that worktree's copy, the same copy the
 * client's hash was rendered from; the main checkout then stays byte-identical. The allocation, the CLI's feature mark
 * and the token measurement resolve theirs against the main checkout. The paths themselves do not change.
 *
 * Browser-safe like its base: imports are `spec-routes.contract.ts`, `core/src/events.ts` and `core/src/files.ts` only
 * (no Bun, no Node). `core/src/gates.ts` is not imported, not even as types: it hashes with `node:crypto`, and a type
 * import still type-checks its module under the web tsconfig, which rejects it. `ReviewedFile` and `ReviewedMark` are
 * therefore declared here, pinned equal to gates.ts' own by `tests/writes.contract.test.ts`, so the web client imports
 * `writeAnswerOf` directly (spec 008, T111).
 */
import { validateEventLine } from '../../core/src/events.ts';
import { FILE_KINDS } from '../../core/src/files.ts';
import type { ClaimLock, EventLine, LockSource } from '../../core/src/files.ts';
import {
  REVIEWED_HASHES_HEADER,
  REVIEWED_HASH_FILES,
  SPEC_HASH_HEADER,
  TASKS_HASH_HEADER,
  isGateReviewedRequest,
  isTaskCheckRequest,
  isTransitionRequest,
  parseReviewedHashes,
  specRoutes,
} from './spec-routes.contract.ts';
import type {
  AllocateRefused,
  ApiError,
  Conflict,
  GateReviewedRequest,
  GateReviewedResponse,
  IdeaAllocated,
  InvalidBody,
  Locked,
  ReviewedHashFile,
  ReviewedHashes,
  SpecRouteName,
  TaskCheckRequest,
  TaskCheckResponse,
  TransitionRefused,
  TransitionRequest,
  TransitionWritten,
} from './spec-routes.contract.ts';

/** `ReviewedFile` of `core/src/gates.ts`: the files the reviewed mark hashes (equality pinned by the contract test). */
export type ReviewedFile = 'spec.md' | 'plan.md' | 'tasks.md';

/** `ReviewedMark` of `core/src/gates.ts`: the bytes of `.gates/reviewed.json` (equality pinned by the contract test). */
export interface ReviewedMark {
  readonly gate: 'reviewed';
  readonly at: string;
  readonly files: Readonly<Record<ReviewedFile, string | null>>;
}

// ─── Routes ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The POST routes of `SPEC_ROUTE_TABLE`, in table order: the two writes of spec 002 and the transition (T83). */
export const WRITE_ROUTES = ['gateReviewed', 'taskCheck', 'transition'] as const satisfies readonly SpecRouteName[];
export type WriteRoute = (typeof WRITE_ROUTES)[number];

/** The builders of the write routes; the same functions as `specRoutes`. */
export const writeRoutes = {
  gateReviewed: specRoutes.gateReviewed,
  taskCheck: specRoutes.taskCheck,
  transition: specRoutes.transition,
} as const satisfies Record<WriteRoute, (...args: never[]) => string>;

/** The statuses `WriteAnswer` types; 403, 404 and 405 are the route layer's, as on every spec route. */
export const WRITE_STATUSES = [200, 400, 409, 423] as const;

/** The error codes only a write sends, all in `API_ERRORS`. */
export const WRITE_ERRORS = ['invalid-body', 'hash-mismatch', 'locked'] as const satisfies readonly ApiError[];

/** The GET header each write's hash comes from, on the answer the client rendered. */
export const WRITE_HASH_HEADER = {
  gateReviewed: REVIEWED_HASHES_HEADER,
  taskCheck: TASKS_HASH_HEADER,
  transition: SPEC_HASH_HEADER,
} as const satisfies Record<WriteRoute, string>;

/** The files the writes touch, relative to the spec folder. */
export const REVIEWED_MARK_PATH = FILE_KINDS.gateReviewed.path;
export const EVENTS_PATH = FILE_KINDS.events.path;
export const TASKS_PATH = FILE_KINDS.tasks.path;
export const SPEC_PATH = FILE_KINDS.spec.path;
export const CONTEXT_PATH = FILE_KINDS.context.path;

// ─── The four app writes (spec 008, T81) ─────────────────────────────────────────────────────────────────────────

/** Every write the app makes on a user's action, in table order; the first two are `WRITE_ROUTES`. */
export const WRITE_OPERATIONS = ['gateReviewed', 'taskCheck', 'transition', 'allocate'] as const;
export type WriteOperation = (typeof WRITE_OPERATIONS)[number];

export interface WriteTableEntry {
  /** The client's hash: the GET header it was rendered with, or the body field it read. */
  readonly hashFrom: string;
  /** `normalised` by `hashForGate` (the reviewed mark), or `raw` file bytes. */
  readonly hash: 'normalised' | 'raw';
  /** The 409 body, by type name: `hash-mismatch` with `files` and `expected`, nothing written. */
  readonly conflict: 'StaleGate' | 'StaleTasks' | 'StaleSpec' | 'StaleIdea';
  /** The 422 body, by type name; null for a write the workflow never refuses. */
  readonly refused: 'TransitionRefused' | 'AllocateRefused' | null;
  /** The 423 body, by type name: the same `{error: 'locked', lock}` for every write. */
  readonly locked: 'Locked';
  /**
   * True while its route is registered and served (`SPEC_ROUTE_TABLE`, or `WORKSPACE_ROUTE_TABLE` for `allocate`);
   * false while its route has no handler (every one has since T87).
   */
  readonly registered: boolean;
  /**
   * What the write's `WRITE_PATHS` are relative to (spec 027, T22): `source`, the spec's read source (the main
   * checkout, or the worktree copy when the spec is read from it), or `main`, always the main checkout.
   */
  readonly root: 'source' | 'main';
}

/** The four writes with their hash, 409, 422 and 423 forms and the root their paths resolve against (the header's table). */
export const WRITE_TABLE = {
  gateReviewed: { hashFrom: REVIEWED_HASHES_HEADER, hash: 'normalised', conflict: 'StaleGate', refused: null, locked: 'Locked', registered: true, root: 'source' },
  taskCheck: { hashFrom: TASKS_HASH_HEADER, hash: 'raw', conflict: 'StaleTasks', refused: null, locked: 'Locked', registered: true, root: 'source' },
  transition: { hashFrom: SPEC_HASH_HEADER, hash: 'raw', conflict: 'StaleSpec', refused: 'TransitionRefused', locked: 'Locked', registered: true, root: 'source' },
  allocate: { hashFrom: 'IdeaPage.hash', hash: 'raw', conflict: 'StaleIdea', refused: 'AllocateRefused', locked: 'Locked', registered: true, root: 'main' },
} as const satisfies Record<WriteOperation, WriteTableEntry>;

/**
 * What one write may touch, relative to the root `WRITE_TABLE[op].root` names: the spec's read source (the main
 * checkout, or the worktree copy when the spec is read from it) for the three writes on an existing spec, the main
 * checkout for the rest. `specs/NNN-slug/` is the spec folder, `<slug>` the story's slug.
 */
export interface WritePaths {
  /** Written in place, with an fsync; no temp file, no rename. */
  readonly writes: readonly string[];
  /** Removed. */
  readonly removes: readonly string[];
  /** The one directory the write may create, or null. */
  readonly creates: string | null;
}

const FOLDER = 'specs/NNN-slug/';
const STORY = '<slug>';
const inFolder = (path: string): string => `${FOLDER}${path}`;

/**
 * The one constant naming every file an app write may touch; nothing outside it changes in a registered repository
 * (`tests/readonly.test.ts`). Built from core's file kinds, so a renamed file renames here.
 */
export const WRITE_PATHS = {
  gateReviewed: { writes: [inFolder(REVIEWED_MARK_PATH), inFolder(EVENTS_PATH)], removes: [], creates: inFolder('.gates/') },
  taskCheck: { writes: [inFolder(TASKS_PATH)], removes: [], creates: null },
  transition: { writes: [inFolder(SPEC_PATH), inFolder(EVENTS_PATH)], removes: [], creates: null },
  allocate: {
    writes: [inFolder(CONTEXT_PATH), inFolder(SPEC_PATH), inFolder(EVENTS_PATH)],
    removes: [`${FILE_KINDS.idea.repoPath ?? ''}${STORY}.md`],
    creates: FOLDER,
  },
  // The fifth path (T93): the feature-level code-review mark and one event line in each target folder, written only by
  // `spectant gate code-reviewed F<n>` (`feature-gate.ts`). No HTTP write, so no `WriteOperation` and no `WRITE_TABLE` row.
  codeReviewFeature: { writes: [inFolder(FILE_KINDS.gateCodeReviewed.path), inFolder(EVENTS_PATH)], removes: [], creates: inFolder('.gates/') },
  // The sixth path (spec 009): the repository's token measurement, rewritten in place only by `spectant tokens --yes`
  // (`tokens-cli.ts`), which takes its target from here. No HTTP write, so no `WriteOperation` and no `WRITE_TABLE` row.
  tokens: { writes: [FILE_KINDS.tokens.repoPath ?? ''], removes: [], creates: null },
} as const satisfies Record<WriteOperation | 'codeReviewFeature' | 'tokens', WritePaths>;

/** `WRITE_PATHS[op]` for one spec folder (`NNN-slug`) and, for `allocate`, the story's slug. */
export function writePathsOf(op: WriteOperation, folder: string, slug = ''): WritePaths {
  const fill = (path: string): string => path.replace(FOLDER, `specs/${folder}/`).replace(STORY, slug);
  const paths: WritePaths = WRITE_PATHS[op];
  return { writes: paths.writes.map(fill), removes: paths.removes.map(fill), creates: paths.creates === null ? null : fill(paths.creates) };
}

// ─── Requests ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WriteRequests {
  gateReviewed: GateReviewedRequest;
  taskCheck: TaskCheckRequest;
  transition: TransitionRequest;
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
  const valid =
    route === 'gateReviewed' ? isGateReviewedRequest(data) : route === 'taskCheck' ? isTaskCheckRequest(data) : isTransitionRequest(data);
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

/**
 * The actor the app's event lines named before spec 008 (T80). Outside the actor grammar, so it reads as legacy;
 * no write records it any more, and the events already written with it stay readable.
 */
export const WRITE_ACTOR = 'app';

/**
 * The actor every app write records when the viewer has no `u:` id (no git address configured): an agent id of the
 * grammar, where `WRITE_ACTOR` reads as legacy. With an id, the event names the viewer.
 */
export const VIEWER_ACTOR_FALLBACK = 'a:spectant:app';

/** The actor an app write records: the viewer's `u:` id (`actorIdOf` of the git address), else the fallback. */
export function writeActorOf(viewer: string | null): string {
  return viewer ?? VIEWER_ACTOR_FALLBACK;
}

/** The event's `command`: the app's action, not a skill command it did not run. */
export function reviewedEventCommand(specId: string): string {
  return `spectant mark-reviewed ${specId}`;
}

/** The one event the gate write appends. `ts` is the mark's `at`; `actor` is `writeActorOf(viewer)`. */
export function reviewedEvent(ts: string, specId: string, actor: string): EventLine {
  return { ts, ...REVIEWED_EVENT, command: reviewedEventCommand(specId), actor };
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

/** 409 of the transition: spec.md changed since render; its raw hash now. Nothing was written. */
export interface StaleSpec extends Conflict<{ readonly spec: string }> {
  readonly files: readonly ['spec.md'];
  readonly expected: { readonly spec: string };
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
}

export interface WriteStale {
  gateReviewed: StaleGate;
  taskCheck: StaleTasks;
  transition: StaleSpec;
  allocate: StaleIdea;
}

/** The 422 of the two writes the workflow or the index may refuse. */
export interface WriteRefused {
  transition: TransitionRefused;
  allocate: AllocateRefused;
}

/**
 * Every answer a write's own logic gives, by status. A `switch (answer.status)` needs no default; the 422 arm exists
 * only for a refusable write, so `WriteAnswer<WriteRoute>` carries it for the transition alone.
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
/**
 * The fields the validators read, named: a record with literal keys, not an index signature, so the web tsconfig's
 * `noPropertyAccessFromIndexSignature` admits the dot access this file uses (T111).
 */
type RecKey =
  | 'at' | 'checked' | 'claim' | 'command' | 'error' | 'event' | 'expected' | 'files' | 'folder' | 'from' | 'hash'
  | 'hashes' | 'id' | 'idea' | 'line' | 'lock' | 'lockSource' | 'number' | 'reason' | 'removed' | 'session' | 'since'
  | 'source' | 'spec' | 'task' | 'tasks' | 'text' | 'to';
type Rec = Partial<Record<RecKey, unknown>>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHex = (v: unknown): boolean => typeof v === 'string' && HEX64.test(v);
const isLockSource = (v: unknown): v is LockSource => v === 'frontier' || v === 'activity' || v === 'none';
const isHashes = (v: unknown): v is ReviewedHashes => isGateReviewedRequest({ hashes: v });
const isFileList = (v: unknown): boolean =>
  Array.isArray(v) && v.length > 0 && v.every((f) => (Object.values(REVIEWED_HASH_FILES) as unknown[]).includes(f));

function isReviewedEvent(v: unknown): boolean {
  if (!isRec(v)) return false;
  const check = validateEventLine(JSON.stringify(v));
  // The viewer's `u:` id or the fallback agent id: an actor of the grammar, never a legacy value (T80).
  return check.ok && v.from === REVIEWED_EVENT.from && v.to === REVIEWED_EVENT.to && check.event.actorRef?.legacy === false;
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

/** A stage name a transition may carry: the request's own validator, over a well-formed placeholder hash. */
const isStage = (v: unknown): boolean => isTransitionRequest({ to: v, hash: '0'.repeat(64) });

/** The transition's event: a valid line from `from` to `to`, its actor of the grammar (the viewer or the fallback). */
function isTransitionEvent(v: unknown, from: unknown, to: unknown): boolean {
  if (!isRec(v)) return false;
  const check = validateEventLine(JSON.stringify(v));
  return check.ok && v.from === from && v.to === to && check.event.actorRef?.legacy === false;
}

/** `specs/ideas/<slug>.md`: a story file's repository path, as the allocation's 200 and 409 name it. */
const IDEAS_DIR = FILE_KINDS.idea.repoPath ?? '';
const isStoryPath = (v: unknown): boolean =>
  typeof v === 'string' &&
  v.startsWith(IDEAS_DIR) &&
  v.endsWith('.md') &&
  v.length > IDEAS_DIR.length + '.md'.length &&
  !v.slice(IDEAS_DIR.length).includes('/');
const SPEC_FOLDER = /^specs\/(\d{3})-[^/]+\/$/;

/** The allocation's 200: `NNN`, its folder `specs/NNN-slug/`, the files `WRITE_PATHS.allocate` writes there, the story removed. */
function isAllocated(b: Rec): boolean {
  if (typeof b.id !== 'string' || typeof b.folder !== 'string' || !isStoryPath(b.removed)) return false;
  const folder = SPEC_FOLDER.exec(b.folder);
  if (folder?.[1] !== b.id) return false;
  const expected = writePathsOf('allocate', b.folder.slice('specs/'.length, -1)).writes;
  const files = b.files;
  return Array.isArray(files) && files.length === expected.length && expected.every((path, i) => files[i] === path);
}

function isOk(route: WriteOperation, b: Rec): boolean {
  if (!isLockSource(b.lockSource)) return false;
  if (route === 'gateReviewed') return typeof b.at === 'string' && isHashes(b.hashes) && isReviewedEvent(b.event);
  if (route === 'transition') return isStage(b.from) && isStage(b.to) && isHex(b.hash) && isTransitionEvent(b.event, b.from, b.to);
  if (route === 'allocate') return isAllocated(b);
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

function isStale(route: WriteOperation, b: Rec): boolean {
  if (b.error !== 'hash-mismatch' || !isRec(b.expected) || !Array.isArray(b.files)) return false;
  const files = b.files as unknown[];
  if (route === 'allocate') return files.length === 1 && isStoryPath(files[0]) && isHex(b.expected.idea);
  if (!isFileList(files)) return false;
  if (route === 'gateReviewed') return isHashes(b.expected);
  if (route === 'transition') return files.length === 1 && files[0] === SPEC_PATH && isHex(b.expected.spec);
  return files.length === 1 && files[0] === TASKS_PATH && isHex(b.expected.tasks);
}

/**
 * The two 422s: the transition's (the stage row's phrase and the command that would make the move, or null) and the
 * allocation's (`folder-exists` or `not-in-index`, with the folder it would create, or null).
 */
function isRefused(route: WriteOperation, b: Rec): boolean {
  if (route === 'transition') {
    return b.error === 'transition-refused' && typeof b.reason === 'string' && (b.command === null || typeof b.command === 'string');
  }
  return (
    route === 'allocate' &&
    b.error === 'allocate-refused' &&
    (b.reason === 'folder-exists' || b.reason === 'not-in-index') &&
    (b.folder === null || (typeof b.folder === 'string' && SPEC_FOLDER.test(b.folder)))
  );
}

/**
 * The answer typed by its status when the body fits it; null for any other status or a body that does not fit. It
 * covers the four app writes (`WriteOperation`): the three spec routes and, since T111, the allocation, so the web
 * client validates every write answer here and nowhere else.
 */
export function writeAnswerOf<R extends WriteOperation>(route: R, status: number, body: unknown): WriteAnswer<R> | null {
  if (!isRec(body)) return null;
  const fits =
    (status === 200 && isOk(route, body)) ||
    (status === 400 && body.error === 'invalid-body') ||
    (status === 409 && isStale(route, body)) ||
    (status === 422 && isRefused(route, body)) ||
    (status === 423 && body.error === 'locked' && isClaimLock(body.lock));
  return fits ? ({ status, body } as unknown as WriteAnswer<R>) : null;
}
