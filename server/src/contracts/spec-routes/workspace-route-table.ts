/**
 * The workspace route family (part of `contracts/spec-routes.contract.ts`).
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
 * The library (spec 017, T2, ISC-156; plan 017 § Interfaces): four workspace routes, `library` (the catalog,
 * metadata only), `libraryDoc` (one Markdown document of the catalog as a `DocsPage`), `librarySearch` (title and
 * full text) and `libraryAsset` (one image below `specs/`). The library replaces the tech page's routes `tech` and
 * `techAsset` (T51) and the spec routes `evidence` (the listing) and `docs/:name` (T53); `evidenceFile` stays.
 *
 * The favourites (spec 052, T1, ISC-296; plan 052 § Interfaces): `favorites` reads the favourite specs of a workspace
 * and `favorite` sets (`PUT`) or unsets (`DELETE`) one, both answered from the app database alone, never a
 * repository file. `favorite` is the family's one route whose methods are both writes, so `WorkspaceRouteEntry` takes
 * `PUT` as a `method` and `DELETE` as its `write`.
 */
import type { PlanningModel } from '../../../../core/src/planning.ts';
import type { DocsPage, IdeaRef, LibraryCatalog, LibraryDoc, RepoFileSource } from '../../../../core/src/files.ts';
import type { BoardQuery, Favorites } from './app-state.ts';
import { enc, matchSegments, READ, REFUSABLE_WRITE } from './route-match.ts';
import { SPEC_API_ROOT } from './spec-route-table.ts';
import type {
  AllocateRequest,
  BacklogRequest,
  BacklogWritten,
  IdeaAllocated,
  RunReleased,
  RunReleaseRequest,
} from './write-requests.ts';

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
/**
 * The favourites (spec 052, T1): the database alone, like the board query, so no 409. The read has no body to refuse,
 * so no 400; the set and the unset refuse a spec id outside `NNN-slug` with 400 `invalid-spec` and never answer 304.
 * 404 is the unknown workspace; neither checks whether the spec exists in it (plan 052 § Interfaces).
 */
const FAVORITES_READ = [200, 304, 403, 404, 405] as const;
const FAVORITE_WRITE = [200, 400, 403, 404, 405] as const;

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
  | 'favorites'
  | 'favorite'
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

/** The workspace slug and a spec folder name, `NNN-slug`, as a favourite names it (spec 052, T1). */
export interface FavoriteParams extends WorkspaceParams {
  readonly spec: string;
}

/** The decoded params of each workspace route. */
export interface WorkspaceRouteParams {
  planning: WorkspaceParams;
  idea: StoryParams;
  boardQuery: WorkspaceParams;
  favorites: WorkspaceParams;
  favorite: FavoriteParams;
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
  favorites: (ws: string): string => `${SPEC_API_ROOT}/${enc(ws)}/favorites`,
  /** `spec` is the spec's folder name, `NNN-slug` (`isFavoriteSpec`). */
  favorite: (ws: string, spec: string): string => `${SPEC_API_ROOT}/${enc(ws)}/favorites/${enc(spec)}`,
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
 * are the `POST`s, with the statuses of a refusable write (`backlog` without the 423: it reads no lock). `favorite`
 * (spec 052) is the `PUT` route with `DELETE` as its `write`; it takes no body, the spec id is its path.
 */
export interface WorkspaceRouteEntry {
  readonly route: WorkspaceRouteName;
  /** `GET` routes also answer `HEAD` (same headers, no body). */
  readonly method: 'GET' | 'POST' | 'PUT';
  /**
   * The write method the route answers beside `method`: `PUT` on a GET route, after `HEAD` in `Allow`; `DELETE` on the
   * PUT route, after `PUT`. Absent on a read-only or POST route.
   */
  readonly write?: 'PUT' | 'DELETE';
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
  { route: 'favorites', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/favorites`, statuses: FAVORITES_READ, response: 'Favorites' },
  { route: 'favorite', method: 'PUT', write: 'DELETE', pattern: `${SPEC_API_ROOT}/:ws/favorites/:spec`, statuses: FAVORITE_WRITE, response: 'Favorites' },
  { route: 'allocate', method: 'POST', pattern: `${SPEC_API_ROOT}/:ws/ideas/:slug/allocate`, statuses: REFUSABLE_WRITE, request: 'AllocateRequest', response: 'IdeaAllocated' },
  { route: 'backlog', method: 'POST', pattern: `${SPEC_API_ROOT}/:ws/backlog`, statuses: BACKLOG_WRITE, request: 'BacklogRequest', response: 'BacklogWritten' },
  { route: 'runRelease', method: 'POST', pattern: `${SPEC_API_ROOT}/:ws/runs/:run/release`, statuses: RUN_RELEASE_WRITE, request: 'RunReleaseRequest', response: 'RunReleased' },
  { route: 'library', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/library`, statuses: READ, response: 'LibraryCatalog' },
  { route: 'libraryDoc', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/library/doc`, statuses: READ, response: 'LibraryDocPage' },
  { route: 'librarySearch', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/library/search`, statuses: READ, response: 'LibrarySearchResult' },
  { route: 'libraryAsset', method: 'GET', pattern: `${SPEC_API_ROOT}/:ws/library/asset`, statuses: READ, response: 'file bytes' },
];

const WORKSPACE_ENTRIES = new Map(WORKSPACE_ROUTE_TABLE.map((entry) => [entry.route, entry]));

/**
 * The `Allow` header of a workspace route's 405: `GET, HEAD` for a read (plus its write method if it has one), `POST`
 * for `allocate` and `backlog`, `PUT, DELETE` for `favorite`.
 */
export function allowForWorkspace(route: WorkspaceRouteName): string {
  const entry = WORKSPACE_ENTRIES.get(route);
  if (entry === undefined) return '';
  if (entry.method !== 'GET') return entry.write === undefined ? entry.method : `${entry.method}, ${entry.write}`;
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

// ─── Answers ─────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The 200 body of each workspace route. Only core types, or a record of them (`IdeaPage`); a golden family's whole
 * file is exactly the body (`idea` and `boardQuery` have no family yet).
 */
export interface WorkspaceRouteResponses {
  planning: PlanningModel;
  idea: IdeaPage;
  /** The database's row for the workspace, never a file; `{query: ''}` when none is stored. `PUT` answers the same. */
  boardQuery: BoardQuery;
  /** The database's favourites of the workspace, never a file; `{specs: []}` when none is stored. */
  favorites: Favorites;
  /** The whole set after the write, so the web takes the server's state rather than its own (plan 052). */
  favorite: Favorites;
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
 * `##` heading inside its `<!-- section: key -->` marker, or null without one (spec 017, ISC-157.2). tech.md's page is
 * core's `renderTechDocument`: the markers are gone, each marker's part a `<section data-tech-part="key">` in file
 * order, and the reader cuts its sections at those parts, never at an h2 (spec 057, ISC-355); the heads name the
 * contents entries. Absent on every other document.
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
