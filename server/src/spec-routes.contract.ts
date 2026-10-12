/**
 * The spec routes contract (T44, ISC-78; plan 002 § Interfaces "HTTP").
 *
 * This file is the seam between three consumers that build against it without talking to each other:
 *
 * 1. `server/src/spec-routes.ts` (T45–T50) answers every route in `SPEC_ROUTE_TABLE`: `matchSpecPath` finds the route
 *    and its decoded params, `SpecRouteResponses` names the 200 body, the error interfaces below name every other.
 * 2. `web/e2e/stub-api.ts` (T52) answers the same routes from the golden snapshots, `core/fixtures/<tree>.<family>.golden.json`,
 *    whose per-spec value is exactly the 200 body (`GOLDEN_FAMILY` says which family feeds which route).
 * 3. The web client (T35+) builds every URL with `specRoutes` and types every answer with `SpecRouteResponses`.
 *
 * Every body type is a `core/src/files.ts` type, imported by `import type` and never re-declared, so the three cannot
 * drift from the parser. The module is browser-safe: no Bun or Node import, and its only value import is
 * `assets.contract.ts` and `core/src/files.ts`, both pure.
 *
 * Params: `:ws` is the workspace slug, `:id` the spec ref as `core/src/resolve.ts` `resolveSpec` reads it (`002`,
 * `002-web-console` or `web-console`; the web uses the dashboard row's `id`, `NNN`), `:name` a `DocName`, `:tid` a task
 * id (`T12`). Builders percent-encode each segment once; `matchSpecPath` decodes each segment once, so `%2541` arrives
 * as `%41`, never as `A`. The evidence file's `path` travels in the query and is passed on raw
 * (`evidencePathQuery`): `resolveEvidencePath` in `core/src/evidence.ts` decodes it exactly once and refuses a second
 * layer.
 *
 * Error spelling: kebab-case codes, `{error: "not-found"}`. The dashboard routes, the settings routes, the e2e stub and
 * their tests already answer `not-found`, `forbidden`, `method-not-allowed`, `invalid-body`, and core's own codes
 * (`not-a-file`, `symlink-escape`, `permission-denied`) are kebab-case too. Plan 002 wrote `not_found`; nothing has
 * consumed it, and one convention across the API beats matching one line of the plan.
 *
 * Workspace routes (spec 003, plan 003 § Interfaces "Contract, new workspace route"): a second, smaller family that
 * names a whole workspace, `/api/workspaces/:ws/<route>`, with no `/specs/:id`. Today it holds `planning`, the
 * planning tree (`PlanningModel`, `core/src/planning.ts`) the Features and Milestones pages and the spec-head
 * breadcrumb read once per workspace. It sits beside the spec family, not inside it: `matchSpecPath` requires
 * `/specs/:id` and its params, so folding a slug-only route into `SPEC_ROUTE_TABLE` would change what every spec
 * route's match carries. `workspaceRoutes` builds, `matchWorkspacePath` matches (one segment matcher shared with
 * `matchSpecPath`, so both decode the same way), `WORKSPACE_ROUTE_TABLE` lists, `WorkspaceRouteResponses` types the
 * 200 and `WorkspaceRouteError` every other answer. The dashboard (`/api/workspaces/:ws/dashboard`) is a workspace
 * route too but stays in `api.ts` with its own `DASHBOARD_PATH` and is not listed here: this family answers from the
 * contract alone, and moving the dashboard in would change `api.ts`, which this contract does not own.
 *
 * Pending routes (spec 008, T81; plan 008 § Interfaces "Contract, new routes"): `transition`, `idea`, `allocate`,
 * `actors` and `boardQuery` are declared in full (builders, `matchPendingPath`, bodies, answers, errors,
 * `PENDING_ROUTE_TABLE`) but registered nowhere yet; see that section for why and for what a handler task moves.
 */
import { API_PREFIX } from './assets.contract.ts';
import { FILE_KINDS } from '../../core/src/files.ts';
import type { PlanningModel } from '../../core/src/planning.ts';
import type {
  ClaimLock,
  ClaimViewModel,
  DocAvailability,
  DocName,
  DocsPage,
  EventLine,
  EvidenceListing,
  FileKind,
  Frame,
  IdeaRef,
  LiveFrame,
  LockSource,
  SpecPageModel,
  TasksTab,
  TimelineEntry,
  WorkflowStage,
} from '../../core/src/files.ts';

