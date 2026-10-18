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
 * `002-web-console` or `web-console`; the web uses the dashboard row's `id`, `NNN`), `:tid` a task id (`T12`). Builders percent-encode each segment once; `matchSpecPath` decodes each segment once, so `%2541` arrives
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
 * names a whole workspace, `/api/workspaces/:ws/<route>`, with no `/specs/:id`. It holds `planning`, the
 * planning tree (`PlanningModel`, `core/src/planning.ts`) the Features and Milestones pages and the spec-head
 * breadcrumb read once per workspace, and since spec 008 T88 `idea`, one story of `specs/ideas/` (`IdeaPage`), the
 * family's one route with a second param, `:slug`. It sits beside the spec family, not inside it: `matchSpecPath` requires
 * `/specs/:id` and its params, so folding a slug-only route into `SPEC_ROUTE_TABLE` would change what every spec
 * route's match carries. `workspaceRoutes` builds, `matchWorkspacePath` matches (one segment matcher shared with
 * `matchSpecPath`, so both decode the same way), `WORKSPACE_ROUTE_TABLE` lists, `WorkspaceRouteResponses` types the
 * 200 and `WorkspaceRouteError` every other answer. The dashboard (`/api/workspaces/:ws/dashboard`) is a workspace
 * route too but stays in `api.ts` with its own `DASHBOARD_PATH` and is not listed here: this family answers from the
 * contract alone, and moving the dashboard in would change `api.ts`, which this contract does not own.
 *
 * Pending routes (spec 008, T81; plan 008 § Interfaces "Contract, new routes"): none left. `transition` moved into
 * `SPEC_ROUTE_TABLE` with its handler (T83, `transition-route.ts`), `idea` (T88), `boardQuery` (T92) and `allocate` (T87,
 * the family's one write) into `WORKSPACE_ROUTE_TABLE`; `actors` (T91) is a route of its own, `ACTORS_PATH`, beside
 * `/api/settings`. The pending family went with its last route; the bodies stay in § Spec 008 bodies.
 *
 * The library (spec 017, T2, ISC-156; plan 017 § Interfaces): four workspace routes, `library` (the catalog,
 * metadata only), `libraryDoc` (one Markdown document of the catalog as a `DocsPage`), `librarySearch` (title and
 * full text) and `libraryAsset` (one image below `specs/`). The library replaces the tech page's routes `tech` and
 * `techAsset` (T51) and the spec routes `evidence` (the listing) and `docs/:name` (T53); `evidenceFile` stays.
 * Beside them `prototype`, `/proto/:ws/:spec/:folder/*`, deliberately outside
 * `/api/` so the relative links of a prototype's HTML (`styles.css`, `fonts/…`) resolve without rewriting; it is a
 * family of its own (§ Prototype route), not a workspace route, because its tail is a path of any depth.
 */
import { API_PREFIX } from './assets.contract.ts';
import { FILE_KINDS } from '../../core/src/files.ts';
import type { BacklogEvent } from '../../core/src/backlog.ts';
import type { PlanningModel } from '../../core/src/planning.ts';
import type {
  ClaimLock,
  ClaimViewModel,
  DocsPage,
  EventLine,
  FileKind,
  Frame,
  IdeaRef,
  LibraryCatalog,
  LibraryDoc,
  LiveFrame,
  LockSource,
  RepoFileSource,
  SpecPageModel,
  TasksTab,
  TimelineEntry,
  WorkflowStage,
} from '../../core/src/files.ts';

// ─── Paths ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** The workspace routes' root; equal to `WORKSPACES_PATH` in `api.ts` (pinned by the contract test). */
export const SPEC_API_ROOT = `${API_PREFIX}workspaces`;

export type SpecRouteName =
  | 'spec'
  | 'timeline'
  | 'claims'
  | 'tasks'
  | 'evidenceFile'
  | 'frames'
  | 'live'
  | 'gateReviewed'
  | 'taskCheck'
  | 'transition';

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
  /** The file's `path` is a query value: `evidencePathQuery(url.search)`. */
  evidenceFile: SpecParams;
  frames: SpecParams;
  live: SpecParams;
  gateReviewed: SpecParams;
  taskCheck: SpecParams & { readonly tid: string };
  transition: SpecParams;
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
  /** `path` is relative to the spec folder, as `EvidenceFile.path` gives it (`artifacts/T12-dashboard-model.md`). */
  evidenceFile: (ws: string, id: string, path: string): string => `${base(ws, id)}/evidence/file?path=${enc(path)}`,
  frames: (ws: string, id: string): string => `${base(ws, id)}/frames`,
  live: (ws: string, id: string): string => `${base(ws, id)}/live`,
  gateReviewed: (ws: string, id: string): string => `${base(ws, id)}/gate/reviewed`,
  taskCheck: (ws: string, id: string, tid: string): string => `${base(ws, id)}/tasks/${enc(tid)}/check`,
  transition: (ws: string, id: string): string => `${base(ws, id)}/transition`,
} as const satisfies Record<SpecRouteName, (...args: never[]) => string>;

