/**
 * The answers of the spec routes contract (part of `contracts/spec-routes.contract.ts`): how every JSON answer is
 * sent, the 200 body of each spec route, which golden family feeds which route, every error body, and the headers of
 * the evidence file.
 *
 * Error spelling: kebab-case codes, `{error: "not-found"}`. The dashboard routes, the settings routes, the e2e stub and
 * their tests already answer `not-found`, `forbidden`, `method-not-allowed`, `invalid-body`, and core's own codes
 * (`not-a-file`, `symlink-escape`, `permission-denied`) are kebab-case too. Plan 002 wrote `not_found`; nothing has
 * consumed it, and one convention across the API beats matching one line of the plan.
 */
import type {
  ClaimLock,
  ClaimViewModel,
  Frame,
  LiveFrame,
  SpecPageModel,
  TaskSteps,
  TasksTab,
  TimelineEntry,
} from '../../../../core/src/files.ts';
import type { SpecRouteName } from './spec-route-table.ts';
import type { WorkspaceRouteName } from './workspace-route-table.ts';
import type {
  AllocateRefused,
  BacklogRefused,
  GateReviewedResponse,
  ReviewedHashes,
  RunReleaseRefused,
  TaskCheckResponse,
  TransitionRefused,
  TransitionWritten,
} from './write-requests.ts';

// ─── Answers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every JSON answer, 200 or error, as `api.ts` `json()` already sends it (T45 exports and reuses that function, it
 * does not copy it; the stub mirrors it): this `Content-Type`, this `Cache-Control`, and a strong `ETag` of `"` +
 * base64url(sha256(exact body)) + `"`. A 200 whose tag matches `If-None-Match` is a 304; `HEAD` gets the headers alone.
 */
export const JSON_ANSWER = {
  contentType: 'application/json; charset=utf-8',
  cacheControl: 'no-cache',
  etag: 'strong, "<base64url sha256 of the body>"',
  notModified: 304,
} as const;

/** The 200 body of each route. Only core types: the golden family's per-spec value is exactly this. */
export interface SpecRouteResponses {
  spec: SpecPageModel;
  timeline: readonly TimelineEntry[];
  claims: ClaimViewModel;
  /**
   * Null when the spec has no tasks.md (200, not 404: a spec before its tasks stage is still a spec). Beside the tab,
   * `steps`: core's `taskSteps` for this spec's tasks (spec 015, ISC-232), the golden family `steps` at this spec's key.
   */
  tasks: (TasksTab & { readonly steps: TaskSteps }) | null;
  /** The file's bytes with `evidenceFileHeaders(mediaTypeOf(name))`. */
  evidenceFile: Blob;
  frames: readonly Frame[];
  /** The live frame with `steps` beside it, as the tasks route sends them (spec 015, ISC-232). */
  live: LiveFrame & { readonly steps: TaskSteps };
  gateReviewed: GateReviewedResponse;
  taskCheck: TaskCheckResponse;
  transition: TransitionWritten;
}

export type SpecRouteResponse<R extends SpecRouteName> = SpecRouteResponses[R];

/**
 * Which golden family (`core/fixtures/<tree>.<family>.golden.json`) feeds which route. A spec route's family is keyed
 * by `specs/…` folder and the route answers one key's value; a workspace route's family is the whole file, the body
 * as it is.
 */
export const GOLDEN_FAMILY = {
  spec: 'spec',
  timeline: 'timeline',
  claims: 'claim-view',
  tasks: 'tasks',
  frames: 'frames',
  /**
   * The whole file is the `PlanningModel`, built with a fixed `now` so milestone states hold still; the server
   * passes today, so a stub body and a live one may differ in `state` alone.
   */
  planning: 'planning',
} as const satisfies Partial<Record<SpecRouteName | WorkspaceRouteName, string>>;

// ─── Error bodies ────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Every `error` code the API sends besides the unreadable-workspace codes. The two refusals are the 422s of the
 * pending writes (`TransitionRefused`, `AllocateRefused`, `BacklogRefused`): the file is current, the workflow, the
 * index or the backlog's rules say no.
 */
export const API_ERRORS = [
  'not-found',
  'forbidden',
  'method-not-allowed',
  'invalid-body',
  'invalid-spec',
  'hash-mismatch',
  'locked',
  'run-locked',
  'transition-refused',
  'allocate-refused',
  'backlog-refused',
  'release-refused',
] as const;
export type ApiError = (typeof API_ERRORS)[number];

/** The 422 codes. */
export const REFUSAL_ERRORS = ['transition-refused', 'allocate-refused', 'backlog-refused', 'release-refused'] as const satisfies readonly ApiError[];

/** 404: unknown workspace, spec, document or task, or an evidence path that names no file. Never a fallback body. */
export interface NotFound {
  readonly error: 'not-found';
}