// ─── Paths ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The workspace routes' root; equal to `WORKSPACES_PATH` in `api.ts` (pinned by the contract test). */
export const SPEC_API_ROOT = `${API_PREFIX}workspaces`;

/** The Docs tabs a `…/docs/:name` route serves, in tab order. Any other name is no route. */
export const DOC_NAMES: readonly DocName[] = ['plan', 'design', 'decisions', 'constitution'];

export type SpecRouteName =
  | 'spec'
  | 'timeline'
  | 'claims'
  | 'tasks'
  | 'evidence'
  | 'evidenceFile'
  | 'docs'
  | 'frames'
  | 'live'
  | 'gateReviewed'
  | 'taskCheck';

export interface SpecParams {
  readonly ws: string;
  readonly id: string;
}

/** The decoded params of each route. */
export interface SpecRouteParams {
  spec: SpecParams;
  timeline: SpecParams;
  claims: SpecParams;
  tasks: SpecParams;
  evidence: SpecParams;
  /** The file's `path` is a query value: `evidencePathQuery(url.search)`. */
  evidenceFile: SpecParams;
  docs: SpecParams & { readonly name: DocName };
  frames: SpecParams;
  live: SpecParams;
  gateReviewed: SpecParams;
  taskCheck: SpecParams & { readonly tid: string };
}

/** What `matchSpecPath` returns: the route and its params, discriminated by `route`. */
export type SpecRouteMatch = { [R in SpecRouteName]: { readonly route: R; readonly params: SpecRouteParams[R] } }[SpecRouteName];

const enc = encodeURIComponent;
const base = (ws: string, id: string): string => `${SPEC_API_ROOT}/${enc(ws)}/specs/${enc(id)}`;

/** URL builders, one per route. Each segment is percent-encoded once; the result is a path (and query), no origin. */
export const specRoutes = {
  spec: (ws: string, id: string): string => base(ws, id),
  timeline: (ws: string, id: string): string => `${base(ws, id)}/timeline`,
  claims: (ws: string, id: string): string => `${base(ws, id)}/claims`,
  tasks: (ws: string, id: string): string => `${base(ws, id)}/tasks`,
  evidence: (ws: string, id: string): string => `${base(ws, id)}/evidence`,
  /** `path` is relative to the spec folder, as `EvidenceFile.path` gives it (`artifacts/T12-dashboard-model.md`). */
  evidenceFile: (ws: string, id: string, path: string): string => `${base(ws, id)}/evidence/file?path=${enc(path)}`,
  docs: (ws: string, id: string, name: DocName): string => `${base(ws, id)}/docs/${name}`,
  frames: (ws: string, id: string): string => `${base(ws, id)}/frames`,
  live: (ws: string, id: string): string => `${base(ws, id)}/live`,
  gateReviewed: (ws: string, id: string): string => `${base(ws, id)}/gate/reviewed`,
  taskCheck: (ws: string, id: string, tid: string): string => `${base(ws, id)}/tasks/${enc(tid)}/check`,
} as const satisfies Record<SpecRouteName, (...args: never[]) => string>;

export type SpecRouteMethod = 'GET' | 'POST';

export interface SpecRouteEntry {
  readonly route: SpecRouteName;
  /** `GET` routes also answer `HEAD` (same headers, no body). */
  readonly method: SpecRouteMethod;
  /** The path pattern; `:ws`, `:id`, `:name` and `:tid` are params. The evidence file adds the query `?path=`. */
  readonly pattern: string;
  /** Every status the route answers, ascending. */
  readonly statuses: readonly number[];
  /** The 200 body, by type name, for docs and the stub. */
  readonly response: string;
}

/** 200 or 304 by ETag; 403 host or origin guard; 404 unknown workspace or spec; 405 wrong method; 409 unreadable workspace. */
const READ = [200, 304, 403, 404, 405, 409] as const;
/** 200 written; 400 invalid body; 403 guard; 404 unknown workspace, spec or task; 405; 409 hash mismatch or unreadable; 423 locked. */
const WRITE = [200, 400, 403, 404, 405, 409, 423] as const;
const P = `${SPEC_API_ROOT}/:ws/specs/:id`;