export type SpecRouteMethod = 'GET' | 'POST';

export interface SpecRouteEntry {
  readonly route: SpecRouteName;
  /** `GET` routes also answer `HEAD` (same headers, no body). */
  readonly method: SpecRouteMethod;
  /** The path pattern; `:ws`, `:id` and `:tid` are params. The evidence file adds the query `?path=`. */
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
/**
 * A write the workflow or the index may refuse: `WRITE` plus 422. 404 is the unknown workspace, spec or story; 409 is
 * `hash-mismatch` or the unreadable workspace's `Unavailable`.
 */
const REFUSABLE_WRITE = [200, 400, 403, 404, 405, 409, 422, 423] as const;
/**
 * The backlog write (spec 036): `REFUSABLE_WRITE` without 423, since it reads no lock source. 404 is the unknown
 * workspace; 409 is `hash-mismatch` or the unreadable workspace's `Unavailable`.
 */
const BACKLOG_WRITE = [200, 400, 403, 404, 405, 409, 422] as const;
/**
 * The run release (spec 040, ISC-226): `BACKLOG_WRITE`'s statuses, since it reads no claim lock and no run locks it.
 * 400 is a missing or malformed `X-Spectant-Activity-Hash`; 404 the unknown workspace, or a run that is unknown or
 * already ended; 409 `hash-mismatch` or the unreadable workspace's `Unavailable`; 422 `release-refused`.
 */
const RUN_RELEASE_WRITE = [200, 400, 403, 404, 405, 409, 422] as const;
/**
 * The app's own state (the database), never a repository file: 400 invalid body, no 409 (spec 008, T91, T92). The
 * board query's 404 is the unknown workspace; the actors route names none.
 */
const BOARD_QUERY_STATUSES = [200, 304, 400, 403, 404, 405] as const;
export const ACTORS_STATUSES = [200, 304, 400, 403, 405] as const;
const P =`${SPEC_API_ROOT}/:ws/specs/:id`;

/** Every spec route exactly once. The matcher, the server's 405 `Allow`, the stub and the docs iterate it. */
export const SPEC_ROUTE_TABLE: readonly SpecRouteEntry[] = [
  { route: 'spec', method: 'GET', pattern: P, statuses: READ, response: 'SpecPageModel' },
  { route: 'timeline', method: 'GET', pattern: `${P}/timeline`, statuses: READ, response: 'TimelineEntry[]' },
  { route: 'claims', method: 'GET', pattern: `${P}/claims`, statuses: READ, response: 'ClaimViewModel' },
  { route: 'tasks', method: 'GET', pattern: `${P}/tasks`, statuses: READ, response: 'TasksTab | null' },
  { route: 'evidenceFile', method: 'GET', pattern: `${P}/evidence/file`, statuses: READ, response: 'file bytes' },
  { route: 'frames', method: 'GET', pattern: `${P}/frames`, statuses: READ, response: 'Frame[]' },
  { route: 'live', method: 'GET', pattern: `${P}/live`, statuses: READ, response: 'LiveFrame' },
  { route: 'gateReviewed', method: 'POST', pattern: `${P}/gate/reviewed`, statuses: WRITE, response: 'GateReviewedResponse' },
  { route: 'taskCheck', method: 'POST', pattern: `${P}/tasks/:tid/check`, statuses: WRITE, response: 'TaskCheckResponse' },
  { route: 'transition', method: 'POST', pattern: `${P}/transition`, statuses: REFUSABLE_WRITE, response: 'TransitionWritten' },
];

/** The `Allow` header of a route's 405. */
export function allowFor(route: SpecRouteName): string {
  return SPEC_ROUTE_TABLE.find((entry) => entry.route === route)?.method === 'POST' ? 'POST' : 'GET, HEAD';
}

const COMPILED = SPEC_ROUTE_TABLE.map((entry) => ({ entry, segments: entry.pattern.split('/').slice(1) }));

/**
 * The route a pathname names, whatever the method; null for any other path. Takes `URL.pathname` (still
 * percent-encoded). Each param segment is decoded once; a malformed escape or an empty segment is no match.
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
 * segment is decoded once, and a malformed escape or an empty segment is no match.
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
    if (value === null) return null;
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

/**
 * The routes that name a whole workspace (spec 003): the planning tree, and one story of `specs/ideas/` (spec 008,
 * T88). The dashboard is one too but lives in `api.ts` (header). The library (spec 017, T2): `library`, `libraryDoc`,
 * `librarySearch` and `libraryAsset` (header), which replaced the tech page's `tech` and `techAsset` (T51).
 */
export type WorkspaceRouteName =
  | 'planning'
  | 'idea'
  | 'boardQuery'
  | 'allocate'
  | 'backlog'
  | 'runRelease'
  | 'library'
  | 'libraryDoc'
  | 'librarySearch'
  | 'libraryAsset';

export interface WorkspaceParams {
  readonly ws: string;
}

/** The workspace slug and a story's slug, the file name of `specs/ideas/<slug>.md` without `.md`. */
export interface StoryParams extends WorkspaceParams {
  readonly slug: string;
}

/** The workspace slug and a run id as `.spectant/activity.jsonl` writes it (spec 040, ISC-226). */
export interface RunParams extends WorkspaceParams {
  readonly run: string;
}

/** The decoded params of each workspace route. */
export interface WorkspaceRouteParams {
  planning: WorkspaceParams;
  idea: StoryParams;
  boardQuery: WorkspaceParams;
  allocate: StoryParams;
  backlog: WorkspaceParams;
  runRelease: RunParams;
  library: WorkspaceParams;
  /** The document's `path` is a query value, `LibraryDoc.path` (relative to `specs/`): `evidencePathQuery(url.search)`. */
  libraryDoc: WorkspaceParams;
  /** The search text `q` is a query value, read with `URLSearchParams` (it names no file, so no once-decode rule). */
  librarySearch: WorkspaceParams;
  /** The image's `path` is a query value, relative to `specs/`: `evidencePathQuery(url.search)`. */
  libraryAsset: WorkspaceParams;
}

/** What `matchWorkspacePath` returns: the route and its decoded params, discriminated by `route`. */
export type WorkspaceRouteMatch = {
  [R in WorkspaceRouteName]: { readonly route: R; readonly params: WorkspaceRouteParams[R] };
}[WorkspaceRouteName];

/** URL builders, one per workspace route. Each segment is percent-encoded once; the result is a path, no origin. */
export const workspaceRoutes = {
  planning: (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}/planning`,
  idea: (ws: string, slug: string): string => `${SPEC_API_ROOT}/${enc(ws)}/ideas/${enc(slug)}`,
  boardQuery: (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}/board-query`,
  allocate: (ws: string, slug: string): string => `${SPEC_API_ROOT}/${enc(ws)}/ideas/${enc(slug)}/allocate`,
  backlog: (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}/backlog`,
  runRelease: (ws: string, run: string): string => `${SPEC_API_ROOT}/${enc(ws)}/runs/${enc(run)}/release`,
  library: (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}/library`,
  /** `path` is a catalog document's `LibraryDoc.path` (`017-workspace-library/plan.md`, `tech.md`); it travels raw. */
  libraryDoc: (ws: string, path: string): string => `${SPEC_API_ROOT}/${enc(ws)}/library/doc?path=${enc(path)}`,
  librarySearch: (ws: string, q: string): string => `${SPEC_API_ROOT}/${enc(ws)}/library/search?q=${enc(q)}`,
  /** `path` is relative to `specs/`, as a workspace document names the image (`.tech/architecture.png`); it travels raw like the evidence file's. */
  libraryAsset: (ws: string, path: string): string => `${SPEC_API_ROOT}/${enc(ws)}/library/asset?path=${enc(path)}`,
} as const satisfies Record<WorkspaceRouteName, (...args: never[]) => string>;

/**
 * `SpecRouteEntry` for a workspace route: the reads are `GET` (and `HEAD`) with the read statuses; the board query
 * (T92) also takes a `PUT` (`write`, `request`) and answers its own statuses; `allocate` (T87) and `backlog` (spec 036)
 * are the `POST`s, with the statuses of a refusable write (`backlog` without the 423: it reads no lock).
 */
export interface WorkspaceRouteEntry {
  readonly route: WorkspaceRouteName;
  /** `GET` routes also answer `HEAD` (same headers, no body). */
  readonly method: 'GET' | 'POST';
  /** The write method a GET route answers beside `GET`, after `HEAD` in `Allow`; absent on a read-only or POST route. */
  readonly write?: 'PUT';
  /** The body the write takes, by type name; absent on a read-only route. */
  readonly request?: string;
  /** The path pattern; `:ws` is a param of every route, `:slug` of `idea`. */
  readonly pattern: string;
  /**
   * 200 or 304 by ETag; 403 host or origin guard; 404 unknown workspace (and, for `idea`, unknown story); 405 wrong
   * method; 409 unreadable workspace.
   */
  readonly statuses: readonly number[];
  /** The 200 body, by type name, for docs and the stub. */
  readonly response: string;
}

/** Every workspace route exactly once. The matcher, the server's 405 `Allow`, the stub and the docs iterate it. */
export const WORKSPACE_ROUTE_TABLE: readonly WorkspaceRouteEntry[] = [
  { route: 'planning', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/planning`, statuses: READ, response: 'PlanningModel' },
  { route: 'idea', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/ideas/:slug`, statuses: READ, response: 'IdeaPage' },
  { route: 'boardQuery', method: 'GET', write: 'PUT', pattern: `${SPEC_API_ROOT}/:ws/board-query`, statuses: BOARD_QUERY_STATUSES, request: 'BoardQuery', response: 'BoardQuery' },
  { route: 'allocate', method: 'POST', pattern: `${SPEC_API_ROOT}/:ws/ideas/:slug/allocate`, statuses: REFUSABLE_WRITE, request: 'AllocateRequest', response: 'IdeaAllocated' },
  { route: 'backlog', method: 'POST', pattern: `${SPEC_API_ROOT}/:ws/backlog`, statuses: BACKLOG_WRITE, request: 'BacklogRequest', response: 'BacklogWritten' },
  { route: 'runRelease', method: 'POST', pattern: `${SPEC_API_ROOT}/:ws/runs/:run/release`, statuses: RUN_RELEASE_WRITE, request: 'RunReleaseRequest', response: 'RunReleased' },
  { route: 'library', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/library`, statuses: READ, response: 'LibraryCatalog' },
  { route: 'libraryDoc', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/library/doc`, statuses: READ, response: 'LibraryDocPage' },
  { route: 'librarySearch', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/library/search`, statuses: READ, response: 'LibrarySearchResult' },
  { route: 'libraryAsset', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/library/asset`, statuses: READ, response: 'file bytes' },
];

const WORKSPACE_ENTRIES = new Map(WORKSPACE_ROUTE_TABLE.map((entry) => [entry.route, entry]));

/** The `Allow` header of a workspace route's 405: `GET, HEAD` for a read (plus its write method if it has one), `POST` for `allocate` and `backlog`. */
export function allowForWorkspace(route: WorkspaceRouteName): string {
  const entry = WORKSPACE_ENTRIES.get(route);
  if (entry === undefined) return '';
  if (entry.method !== 'GET') return entry.method;
  return entry.write === undefined ? 'GET, HEAD' : `GET, HEAD, ${entry.write}`;
}

const WORKSPACE_COMPILED = WORKSPACE_ROUTE_TABLE.map((entry) => ({ entry, segments: entry.pattern.split('/').slice(1) }));

/**
 * The workspace route a pathname names, whatever the method; null for any other path, every spec route and the
 * dashboard included. Takes `URL.pathname` (still percent-encoded); each param is decoded once, as `matchSpecPath`
 * does. The server checks the method itself (`GET`/`HEAD`, else 405 with `allowForWorkspace`), so a 405 still finds
 * its route.
 */
export function matchWorkspacePath(pathname: string): WorkspaceRouteMatch | null {
  const parts = pathname.split('/').slice(1);
  for (const { entry, segments } of WORKSPACE_COMPILED) {
    const params = matchSegments(segments, parts);
    // The pattern names exactly the params of its route (the round-trip test pins it), so the cast only restores the union.
    if (params !== null) return { route: entry.route, params } as unknown as WorkspaceRouteMatch;
  }
  return null;
}

// ─── Prototype route (spec 017) ──────────────────────────────────────────────────────────────────────────────────

/**
 * The prototype route (spec 017, ISC-159): `GET`/`HEAD /proto/:ws/:spec/:folder/*` serves one file of a `prototype`
 * catalog document, outside `/api/` so a page's relative links resolve against the folder without rewriting.
 *
 * - `:ws` the workspace slug, `:spec` the spec folder (`LibraryDoc.spec`, `NNN-slug`), each decoded once.
 * - `:folder` the prototype's folder relative to the spec's `.design/`, decoded once from one segment: `prototype` for
 *   a prototype in `.design/prototype/` itself, `prototype/board` (sent as `prototype%2Fboard`) for one below it
 *   (`prototypeFolderOf`). Relative to `.design/` rather than `.design/prototype/` so the root folder has a name.
 *   Anything not `prototype` or below it is no match.
 * - `*` the file below the folder (`LibraryDoc.pages` entries, or what a page links), passed on raw like
 *   `evidencePathQuery`: core's resolver decodes it exactly once and refuses a second layer, `..`, an absolute path and
 *   a symlink out (ISC-159.1).
 *
 * Every answer carries `PROTOTYPE_CSP` (ISC-159.2). The route is no workspace route: its tail is a path of any depth,
 * which `matchSegments` does not match, and it sits outside `SPEC_API_ROOT`.
 */
export const PROTOTYPE_PREFIX = '/proto/';

/** The prototype root below a spec's `.design/`; every `:folder` is this or below it. */
export const PROTOTYPE_FOLDER_ROOT = 'prototype';

/** The decoded `ws`, `spec` and `folder`, and the still percent-encoded `file` (segments joined by `/`). */
export interface PrototypeParams {
  readonly ws: string;
  readonly spec: string;
  readonly folder: string;
  readonly file: string;
}

export interface PrototypeRouteMatch {
  readonly route: 'prototype';
  readonly params: PrototypeParams;
}

/**
 * The URL of one file of a prototype. `folder` as `prototypeFolderOf` gives it, `file` relative to the folder
 * (`index.html`, `pages/two.html`); each of its segments is encoded once, the slashes kept, so the page's relative
 * links resolve. A path, no origin.
 */
export function prototypeRoute(ws: string, spec: string, folder: string, file: string): string {
  return `${PROTOTYPE_PREFIX}${enc(ws)}/${enc(spec)}/${enc(folder)}/${file.split('/').map(enc).join('/')}`;
}

/**
 * The `:folder` of a `prototype` catalog document (`doc.path` minus `<spec>/.design/`, or minus
 * `archive/<spec>/.design/` for an archived one, ISC-187.1); null for any other path.
 */
export function prototypeFolderOf(doc: Pick<LibraryDoc, 'path' | 'spec' | 'archived'>): string | null {
  const head = `${doc.archived === true ? 'archive/' : ''}${doc.spec}/.design/`;
  if (!doc.path.startsWith(head)) return null;
  const folder = doc.path.slice(head.length);
  return isPrototypeFolder(folder) ? folder : null;
}

function isPrototypeFolder(folder: string): boolean {
  return folder === PROTOTYPE_FOLDER_ROOT || folder.startsWith(`${PROTOTYPE_FOLDER_ROOT}/`);
}

/** 200 or 304 by ETag; 403 host guard or a refused path; 404 unknown workspace, spec or file; 405; 409 unreadable workspace. */
export const PROTOTYPE_ROUTE = {
  route: 'prototype',
  method: 'GET',
  pattern: `${PROTOTYPE_PREFIX}:ws/:spec/:folder/*`,
  statuses: READ,
  response: 'file bytes',
} as const;

export const PROTOTYPE_ALLOW = 'GET, HEAD';

/**
 * The Content-Security-Policy of every prototype answer (plan 017 § Risks): the page's own files and inline code
 * only, no fetch, and a sandbox without `allow-same-origin`, so the page runs on an opaque origin and cannot call the
 * app's API.
 */
export const PROTOTYPE_CSP = "default-src 'self' 'unsafe-inline' data: blob:; connect-src 'none'; sandbox allow-scripts allow-popups";

/**
 * The prototype route a pathname names, whatever the method; null for any other path. Takes `URL.pathname` (still
 * percent-encoded). `ws`, `spec` and `folder` are decoded once (a malformed escape or an empty segment is no match,
 * a folder outside `prototype` too); the tail needs at least one segment and is returned raw. The server checks the
 * method itself (405 with `PROTOTYPE_ALLOW`).
 */
export function matchPrototypePath(pathname: string): PrototypeRouteMatch | null {
  if (!pathname.startsWith(PROTOTYPE_PREFIX)) return null;
  const parts = pathname.slice(PROTOTYPE_PREFIX.length).split('/');
  if (parts.length < 4) return null;
  const [ws, spec, folder] = parts.slice(0, 3).map(decodeOnce);
  const file = parts.slice(3).join('/');
  if (ws == null || spec == null || folder == null || file === '' || !isPrototypeFolder(folder)) return null;
  return { route: 'prototype', params: { ws, spec, folder, file } };
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
  /** The file's bytes with `evidenceFileHeaders(mediaTypeOf(name))`. */
  evidenceFile: Blob;
  frames: readonly Frame[];
  live: LiveFrame;
  gateReviewed: GateReviewedResponse;
  taskCheck: TaskCheckResponse;
  transition: TransitionWritten;
}

export type SpecRouteResponse<R extends SpecRouteName> = SpecRouteResponses[R];

/**
 * The 200 body of each workspace route. Only core types, or a record of them (`IdeaPage`); a golden family's whole
 * file is exactly the body (`idea` and `boardQuery` have no family yet).
 */
export interface WorkspaceRouteResponses {
  planning: PlanningModel;
  idea: IdeaPage;
  /** The database's row for the workspace, never a file; `{query: ''}` when none is stored. `PUT` answers the same. */
  boardQuery: BoardQuery;
  allocate: IdeaAllocated;
  backlog: BacklogWritten;
  runRelease: RunReleased;
  /** core's `readCatalog` over the workspace, as it is: metadata only, never a document's content. */
  library: LibraryCatalog;
  /**
   * One Markdown document of the catalog (`media: 'markdown'`, `state` not `missing`), rendered by `markdown-docs.ts`
   * as the former Docs tabs rendered it. A path the catalog does not list as such a document is 404, never a read of the path.
   */
  libraryDoc: LibraryDocPage;
  librarySearch: LibrarySearchResult;
  /** The image's bytes with `evidenceFileHeaders(mediaTypeOf(name))`, as the evidence file route sends them; `specs/` the root, images only. */
  libraryAsset: Blob;
}

/**
 * 200 of `GET …/library/doc?path=`: the document's `DocsPage`, and for `tech.md` (the catalog's `type: 'tech'`) alone
 * `techSections`, core's `techSectionHeads` over the same text: each of the four keys in contract order with the first
 * `##` heading inside its `<!-- section: key -->` marker, or null without one (spec 017, ISC-157.2). The rendered page
 * no longer carries the markers, so the reader selects its sections by these heads (each names a level-2 entry of the
 * page's `toc`) and never re-derives them from heading names. Absent on every other document.
 *
 * `LibraryTechSection` is core's `TechSectionHead` written out, because the web's stricter compile cannot walk
 * `core/src/tech.ts`'s imports; `tests/spec-routes.contract.test.ts` pins the two equal, so it is core's type all the same.
 */
export interface LibraryTechSection {
  readonly key: 'overview' | 'stack' | 'architecture' | 'risks';
  readonly heading: string | null;
}
export type LibraryDocPage = DocsPage & { readonly techSections?: readonly LibraryTechSection[] };

/**
 * One search hit: the catalog document it names (`LibraryDoc.path`, so the web finds the entry in the catalog it holds)
 * and a snippet of plain text around the first match, in the title or the full text. Plain text, never HTML: the web
 * marks the match itself.
 */
export interface LibrarySearchHit {
  readonly path: LibraryDoc['path'];
  readonly snippet: string;
}

/**
 * 200 of `GET …/library/search?q=`: the search text as the server read it (trimmed), so the web drops an answer to a
 * query it has moved past, and the hits over the catalog's Markdown documents in catalog order. An empty or
 * whitespace-only `q` answers `{query: '', hits: []}`, not 400.
 */
export interface LibrarySearchResult {
  readonly query: string;
  readonly hits: readonly LibrarySearchHit[];
}

/** The body of each workspace route that takes one (`WorkspaceRouteEntry.write` or a POST route). */
export interface WorkspaceRouteRequests {
  boardQuery: BoardQuery;
  allocate: AllocateRequest;
  backlog: BacklogRequest;
  runRelease: RunReleaseRequest;
}

/**
 * 200 of `GET …/ideas/:slug`: the story as the planning tree lists it (`readIdeas`), its file rendered by
 * `markdown-docs.ts` (the flat frontmatter as written in `page.frontmatter`), and the raw sha256 hex of the file's
 * bytes, `allocate`'s `hash`. All three come from one read of the file.
 */
export interface IdeaPage {
  readonly idea: IdeaRef;
  readonly page: DocsPage;
  readonly hash: string;
  /** The spec worktree the story was read from (spec 039, ISC-209); absent when read from the main checkout. */
  readonly source?: RepoFileSource;
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
  'hash-mismatch',
  'locked',
  'run-locked',
  'transition-refused',
  'allocate-refused',
  'backlog-refused',
  'release-refused',
] as const;
export type ApiError = (typeof API_ERRORS)[number];

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
 * its `PUT` adds 400 `invalid-body`. The allocation (T87) adds its write answers: 400, the 409 `hash-mismatch` of the
 * story, the 422 `allocate-refused` and the 423 the contract keeps (unreachable for a story, `writes.ts` `writeAllocate`).
 * Without a route named, the union of the file reads.
 */
export type WorkspaceRouteError<R extends WorkspaceRouteName = 'planning' | 'idea'> =
  | NotFound
  | Forbidden
  | MethodNotAllowed
  | ([R] extends ['boardQuery'] ? InvalidBody : Unavailable)
  | ([R] extends ['allocate'] ? InvalidBody | Conflict<{ readonly idea: string }> | AllocateRefused | Locked : never)
  | ([R] extends ['backlog'] ? InvalidBody | Conflict<{ readonly backlog: string }> | BacklogRefused : never)
  | ([R] extends ['runRelease'] ? InvalidBody | Conflict<{ readonly activity: string }> | RunReleaseRefused : never);

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
/**
 * The raw sha256 hex of `.spectant/activity.jsonl` (spec 040, ISC-226), the empty text's without the file: sent on
 * `GET /api/workspaces/:ws/dashboard`, the answer whose items show a run, and sent back on the run release.
 */
export const ACTIVITY_HASH_HEADER = 'X-Spectant-Activity-Hash';

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

// ─── Spec 008 bodies (T81) ───────────────────────────────────────────────────────────────────────────────────────

/**
 * The bodies of spec 008's writes and resources, declared ahead of their handlers (T81) and shared by the server, the
 * e2e stub and the web client; every route is registered now (`transition` in `SPEC_ROUTE_TABLE`, `idea`, `boardQuery`
 * and `allocate` in `WORKSPACE_ROUTE_TABLE`, the actor names at `ACTORS_PATH`).
 */

/**
 * The actor names route (T91, ISC-119.2); it names no workspace and is no family's: `GET`/`HEAD` answer every stored
 * `ActorMapping` ordered by id (ETag, 304), `PUT` replaces the whole mapping with an array `isActorMappings` admits.
 * Statuses `ACTORS_STATUSES`, errors `ActorsError`, 405 with `ACTORS_ALLOW`.
 */
export const ACTORS_PATH = `${API_PREFIX}actors`;
export const ACTORS_ALLOW = 'GET, HEAD, PUT';

// ─── Live update stream ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * The live update stream (spec 030, ISC-28; plan 030 § Interfaces); it names no workspace and is no family's, like
 * `ACTORS_PATH`. `GET` answers `text/event-stream` and stays open: when a watched file of a registered repository
 * changes (`specs/`, `ISA.md`, `.spectant/`, in the checkout and in each spec worktree), one `LIVE_EVENT` frame carries
 * the read routes it touched as a `LiveUpdate`, and a comment line keeps the connection alive in between. 403 is a
 * foreign `Host` or `Origin`, 405 any other method with `EVENTS_ALLOW`.
 */
export const EVENTS_PATH = `${API_PREFIX}events`;
export const EVENTS_ALLOW = 'GET';
export const EVENTS_STATUSES = [200, 403, 405] as const;
/** The SSE `event:` name of a `LiveUpdate` frame. */
export const LIVE_EVENT = 'update';

/**
 * One read route's answer as a poll would get it: `path` is the request path (`/api/workspaces`,
 * `/api/workspaces/:ws/dashboard`, `…/planning`, `…/specs/:id`), `etag` and `body` are byte for byte the `ETag`
 * header and the parsed JSON body of a `GET` on it.
 */
export interface LiveView {
  readonly path: string;
  readonly etag: string;
  readonly body: unknown;
}

/** One frame of the stream: the workspace whose files changed and the read routes that changed with them. */
export interface LiveUpdate {
  readonly ws: string;
  readonly views: readonly LiveView[];
}

/** A parsed `LIVE_EVENT` payload; anything else is dropped by the client. */
export function isLiveUpdate(body: unknown): body is LiveUpdate {
  if (!isPlainRecord(body) || !hasOnlyKeys(body, ['ws', 'views'])) return false;
  const { ws, views } = body;
  return typeof ws === 'string' && Array.isArray(views) && views.every((view: unknown) => isLiveView(view));
}

function isLiveView(view: unknown): view is LiveView {
  if (!isPlainRecord(view) || !hasOnlyKeys(view, ['path', 'etag', 'body'])) return false;
  const { path, etag } = view;
  return typeof path === 'string' && path.startsWith(API_PREFIX) && typeof etag === 'string' && 'body' in view;
}

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

/**
 * One person of the actor table (`ActorRow` in `db.ts` without `updatedAt`, pinned by the contract test): the
 * `u:` id, the name the app shows, the git addresses seen for it. `GET /api/actors` answers every row ordered by id;
 * `PUT` takes the whole list (`isActorMappings`), replaces the table with it and answers the list as stored. The
 * handler checks each `id` with core's `parseActor`: only a person (`u:` + eight hex) has a row.
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

/** The actor names route's 200 body (`GET` and `PUT`) and its `PUT` body: the whole mapping. */
export type ActorsResponse = readonly ActorMapping[];
export type ActorsRequest = readonly ActorMapping[];

/** The error body the actor names route may send: no workspace, so no 404 slug, and no file, so no 409. */
export type ActorsError = Forbidden | MethodNotAllowed | InvalidBody;

/** The 422 codes. */
export const REFUSAL_ERRORS = ['transition-refused', 'allocate-refused', 'backlog-refused', 'release-refused'] as const satisfies readonly ApiError[];

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

/** A feature id as a feature heading names it: `F8`, `F1.1`. */
const FEATURE_ID = /^F\d+(?:\.\d+)?$/;
const isFeatureId = (v: unknown): v is string => typeof v === 'string' && FEATURE_ID.test(v);

export function isBacklogRequest(body: unknown): body is BacklogRequest {
  if (!isPlainRecord(body)) return false;
  const { op, feature, hash, before, priority } = body;
  if (!isFeatureId(feature) || typeof hash !== 'string' || !HEX64.test(hash)) return false;
  if (op === 'move') return hasOnlyKeys(body, ['op', 'feature', 'before', 'hash']) && (before === null || isFeatureId(before));
  if (op === 'priority') return hasOnlyKeys(body, ['op', 'feature', 'priority', 'hash']) && typeof priority === 'string';
  return false;
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

/** The `PUT /api/actors` body: an array of `ActorMapping`s, each id once. The handler adds the person-id check. */
export function isActorMappings(body: unknown): body is ActorsRequest {
  if (!Array.isArray(body) || !body.every((entry) => isActorMapping(entry))) return false;
  return new Set(body.map((entry: ActorMapping) => entry.id)).size === body.length;
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