/** 403: a foreign `Host` or cross-site `Origin`, or an evidence path refused as `outside` or `symlink-escape`. */
export interface Forbidden {
  readonly error: 'forbidden';
}

/** 405 with `Allow: allowFor(route)`. */
export interface MethodNotAllowed {
  readonly error: 'method-not-allowed';
}

/** 400 on a write whose body is not JSON or fails `isGateReviewedRequest` / `isTaskCheckRequest`. */
export interface InvalidBody {
  readonly error: 'invalid-body';
}

/** 400 on a favourite's set or unset whose spec id is not a spec folder name, `NNN-slug` (`isFavoriteSpec`, spec 052). */
export interface InvalidSpec {
  readonly error: 'invalid-spec';
}

/** 409 on a write: the file changed since it was rendered. `expected` is what the files hash to now; nothing was written. */
export interface Conflict<H> {
  readonly error: 'hash-mismatch';
  readonly expected?: H;
}

/** 423 on a write: a lock holds a claim the write touches (ISC-86). Nothing was written. */
export interface Locked {
  readonly error: 'locked';
  readonly lock: ClaimLock;
}

/** Why a workspace cannot be read; equal to `UnreadableCode` in `workspace-loader.ts` (pinned by the contract test). */
export type UnreadableCode = 'missing' | 'not-a-directory' | 'permission-denied' | 'unreadable';

/**
 * 409 on any route of a registered workspace whose directory cannot be read: the workspace's own summary, the same
 * body the dashboard route sends (`WorkspaceSummary` in `api.ts` with `readable: false`). Told apart from `Conflict`
 * by `readable`.
 */
export interface Unavailable {
  readonly slug: string;
  readonly name: string;
  readonly pathTail: string;
  readonly readable: false;
  readonly error: UnreadableCode;
  readonly counts: null;
}

/** The error body a route may send, by route. */
export type SpecRouteError<R extends SpecRouteName> =
  | NotFound
  | Forbidden
  | MethodNotAllowed
  | Unavailable
  | (R extends 'gateReviewed' ? InvalidBody | Conflict<ReviewedHashes> | Locked : never)
  | (R extends 'taskCheck' ? InvalidBody | Conflict<{ readonly tasks: string }> | Locked : never)
  | (R extends 'transition' ? InvalidBody | Conflict<{ readonly spec: string }> | TransitionRefused | Locked : never);

/**
 * The error body a workspace route may send: 404 unknown slug, 403 guard, 405 wrong method, 409 unreadable workspace
 * (the same `Unavailable` summary the dashboard sends). The board query (T92) reads the database alone: no 409, and
 * its `PUT` adds 400 `invalid-body`. The favourites (spec 052) read the database alone too: no 409, and the set and
 * the unset add 400 `invalid-spec`. The allocation (T87) adds its write answers: 400, the 409 `hash-mismatch` of the
 * story, the 422 `allocate-refused` and the 423 the contract keeps (unreachable for a story, `writes.ts` `writeAllocate`).
 * Without a route named, the union of the file reads.
 */
export type WorkspaceRouteError<R extends WorkspaceRouteName = 'planning' | 'idea'> =
  | NotFound
  | Forbidden
  | MethodNotAllowed
  | ([R] extends ['boardQuery'] ? InvalidBody : [R] extends ['favorites'] ? never : [R] extends ['favorite'] ? InvalidSpec : Unavailable)
  | ([R] extends ['allocate'] ? InvalidBody | Conflict<{ readonly idea: string }> | AllocateRefused | Locked : never)
  | ([R] extends ['backlog'] ? InvalidBody | Conflict<{ readonly backlog: string }> | BacklogRefused : never)
  | ([R] extends ['runRelease'] ? InvalidBody | Conflict<{ readonly activity: string }> | RunReleaseRefused : never);

export function isUnavailable(body: unknown): body is Unavailable {
  return typeof body === 'object' && body !== null && (body as { readable?: unknown }).readable === false;
}

// ─── Evidence file ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The headers of `GET …/evidence/file` for a media type from `mediaTypeOf` (`core/src/evidence.ts`): text types and
 * JSON carry `charset=utf-8`; images, markdown, plain text and JSON are `inline`, HTML and anything unknown are
 * `attachment` (a spec folder's HTML never renders on the app's origin); `nosniff` and a sandboxing CSP always.
 */
export function evidenceFileHeaders(mediaType: string): Record<string, string> {
  const text = mediaType.startsWith('text/') || mediaType === 'application/json';
  const inline = mediaType.startsWith('image/') || ['text/markdown', 'text/plain', 'application/json'].includes(mediaType);
  return {
    'Content-Type': text ? `${mediaType}; charset=utf-8` : mediaType,
    'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': inline ? 'inline' : 'attachment',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': JSON_ANSWER.cacheControl,
  };
}