/** Every spec route exactly once. The matcher, the server's 405 `Allow`, the stub and the docs iterate it. */
export const SPEC_ROUTE_TABLE: readonly SpecRouteEntry[] = [
  { route: 'spec', method: 'GET', pattern: P, statuses: READ, response: 'SpecPageModel' },
  { route: 'timeline', method: 'GET', pattern: `${P}/timeline`, statuses: READ, response: 'TimelineEntry[]' },
  { route: 'claims', method: 'GET', pattern: `${P}/claims`, statuses: READ, response: 'ClaimViewModel' },
  { route: 'tasks', method: 'GET', pattern: `${P}/tasks`, statuses: READ, response: 'TasksTab | null' },
  { route: 'evidence', method: 'GET', pattern: `${P}/evidence`, statuses: READ, response: 'EvidenceListing' },
  { route: 'evidenceFile', method: 'GET', pattern: `${P}/evidence/file`, statuses: READ, response: 'file bytes' },
  { route: 'docs', method: 'GET', pattern: `${P}/docs/:name`, statuses: READ, response: 'DocsPage' },
  { route: 'frames', method: 'GET', pattern: `${P}/frames`, statuses: READ, response: 'Frame[]' },
  { route: 'live', method: 'GET', pattern: `${P}/live`, statuses: READ, response: 'LiveFrame' },
  { route: 'gateReviewed', method: 'POST', pattern: `${P}/gate/reviewed`, statuses: WRITE, response: 'GateReviewedResponse' },
  { route: 'taskCheck', method: 'POST', pattern: `${P}/tasks/:tid/check`, statuses: WRITE, response: 'TaskCheckResponse' },
];

/** The `Allow` header of a route's 405. */
export function allowFor(route: SpecRouteName): string {
  return SPEC_ROUTE_TABLE.find((entry) => entry.route === route)?.method === 'POST' ? 'POST' : 'GET, HEAD';
}

const COMPILED = SPEC_ROUTE_TABLE.map((entry) => ({ entry, segments: entry.pattern.split('/').slice(1) }));

/**
 * The route a pathname names, whatever the method; null for any other path. Takes `URL.pathname` (still
 * percent-encoded). Each param segment is decoded once; a malformed escape, an empty segment or a doc name outside
 * `DOC_NAMES` is no match.
 */
export function matchSpecPath(pathname: string): SpecRouteMatch | null {
  const parts = pathname.split('/').slice(1);
  for (const { entry, segments } of COMPILED) {
    const params = matchSegments(segments, parts);
    // The pattern names exactly the params of its route (the round-trip test pins it), so the cast only restores the union.
    if (params !== null) return { route: entry.route, params } as unknown as SpecRouteMatch;
  }
  return null;
}

/**
 * The decoded params of a pathname's segments against a pattern's, or null. A literal segment must be equal; a param
 * segment is decoded once, and a malformed escape, an empty segment or a `:name` outside `DOC_NAMES` is no match.
 * Shared by both route families, so a slug decodes the same way in each.
 */
