/**
 * The writes of the spec routes contract (part of `contracts/spec-routes.contract.ts`): the request and 200 bodies of
 * every route that writes a repository file, the hash headers the client sends back, the refusals, and the body
 * validators.
 *
 * Pending routes (spec 008, T81; plan 008 § Interfaces "Contract, new routes"): none left. `transition` moved into
 * `SPEC_ROUTE_TABLE` with its handler (T83, `transition-route.ts`), `idea` (T88), `boardQuery` (T92) and `allocate` (T87,
 * the family's one write) into `WORKSPACE_ROUTE_TABLE`; `actors` (T91) is a route of its own, `ACTORS_PATH`, beside
 * `/api/settings`. The pending family went with its last route; the bodies stay in § Spec 008 bodies.
 */
import type { BacklogEvent } from '../../../../core/src/backlog.ts';
import { FILE_KINDS } from '../../../../core/src/files.ts';
import type { EventLine, FileKind, LockSource, WorkflowStage } from '../../../../core/src/files.ts';
import { HEX64, isRecord } from '../guards.ts';
import { hasOnlyKeys } from './route-match.ts';

// ─── Writes ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The files the reviewed mark hashes, by file kind. */
export type ReviewedHashFile = Extract<FileKind, 'spec' | 'plan' | 'tasks'>;

/** File names on disk; equal to `REVIEWED_FILES` in `core/src/gates.ts` (pinned by the contract test). */
export const REVIEWED_HASH_FILES: Readonly<Record<ReviewedHashFile, string>> = {
  spec: FILE_KINDS.spec.path,
  plan: FILE_KINDS.plan.path,
  tasks: FILE_KINDS.tasks.path,
};

/**
 * sha256 hex of each file normalised by `hashForGate` in `core/src/gates.ts` (frontmatter, checkbox states, struck
 * marks and spec.md's Not yet specified, Decisions and Verification dropped); null for a file that does not exist.
 */
export type ReviewedHashes = Readonly<Record<ReviewedHashFile, string | null>>;

/** `POST …/gate/reviewed`: the hashes the reviewer saw. The server recomputes them; any difference is a 409. */
export interface GateReviewedRequest {
  readonly hashes: ReviewedHashes;
}

/**
 * `POST …/tasks/:tid/check`: the checkbox wanted, and the sha256 hex of tasks.md's raw bytes as rendered. Raw, not
 * normalised: normalising drops checkbox states, so it could not see a concurrent tick.
 */
export interface TaskCheckRequest {
  readonly checked: boolean;
  readonly hash: string;
}

/** 200 of the gate write: the mark as written, and the lock source consulted (`none` shows "no agent source"). */
export interface GateReviewedResponse {
  readonly at: string;
  readonly hashes: ReviewedHashes;
  readonly lockSource: LockSource;
}

/** 200 of the checkbox write: the task, its new state, tasks.md's new raw hash, and the lock source consulted. */
export interface TaskCheckResponse {
  readonly task: string;
  readonly checked: boolean;
  readonly hash: string;
  readonly lockSource: LockSource;
}

/**
 * Where the client gets the hashes it sends back, from the same answer it renders, so the check covers exactly
 * what was shown. Sent on 200 and 304 alike (a 304's headers update the cached answer).
 *
 * - `REVIEWED_HASHES_HEADER` on `GET …/:id`: `formatReviewedHashes(…)`, e.g. `spec=<hex>, plan=<hex>, tasks=-`.
 * - `TASKS_HASH_HEADER` on `GET …/:id/tasks`: the raw sha256 hex of tasks.md; absent when there is no tasks.md.
 */
export const REVIEWED_HASHES_HEADER = 'X-Spectant-Reviewed-Hashes';
export const TASKS_HASH_HEADER = 'X-Spectant-Tasks-Hash';
/**
 * The raw sha256 hex of `.spectant/activity.jsonl` (spec 040, ISC-226), the empty text's without the file: sent on
 * `GET /api/workspaces/:ws/dashboard`, the answer whose items show a run, and sent back on the run release.
 */
export const ACTIVITY_HASH_HEADER = 'X-Spectant-Activity-Hash';

const HASH_FILES = Object.keys(REVIEWED_HASH_FILES) as ReviewedHashFile[];
const isHashOrNull = (value: unknown): boolean => value === null || (typeof value === 'string' && HEX64.test(value));

export function formatReviewedHashes(hashes: ReviewedHashes): string {
  return HASH_FILES.map((file) => `${file}=${hashes[file] ?? '-'}`).join(', ');
}