function matchSegments(segments: readonly string[], parts: readonly string[]): Record<string, string> | null {
  if (segments.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (const [i, segment] of segments.entries()) {
    const part = parts[i] ?? '';
    if (!segment.startsWith(':')) {
      if (segment !== part) return null;
      continue;
    }
    const value = decodeOnce(part);
    if (value === null || (segment === ':name' && !(DOC_NAMES as readonly string[]).includes(value))) return null;
    params[segment.slice(1)] = value;
  }
  return params;
}

/** `matchSpecPath` restricted to the route's method (`HEAD` counts as `GET`); null otherwise. */
export function matchSpecRoute(pathname: string, method: string): SpecRouteMatch | null {
  const match = matchSpecPath(pathname);
  if (match === null) return null;
  const wanted = allowFor(match.route) === 'POST' ? ['POST'] : ['GET', 'HEAD'];
  return wanted.includes(method.toUpperCase()) ? match : null;
}

function decodeOnce(segment: string): string | null {
  if (segment === '') return null;
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * The raw, still percent-encoded value of the first `path=` in a query (`URL.search`), or `''` when absent.
 * Deliberately not `URLSearchParams`, which decodes (and turns `+` into a space): `resolveEvidencePath` decodes once,
 * and a second decode here would let `%252e%252e` through as `..`. An absent or empty value is refused by core (403).
 */
export function evidencePathQuery(search: string): string {
  for (const pair of search.replace(/^\?/, '').split('&')) {
    const eq = pair.indexOf('=');
    if ((eq === -1 ? pair : pair.slice(0, eq)) === 'path') return eq === -1 ? '' : pair.slice(eq + 1);
  }
  return '';
}

// ─── Workspace routes ────────────────────────────────────────────────────────────────────────────────────────────

/** The routes that name a whole workspace (spec 003). The dashboard is one too but lives in `api.ts` (header). */
export type WorkspaceRouteName = 'planning';

export interface WorkspaceParams {
  readonly ws: string;
}

/** What `matchWorkspacePath` returns: the route and its decoded slug, discriminated by `route`. */
export type WorkspaceRouteMatch = { [R in WorkspaceRouteName]: { readonly route: R; readonly params: WorkspaceParams } }[WorkspaceRouteName];

/** URL builders, one per workspace route. The slug is percent-encoded once; the result is a path, no origin. */
export const workspaceRoutes = {
  planning: (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}/planning`,
} as const satisfies Record<WorkspaceRouteName, (ws: string) => string>;

/** `SpecRouteEntry` for a workspace route: every one is a read, so `GET` (and `HEAD`) with the read statuses. */
export interface WorkspaceRouteEntry {
  readonly route: WorkspaceRouteName;
  /** `GET` routes also answer `HEAD` (same headers, no body). */
  readonly method: 'GET';
  /** The path pattern; `:ws` is the one param. */
  readonly pattern: string;
  /** 200 or 304 by ETag; 403 host or origin guard; 404 unknown workspace; 405 wrong method; 409 unreadable workspace. */
  readonly statuses: readonly number[];
  /** The 200 body, by type name, for docs and the stub. */
  readonly response: string;
}

/** Every workspace route exactly once. The matcher, the server's 405 `Allow`, the stub and the docs iterate it. */
export const WORKSPACE_ROUTE_TABLE: readonly WorkspaceRouteEntry[] = [
  { route: 'planning', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/planning`, statuses: READ, response: 'PlanningModel' },
];

const WORKSPACE_ENTRIES = new Map(WORKSPACE_ROUTE_TABLE.map((entry) => [entry.route, entry]));

/** The `Allow` header of a workspace route's 405: every one is a read, so `GET, HEAD`. */
export function allowForWorkspace(route: WorkspaceRouteName): string {
  return WORKSPACE_ENTRIES.get(route)?.method === 'GET' ? 'GET, HEAD' : '';
}

const WORKSPACE_COMPILED = WORKSPACE_ROUTE_TABLE.map((entry) => ({ entry, segments: entry.pattern.split('/').slice(1) }));

/**
 * The workspace route a pathname names, whatever the method; null for any other path, every spec route and the
 * dashboard included. Takes `URL.pathname` (still percent-encoded); the slug is decoded once, as `matchSpecPath` does.
 * The server checks the method itself (`GET`/`HEAD`, else 405 with `allowForWorkspace`), so a 405 still finds its route.
 */
export function matchWorkspacePath(pathname: string): WorkspaceRouteMatch | null {
  const parts = pathname.split('/').slice(1);
  for (const { entry, segments } of WORKSPACE_COMPILED) {
    const params = matchSegments(segments, parts);
    if (params === null) continue;
    // Destructured: the web tsconfig forbids dot access on an index signature, root eslint forbids bracket access.
    const { ws = '' } = params;
    return { route: entry.route, params: { ws } };
  }
  return null;
}

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
  /** Null when the spec has no tasks.md (200, not 404: a spec before its tasks stage is still a spec). */
  tasks: TasksTab | null;
  evidence: EvidenceListing;
  /** The file's bytes with `evidenceFileHeaders(mediaTypeOf(name))`. */
  evidenceFile: Blob;
  docs: DocsPage;
  frames: readonly Frame[];
  live: LiveFrame;
  gateReviewed: GateReviewedResponse;
  taskCheck: TaskCheckResponse;
}

export type SpecRouteResponse<R extends SpecRouteName> = SpecRouteResponses[R];

/** The 200 body of each workspace route. Only core types: the golden family's whole file is exactly this. */
export interface WorkspaceRouteResponses {
  planning: PlanningModel;
}

export type WorkspaceRouteResponse<R extends WorkspaceRouteName> = WorkspaceRouteResponses[R];

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
  /** `constitution` at the top level, `plan`, `design` and `decisions` per spec; null means 404 `DocMissing`. */
  docs: 'docs',
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
 * pending writes (`TransitionRefused`, `AllocateRefused`): the file is current, the workflow or the index says no.
 */
export const API_ERRORS = [
  'not-found',
  'forbidden',
  'method-not-allowed',
  'invalid-body',
  'hash-mismatch',
  'locked',
  'transition-refused',
  'allocate-refused',
] as const;
export type ApiError = (typeof API_ERRORS)[number];

/** 404: unknown workspace, spec, doc file or task, or an evidence path that names no file. Never a fallback body. */
export interface NotFound {
  readonly error: 'not-found';
}

/** 404 on `…/docs/:name` when the file does not exist: which doc, and whether the spec's type has it (`docsFor`). */
export interface DocMissing extends NotFound {
  readonly doc: DocName;
  readonly availability: DocAvailability;
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
  | (R extends 'docs' ? DocMissing : never)
  | (R extends 'gateReviewed' ? InvalidBody | Conflict<ReviewedHashes> | Locked : never)
  | (R extends 'taskCheck' ? InvalidBody | Conflict<{ readonly tasks: string }> | Locked : never);

/**
 * The error body a workspace route may send: 404 unknown slug, 403 guard, 405 wrong method, 409 unreadable workspace
 * (the same `Unavailable` summary the dashboard sends). No route of this family writes, so there is nothing else.
 */
export type WorkspaceRouteError = NotFound | Forbidden | MethodNotAllowed | Unavailable;

export function isUnavailable(body: unknown): body is Unavailable {
  return typeof body === 'object' && body !== null && (body as { readable?: unknown }).readable === false;
}

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

const HEX64 = /^[0-9a-f]{64}$/;
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

// ─── Pending routes (spec 008, T81) ──────────────────────────────────────────────────────────────────────────────

/**
 * Routes whose contract stands and whose handler is a later task: the stage move (T82, T83), the story page (T88),
 * its allocation into a spec folder (T86, T87), the actor names (T91) and the remembered board query (T92). The
 * server, the e2e stub and the web client build against these shapes now.
 *
 * Kept out of `SPEC_ROUTE_TABLE` and `WORKSPACE_ROUTE_TABLE` on purpose: both tables drive registration
 * (`spec-routes.ts` dispatches every `matchSpecRoute`, `api.ts` serves every `matchWorkspacePath` as the planning
 * route, the stub and its parity tests iterate both), so an entry there without a handler would be answered by the
 * wrong code. Until its handler lands a pending path is answered as any unknown path: `transition` sits in the spec
 * subtree, whose handler answers 404 `not-found`; every other is declined and gets the server's JSON 404
 * (`tests/spec-routes.contract.test.ts` pins both). The task that lands a handler moves its entry into the
 * registered family (builder, name union, 200 type, error union; the workspace family grows `:slug` and write
 * methods with `allocate`) and deletes it here; `actors` names no workspace and stays a route of its own, as
 * `/api/settings` is.
 */
export type PendingRouteName = 'transition' | 'idea' | 'allocate' | 'actors' | 'boardQuery';

/** The workspace slug and a story's slug, the file name of `specs/ideas/<slug>.md` without `.md`. */
export interface StoryParams extends WorkspaceParams {
  readonly slug: string;
}

export interface PendingRouteParams {
  transition: SpecParams;
  idea: StoryParams;
  allocate: StoryParams;
  actors: Readonly<Record<string, never>>;
  boardQuery: WorkspaceParams;
}

/** What `matchPendingPath` returns: the route and its decoded params, discriminated by `route`. */
export type PendingRouteMatch = {
  [R in PendingRouteName]: { readonly route: R; readonly params: PendingRouteParams[R] };
}[PendingRouteName];

/** The actor names route; it names no workspace. */
export const ACTORS_PATH = `${API_PREFIX}actors`;

/** URL builders, one per pending route. Each segment is percent-encoded once; the result is a path, no origin. */
export const pendingRoutes = {
  transition: (ws: string, id: string): string => `${base(ws, id)}/transition`,
  idea: (ws: string, slug: string): string => `${SPEC_API_ROOT}/${enc(ws)}/ideas/${enc(slug)}`,
  allocate: (ws: string, slug: string): string => `${SPEC_API_ROOT}/${enc(ws)}/ideas/${enc(slug)}/allocate`,
  actors: (): string => ACTORS_PATH,
  boardQuery: (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}/board-query`,
} as const satisfies Record<PendingRouteName, (...args: never[]) => string>;

/** `spec` names `/specs/:id`, `workspace` a whole workspace, `app` the app itself. */
export type PendingRouteFamily = 'spec' | 'workspace' | 'app';
export type PendingRouteMethod = 'GET' | 'POST' | 'PUT';

export interface PendingRouteEntry {
  readonly route: PendingRouteName;
  readonly family: PendingRouteFamily;
  /** In `Allow` order; `GET` also answers `HEAD` (same headers, no body). */
  readonly methods: readonly PendingRouteMethod[];
  /** The path pattern; `:ws`, `:id` and `:slug` are params. */
  readonly pattern: string;
  /** Every status the route answers, ascending. */
  readonly statuses: readonly number[];
  /** The body a `POST` or `PUT` takes, by type name; null for a route that only reads. */
  readonly request: string | null;
  /** The 200 body, by type name. */
  readonly response: string;
}

/**
 * A write the workflow or the index may refuse: `WRITE` plus 422. 404 is the unknown workspace, spec or story; 409 is
 * `hash-mismatch` or the unreadable workspace's `Unavailable`.
 */
const REFUSABLE_WRITE = [200, 400, 403, 404, 405, 409, 422, 423] as const;
/** The app's own state (the database), never a repository file: no 404 slug for actors, no 409 for either. */
const ACTORS_STATUSES = [200, 304, 400, 403, 405] as const;
const BOARD_QUERY_STATUSES = [200, 304, 400, 403, 404, 405] as const;

/** Every pending route exactly once, in plan order. No registration iterates it. */
export const PENDING_ROUTE_TABLE: readonly PendingRouteEntry[] = [
  { route: 'transition', family: 'spec', methods: ['POST'], pattern: `${P}/transition`, statuses: REFUSABLE_WRITE, request: 'TransitionRequest', response: 'TransitionWritten' },
  { route: 'idea', family: 'workspace', methods: ['GET'], pattern: `${SPEC_API_ROOT}/:ws/ideas/:slug`, statuses: READ, request: null, response: 'IdeaPage' },
  { route: 'allocate', family: 'workspace', methods: ['POST'], pattern: `${SPEC_API_ROOT}/:ws/ideas/:slug/allocate`, statuses: REFUSABLE_WRITE, request: 'AllocateRequest', response: 'IdeaAllocated' },
  { route: 'actors', family: 'app', methods: ['GET', 'PUT'], pattern: ACTORS_PATH, statuses: ACTORS_STATUSES, request: 'ActorMapping', response: 'ActorMapping[]' },
  { route: 'boardQuery', family: 'workspace', methods: ['GET', 'PUT'], pattern: `${SPEC_API_ROOT}/:ws/board-query`, statuses: BOARD_QUERY_STATUSES, request: 'BoardQuery', response: 'BoardQuery' },
];

const PENDING_ENTRIES = new Map(PENDING_ROUTE_TABLE.map((entry) => [entry.route, entry]));

/** The `Allow` header of a pending route's 405: its methods, `HEAD` after `GET`. */
export function allowForPending(route: PendingRouteName): string {
  const methods = PENDING_ENTRIES.get(route)?.methods ?? [];
  return methods.flatMap((m) => (m === 'GET' ? ['GET', 'HEAD'] : [m])).join(', ');
}

const PENDING_COMPILED = PENDING_ROUTE_TABLE.map((entry) => ({ entry, segments: entry.pattern.split('/').slice(1) }));

/**
 * The pending route a pathname names, whatever the method; null for any other path, every registered route
 * included. Takes `URL.pathname`; each param is decoded once, by the matcher both registered families share.
 */
export function matchPendingPath(pathname: string): PendingRouteMatch | null {
  const parts = pathname.split('/').slice(1);
  for (const { entry, segments } of PENDING_COMPILED) {
    const params = matchSegments(segments, parts);
    // The pattern names exactly the params of its route (the round-trip test pins it), so the cast only restores the union.
    if (params !== null) return { route: entry.route, params } as unknown as PendingRouteMatch;
  }
  return null;
}

/**
 * Where the client gets `TransitionRequest.hash`: the raw sha256 hex of spec.md on `GET …/:id` (200 and 304), as
 * `TASKS_HASH_HEADER` carries tasks.md's. Raw, not normalised: the transition rewrites `stage:` in the frontmatter,
 * which the normalised gate hash drops. Declared for T83; no route sends it yet.
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

/**
 * 200 of `GET …/ideas/:slug`: the story as the planning tree lists it, its file rendered by `markdown-docs.ts` (the
 * flat frontmatter as written in `page.frontmatter`), and the raw sha256 hex of the file, `allocate`'s `hash`.
 */
export interface IdeaPage {
  readonly idea: IdeaRef;
  readonly page: DocsPage;
  readonly hash: string;
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
 * One person of the actor table (`ActorRow` in `db.ts` without `updatedAt`, pinned by the contract test): the
 * `u:` id, the name the app shows, the git addresses seen for it. `GET /api/actors` answers every row ordered by id;
 * `PUT` takes one and answers the list after the upsert. The handler checks `id` with core's `parseActor`.
 */
export interface ActorMapping {
  readonly id: string;
  readonly displayName: string;
  readonly gitIdentities: readonly string[];
}

/** A workspace's remembered board filter: the board URL's query without `?`, `''` when none is stored. */
export interface BoardQuery {
  readonly query: string;
}

export const BOARD_QUERY_MAX = 2048;

/** The 200 body of each pending route. */
export interface PendingRouteResponses {
  transition: TransitionWritten;
  idea: IdeaPage;
  allocate: IdeaAllocated;
  actors: readonly ActorMapping[];
  boardQuery: BoardQuery;
}

/** The body of each pending route that takes one. */
export interface PendingRouteRequests {
  transition: TransitionRequest;
  allocate: AllocateRequest;
  actors: ActorMapping;
  boardQuery: BoardQuery;
}

/** The 422 codes. */
export const REFUSAL_ERRORS = ['transition-refused', 'allocate-refused'] as const satisfies readonly ApiError[];

/** The error body a pending route may send, by route. */
export type PendingRouteError<R extends PendingRouteName> =
  | Forbidden
  | MethodNotAllowed
  | (R extends 'actors' ? never : NotFound)
  | (R extends 'transition' | 'idea' | 'allocate' ? Unavailable : never)
  | (R extends 'idea' ? never : InvalidBody)
  | (R extends 'transition' ? Conflict<{ readonly spec: string }> | TransitionRefused | Locked : never)
  | (R extends 'allocate' ? Conflict<{ readonly idea: string }> | AllocateRefused | Locked : never);

const isPlainRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const hasOnlyKeys = (v: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(v).every((key) => keys.includes(key));

export function isTransitionRequest(body: unknown): body is TransitionRequest {
  if (!isPlainRecord(body) || !hasOnlyKeys(body, ['to', 'hash'])) return false;
  const { to, hash } = body;
  return typeof to === 'string' && Object.hasOwn(WORKFLOW_STAGES, to) && typeof hash === 'string' && HEX64.test(hash);
}

export function isAllocateRequest(body: unknown): body is AllocateRequest {
  if (!isPlainRecord(body) || !hasOnlyKeys(body, ['hash'])) return false;
  const { hash } = body;
  return typeof hash === 'string' && HEX64.test(hash);
}

export function isActorMapping(body: unknown): body is ActorMapping {
  if (!isPlainRecord(body) || !hasOnlyKeys(body, ['id', 'displayName', 'gitIdentities'])) return false;
  const { id, displayName, gitIdentities } = body;
  return (
    typeof id === 'string' &&
    id !== '' &&
    typeof displayName === 'string' &&
    displayName.trim() !== '' &&
    Array.isArray(gitIdentities) &&
    gitIdentities.every((address) => typeof address === 'string')
  );
}

export function isBoardQuery(body: unknown): body is BoardQuery {
  if (!isPlainRecord(body) || !hasOnlyKeys(body, ['query'])) return false;
  const { query } = body;
  return typeof query === 'string' && query.length <= BOARD_QUERY_MAX && !query.startsWith('?');
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