/** The header value back as hashes; null when it is malformed or incomplete. */
export function parseReviewedHashes(value: string | null): ReviewedHashes | null {
  if (value === null) return null;
  const out: Partial<Record<ReviewedHashFile, string | null>> = {};
  for (const item of value.split(',')) {
    const [key = '', hash = ''] = item.trim().split('=');
    if (!(HASH_FILES as string[]).includes(key)) return null;
    const parsed = hash === '-' ? null : hash;
    if (!isHashOrNull(parsed)) return null;
    out[key as ReviewedHashFile] = parsed;
  }
  return HASH_FILES.every((file) => file in out) ? (out as ReviewedHashes) : null;
}

export function isGateReviewedRequest(body: unknown): body is GateReviewedRequest {
  if (typeof body !== 'object' || body === null) return false;
  const hashes = (body as { hashes?: unknown }).hashes;
  if (typeof hashes !== 'object' || hashes === null) return false;
  const record = hashes as Record<string, unknown>;
  return Object.keys(record).length === HASH_FILES.length && HASH_FILES.every((file) => file in record && isHashOrNull(record[file]));
}

export function isTaskCheckRequest(body: unknown): body is TaskCheckRequest {
  if (typeof body !== 'object' || body === null) return false;
  const { checked, hash } = body as { checked?: unknown; hash?: unknown };
  return typeof checked === 'boolean' && typeof hash === 'string' && HEX64.test(hash);
}

// ─── Spec 008 bodies (T81) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The bodies of spec 008's writes and resources, declared ahead of their handlers (T81) and shared by the server, the
 * e2e stub and the web client; every route is registered now (`transition` in `SPEC_ROUTE_TABLE`, `idea`, `boardQuery`
 * and `allocate` in `WORKSPACE_ROUTE_TABLE`, the actor names at `ACTORS_PATH`).
 */

/**
 * Where the client gets `TransitionRequest.hash`: the raw sha256 hex of spec.md on `GET …/:id` (200 and 304), as
 * `TASKS_HASH_HEADER` carries tasks.md's. Raw, not normalised: the transition rewrites `stage:` in the frontmatter,
 * which the normalised gate hash drops. `GET …/:id` sends it beside `REVIEWED_HASHES_HEADER` (T83).
 */
export const SPEC_HASH_HEADER = 'X-Spectant-Spec-Hash';

/** Every stage a transition may name, pinned to core's `WorkflowStage` (a missing or extra key fails `tsc`). */
const WORKFLOW_STAGES = {
  plan: true,
  tasks: true,
  review: true,
  build: true,
  blocked: true,
  'code-review': true,
  close: true,
  done: true,
  idea: true,
  'close-pending': true,
} as const satisfies Record<WorkflowStage, true>;

/**
 * `POST …/:id/transition`: the stage wanted and the raw sha256 hex of spec.md as the page read it. The actor is not
 * the client's to name: the server records the viewer's `u:` id (`VIEWER_ACTOR_FALLBACK` without one).
 */
export interface TransitionRequest {
  readonly to: WorkflowStage;
  readonly hash: string;
}

/** 200 of the transition: the move made, spec.md's new raw hash, the event appended, the lock source consulted. */
export interface TransitionWritten {
  readonly from: WorkflowStage;
  readonly to: WorkflowStage;
  readonly hash: string;
  readonly event: EventLine;
  readonly lockSource: LockSource;
}

/**
 * 422 of the transition: spec.md is current and the workflow says no. `reason` is the stage row's phrase and
 * `command` the one that would make the move, as `planTransition` refuses; spec.md stays byte-identical.
 */
export interface TransitionRefused {
  readonly error: 'transition-refused';
  readonly reason: string;
  readonly command: string | null;
}

/** `POST …/ideas/:slug/allocate`: the raw sha256 hex of the story file as the page read it. */
export interface AllocateRequest {
  readonly hash: string;
}

/** 200 of the allocation: the new spec, the files written and the story file removed, all repository-relative. */
export interface IdeaAllocated {
  /** `NNN`. */
  readonly id: string;
  /** `specs/NNN-slug/`. */
  readonly folder: string;
  /** In `WRITE_PATHS.allocate` order. */
  readonly files: readonly string[];
  /** `specs/ideas/<slug>.md`. */
  readonly removed: string;
  readonly lockSource: LockSource;
}

/**
 * 422 of the allocation: nothing was written. `folder-exists` when the folder the next number names is already
 * there, `not-in-index` when `specs/ideas/README.md` does not list the story; `folder` is the folder it would create.
 */
export interface AllocateRefused {
  readonly error: 'allocate-refused';
  readonly reason: 'folder-exists' | 'not-in-index';
  readonly folder: string | null;
}

/**
 * `POST /api/workspaces/:ws/backlog` (spec 036, ISC-191): move a feature before another feature of its milestone
 * (`before`, null for behind the milestone's last one), or set its priority. `hash` is the raw sha256 hex of
 * `specs/backlog.md` as the client read it, `PlanningModel.backlogHash` (the hash of the empty text without the file).
 * The actor is not the client's to name: the server records the viewer's `u:` id (`VIEWER_ACTOR_FALLBACK` without
 * one). `priority` is any string here; one other than `P1` to `P4` is the write's 422, not a 400.
 */
export type BacklogRequest =
  | { readonly op: 'move'; readonly feature: string; readonly before: string | null; readonly hash: string }
  | { readonly op: 'priority'; readonly feature: string; readonly priority: string; readonly hash: string };

/** 200 of the backlog write: `specs/backlog.md`'s new raw hash, for the next write, and the event appended. */
export interface BacklogWritten {
  readonly hash: string;
  readonly event: BacklogEvent;
}

/**
 * 422 of the backlog write: the file is current and core's `planBacklogMove` / `planBacklogPriority` say no
 * (another milestone, an unknown feature, an invalid priority, a write that changes nothing). Both files stay
 * byte-identical.
 */
export interface BacklogRefused {
  readonly error: 'backlog-refused';
  readonly reason: string;
}

/**
 * `POST /api/workspaces/:ws/runs/:run/release` (spec 040, ISC-226): end the open run `:run` as `released`. The route
 * takes no body; its one input is the raw sha256 hex of `.spectant/activity.jsonl` the client rendered, sent in
 * `ACTIVITY_HASH_HEADER` (`runReleaseRequestFromHeader`). The actor is not the client's to name: the server records
 * the viewer's `u:` id, and without one it refuses (422 `no-viewer`).
 */
export interface RunReleaseRequest {
  readonly hash: string;
}

/**
 * The one line the release appends to `.spectant/activity.jsonl`: a `run-end` of the open run, keys in this order,
 * `command` and `spec` or `idea` as the run's `run-start` wrote them, `session` the viewer's `u:` id, `outcome`
 * `released`. core's `locks.ts` reads it as the run's end, so the run is no longer open.
 */
export interface RunReleaseEvent {
  readonly ts: string;
  readonly event: 'run-end';
  readonly run: string;
  readonly command: string;
  readonly session: string;
  readonly spec?: string;
  readonly idea?: string;
  readonly outcome: 'released';
}

/** 200 of the run release: `.spectant/activity.jsonl`'s new raw hash, for the next release, and the line appended. */
export interface RunReleased {
  readonly hash: string;
  readonly event: RunReleaseEvent;
}

/** Why a release of an open run is refused: no `u:` viewer to name, or the run already reads `aborted`. */
export const RELEASE_REFUSALS = ['no-viewer', 'run-aborted'] as const;
export type ReleaseRefusal = (typeof RELEASE_REFUSALS)[number];

/** 422 of the run release: the hash is current and the run open, but the release is refused. Nothing is written. */
export interface RunReleaseRefused {
  readonly error: 'release-refused';
  readonly reason: ReleaseRefusal;
}

/** The release body from the `ACTIVITY_HASH_HEADER` value the client sends; null when absent or not 64 lowercase hex. */
export function runReleaseRequestFromHeader(header: string | null): RunReleaseRequest | null {
  return header !== null && HEX64.test(header) ? { hash: header } : null;
}

export function isTransitionRequest(body: unknown): body is TransitionRequest {
  if (!isRecord(body) || !hasOnlyKeys(body, ['to', 'hash'])) return false;
  const { to, hash } = body;
  return typeof to === 'string' && Object.hasOwn(WORKFLOW_STAGES, to) && typeof hash === 'string' && HEX64.test(hash);
}

export function isAllocateRequest(body: unknown): body is AllocateRequest {
  if (!isRecord(body) || !hasOnlyKeys(body, ['hash'])) return false;
  const { hash } = body;
  return typeof hash === 'string' && HEX64.test(hash);
}

/** A feature id as a feature heading names it: `F8`, `F1.1`. */
const FEATURE_ID = /^F\d+(?:\.\d+)?$/;
const isFeatureId = (v: unknown): v is string => typeof v === 'string' && FEATURE_ID.test(v);

export function isBacklogRequest(body: unknown): body is BacklogRequest {
  if (!isRecord(body)) return false;
  const { op, feature, hash, before, priority } = body;
  if (!isFeatureId(feature) || typeof hash !== 'string' || !HEX64.test(hash)) return false;
  if (op === 'move') return hasOnlyKeys(body, ['op', 'feature', 'before', 'hash']) && (before === null || isFeatureId(before));
  if (op === 'priority') return hasOnlyKeys(body, ['op', 'feature', 'priority', 'hash']) && typeof priority === 'string';
  return false;
}
