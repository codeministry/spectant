import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { ClaimLock, LibraryCatalog, LibraryDoc } from '../../../../core/src/files';
import {
  ACTIVITY_HASH_HEADER,
  ACTORS_PATH,
  type ActorMapping,
  type ActorsRequest,
  type AllocateRequest,
  type BacklogRequest,
  type BoardQuery,
  type Favorites,
  type IdeaPage,
  type LibrarySearchResult,
  prototypeFolderOf,
  prototypeRoute,
  isActorMappings,
  isBoardQuery,
  isFavorites,
  SPEC_HASH_HEADER,
  type TransitionRequest,
  type GateReviewedRequest,
  type GateReviewedResponse,
  isUnavailable,
  type Locked,
  parseReviewedHashes,
  REVIEWED_HASHES_HEADER,
  type ReviewedHashes,
  SPEC_API_ROOT,
  specRoutes,
  type Conflict,
  type SpecRouteResponses,
  type TaskCheckRequest,
  type TaskCheckResponse,
  TASKS_HASH_HEADER,
  type Unavailable,
  workspaceRoutes,
  type WorkspaceRouteResponses,
  type LibraryDocPage,
} from '../../../../server/src/spec-routes.contract';
import { type RunLocked, type WriteAnswer, writeAnswerOf, type WriteOperation } from '../../../../server/src/writes.contract';
import type { Priority, WorkflowStage } from '../../../../core/src/files';
import { type Note, type NoteCounts, type NoteDraft, type NotesQuery, noteRoutes } from '../../../../server/src/notes.contract';
import {
  type AddWorkspaceRequest,
  type ImageKind,
  type RenameWorkspaceRequest,
  type WorkspaceAdminErrors,
  type WorkspaceAdminResponses,
  type WorkspaceAdminRouteName,
  workspaceAdminRoutes,
  type WorkspaceSummaryAdded,
} from '../../../../server/src/workspace-admin.contract';

/** The admin writes of spec 016 (every route of the workspace admin contract but the image read). */
export type WorkspaceAdminWrite = Exclude<WorkspaceAdminRouteName, 'getImage'>;

/**
 * What an admin write answers (spec 016, T13, ISC-303), never a thrown exception:
 *
 * - `ok`: the route's 2xx body (`WorkspaceAdminResponses`; `null` for the 204 of `remove`).
 * - `refused`: a 4xx whose body is one of the route's contract errors (`WorkspaceAdminErrors`), by its kebab-case code;
 *   `duplicate-path` only with the existing entry's `slug`. The page maps the code to its inline text.
 * - `error`: anything else (a 5xx, a body that fits no contract error), status 0 when no answer came.
 */
export type WorkspaceAdminResult<R extends WorkspaceAdminWrite> =
  | { readonly kind: 'ok'; readonly body: WorkspaceAdminResponses[R] }
  | { readonly kind: 'refused'; readonly status: number; readonly body: WorkspaceAdminErrors[R] }
  | { readonly kind: 'error'; readonly status: number };

/** A 4xx body the contract names: an object with a string `error`, and `duplicate-path` with its `slug`. */
const isAdminRefusal = (status: number, body: unknown): boolean => {
  if (status < 400 || status >= 500 || typeof body !== 'object' || body === null) return false;
  const { error, slug } = body as { readonly error?: unknown; readonly slug?: unknown };
  if (typeof error !== 'string') return false;
  return error !== 'duplicate-path' || typeof slug === 'string';
};

/**
 * What a spec 008 write answers (T111, ISC-130), never a thrown exception: the contract's `WriteAnswer` when the body
 * fits its status (`writeAnswerOf`, the one validator the server's tests pin too), else `error` with the status: a
 * 403, 404 or 405 of the route layer, a body that does not fit (a 200 included), 0 when no answer came.
 */
/** A backlog write without its hash (spec 036): move a feature in front of `before` (null: to its group's end), or set its priority. */
export type BacklogOp =
  | { readonly op: 'move'; readonly feature: string; readonly before: string | null }
  | { readonly op: 'priority'; readonly feature: string; readonly priority: Priority };

export type WriteResult<R extends WriteOperation> =
  | { readonly kind: 'answer'; readonly answer: WriteAnswer<R> }
  | (R extends RunLockedWrite ? { readonly kind: 'run-locked'; readonly body: RunLocked } : never)
  | { readonly kind: 'error'; readonly status: number };

/**
 * The writes a running run on their item refuses with 423 `run-locked` (spec 040, T56, ISC-225.1): the stage move and
 * the allocation. The backlog write belongs to no item and the run release reads no run lock; neither answers it. `WriteAnswer` keeps its 423 arm for the
 * claim lock (`Locked`, read as `body.lock`); the run's 423 is its own result kind, so no caller takes one for the
 * other.
 */
export type RunLockedWrite = Exclude<WriteOperation, 'backlog' | 'runRelease'>;

/** The 423 body of a running run (`RunLocked`, `runLockedOf` in the writes contract): the run, its command, actor and start. */
export const isRunLocked = (body: unknown): body is RunLocked => {
  if (typeof body !== 'object' || body === null) return false;
  const b = body as Partial<Record<keyof RunLocked, unknown>>;
  const actor = b.actor as { readonly id?: unknown; readonly raw?: unknown } | null | undefined;
  return (
    b.error === 'run-locked' &&
    typeof b.run === 'string' &&
    (b.command === null || typeof b.command === 'string') &&
    typeof b.since === 'string' &&
    typeof actor === 'object' &&
    actor !== null &&
    typeof actor.id === 'string' &&
    typeof actor.raw === 'string'
  );
};

/**
 * What a `PUT` of a stored setting answers (the actor names, the board query): the body as stored when it fits the
 * contract's validator, else `error` with the status and the contract's code (`invalid-body`, `not-found`), status 0
 * when no answer came.
 */
export type PutResult<T> =
  | { readonly kind: 'ok'; readonly body: T }
  | { readonly kind: 'error'; readonly status: number; readonly error: string | null };

/**
 * What a notes write answers (T100, ISC-95), never a thrown exception: the saved note (`POST` 201, `PUT` 200), or the
 * status of anything else (400 with the contract's code, 404 for an unknown note or workspace), 0 when no answer came.
 */
export type NoteWriteResult =
  | { readonly kind: 'ok'; readonly note: Note }
  | { readonly kind: 'error'; readonly status: number; readonly error: string | null };

/** What `DELETE …/notes/:id` answers: 204 is `ok`. */
export type NoteDeleteResult = { readonly kind: 'ok' } | { readonly kind: 'error'; readonly status: number };

const noteError = (failure: unknown): { readonly kind: 'error'; readonly status: number; readonly error: string | null } => {
  if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0, error: null };
  const body: unknown = failure.error;
  const code = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
  return { kind: 'error', status: failure.status, error: typeof code === 'string' ? code : null };
};

/** What the gate write answers (T54, ISC-85): never a thrown exception, the gate dialog branches on `kind`. */
export type GateWriteResult =
  | { readonly kind: 'ok'; readonly body: GateReviewedResponse }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'locked'; readonly lock: ClaimLock }
  | { readonly kind: 'error'; readonly status: number };

const isContractError = (body: unknown, error: string): boolean =>
  typeof body === 'object' && body !== null && (body as { error?: unknown }).error === error;

/**
 * One entry of `GET /api/workspaces`: the browser-side copy of `WorkspaceSummary` in `server/src/api.ts`. Duplicated
 * on purpose, as `Settings` is: that module imports the server's HTTP layer and `bun:sqlite`, which must not reach the
 * browser bundle. `counts` is core's `DashboardKpis`; typed `unknown` until the dashboard types move to a browser-safe
 * module (see `DashboardBody`).
 */
export interface WorkspaceListEntry extends Partial<WorkspaceSummaryAdded> {
  readonly slug: string;
  readonly name: string;
  readonly pathTail: string;
  readonly readable: boolean;
  readonly error?: string;
  readonly counts: unknown;
}

/**
 * What a read answers, never a thrown exception: a template branches on `kind`.
 *
 * - `ok`: 200, or 304 answered from the ETag cache (`notModified`).
 * - `not-found`: 404. `served` tells the contract's `{error: "not-found"}` (an unknown workspace, spec or doc: the
 *   answer is authoritative, the page shows "not found", ISC-71) from the server's catch-all `{error: "not found"}`
 *   for a path no route answers yet (a spec route before T45 lands: the page renders its placeholder).
 * - `unavailable`: 409 with the workspace's own summary; its directory cannot be read.
 * - `error`: anything else, status 0 when the request never got an answer.
 */
/**
 * The dashboard body, `DashboardModel` of `core/src/dashboard.ts`. Not imported yet: a type import type-checks that
 * module's whole value graph under the web tsconfig, and `core/src/gates.ts` uses Node's `Buffer` and index-signature
 * dot access, which `tsconfig.app.json` rejects. Needs `DashboardModel` in a pure types module in core (core lane).
 * `PlanningBody` below is the counter-example: its graph is web-clean, so it is typed.
 */
export type DashboardBody = unknown;

/**
 * The planning body, `PlanningModel` of `core/src/planning.ts`, through the contract's `WorkspaceRouteResponses`. Unlike
 * `DashboardBody` it is typed: its type graph is web-clean (the types it needs live in pure types modules, T18), which
 * `bun run --cwd web typecheck` proves.
 */
export type PlanningBody = WorkspaceRouteResponses['planning'];

export type ApiResult<T> =
  | { readonly kind: 'ok'; readonly body: T; readonly etag: string | null; readonly notModified: boolean }
  | { readonly kind: 'not-found'; readonly served: boolean }
  | { readonly kind: 'unavailable'; readonly body: Unavailable }
  | { readonly kind: 'error'; readonly status: number };

/** The Tasks tab's read (T57): an `ok` carries tasks.md's raw hash, which the checkbox write (T68) sends back. */
export type TasksResult =
  | (Extract<ApiResult<SpecRouteResponses['tasks']>, { readonly kind: 'ok' }> & { readonly hash: string | null })
  | Exclude<ApiResult<SpecRouteResponses['tasks']>, { readonly kind: 'ok' }>;

/**
 * The 200 of the checkbox write: `TaskCheckWritten` of `server/src/writes.contract.ts` (T67), the base answer plus the
 * task's line as it now stands (1-based, no newline). Re-declared over the contract's base type on purpose: that module
 * type-imports `core/src/gates.ts`, which `tsconfig.app.json` rejects (see `DashboardBody`).
 */
export interface TaskCheckWritten extends TaskCheckResponse {
  readonly line: { readonly number: number; readonly text: string };
}

/**
 * What the checkbox write answers, never a thrown exception (ISC-25, ISC-26, ISC-86):
 *
 * - `ok`: 200, the line as written and tasks.md's new raw hash (the next tick sends it).
 * - `conflict`: 409 `hash-mismatch`, tasks.md changed since it was rendered; nothing was written.
 * - `locked`: 423, a lock holds the task's claim; the body names the session. Nothing was written.
 * - `error`: anything else (400, 404, an unreadable workspace's 409), status 0 when no answer came.
 */
export type TaskCheckResult =
  | { readonly kind: 'ok'; readonly body: TaskCheckWritten }
  | { readonly kind: 'conflict'; readonly body: Conflict<{ readonly tasks: string }> }
  | { readonly kind: 'locked'; readonly body: Locked }
  | { readonly kind: 'error'; readonly status: number };

const isConflict = (body: unknown): body is Conflict<{ readonly tasks: string }> =>
  typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'hash-mismatch';

const isLocked = (body: unknown): body is Locked => {
  if (typeof body !== 'object' || body === null || (body as { error?: unknown }).error !== 'locked') return false;
  const lock: unknown = (body as { lock?: unknown }).lock;
  return typeof lock === 'object' && lock !== null && typeof (lock as { session?: unknown }).session === 'string';
};

/** Relative on purpose: the app talks only to the loopback server that served it, on whatever port (ISC-2). */
export const WORKSPACES_URL = SPEC_API_ROOT;
export const dashboardUrl = (ws: string): string => `${SPEC_API_ROOT}/${encodeURIComponent(ws)}/dashboard`;
export const planningUrl = (ws: string): string => workspaceRoutes.planning(ws);

/** `GET …/evidence/file?path=` read as text: the body, a refusal (403), or any other failure. */
export type EvidenceTextResult =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'refused' }
  | { readonly kind: 'error'; readonly status: number };

const isContractNotFound = (body: unknown): boolean =>
  typeof body === 'object' && body !== null && (body as { error?: unknown }).error === 'not-found';

/**
 * The client of the loopback `/api` (T35 seam). Every URL comes from the spec routes contract's builders
 * (`server/src/spec-routes.contract.ts`, T44) or the two workspace routes beside them; every body is typed with
 * core's types, never re-declared.
 *
 * ETag-aware: the last 200 of each URL is kept with its `ETag`, the next read sends `If-None-Match`, and a 304 answers
 * from that copy, so a poll transfers only a change. RxJS stays here, at the I/O boundary: each call is one promise.
 */
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly cache = new Map<string, { readonly etag: string; readonly body: unknown }>();
  private readonly tasksHashes = new Map<string, string | null>();
  private readonly specHashes = new Map<string, ReviewedHashes | null>();
  private readonly specFileHashes = new Map<string, string | null>();
  private readonly activityHashes = new Map<string, string | null>();

  /**
   * A GET through the ETag cache. `onHeaders` sees the headers of a 200; with `notModified` set it sees those of a 304
   * too, for a header the server sends on both (the dashboard's activity hash, which can move while the body stays).
   */
  async get<T>(url: string, onHeaders?: (headers: HttpHeaders) => void, notModified = false): Promise<ApiResult<T>> {
    const cached = this.cache.get(url);
    const headers = cached ? new HttpHeaders({ 'If-None-Match': cached.etag }) : undefined;
    try {
      const response = await firstValueFrom(this.http.get<T>(url, { observe: 'response', headers }));
      const etag = response.headers.get('ETag');
      onHeaders?.(response.headers);
      if (etag === null) this.cache.delete(url);
      else this.cache.set(url, { etag, body: response.body });
      return { kind: 'ok', body: response.body as T, etag, notModified: false };
    } catch (failure: unknown) {
      if (notModified && failure instanceof HttpErrorResponse && failure.status === 304) onHeaders?.(failure.headers);
      return this.answer<T>(failure, cached);
    }
  }

  /**
   * Spec 030 (T12, ISC-28): put a stream answer (`LiveView` of the live update stream) into the ETag cache as if a
   * `GET` on `path` had answered it, replacing any older entry, so the next read sends `If-None-Match: etag` and a 304
   * answers `body`. `path` is the read route's request path, the key `get()` uses for the same request.
   */
  prime(path: string, etag: string, body: unknown): void {
    this.cache.set(path, { etag, body });
  }

  workspaces(): Promise<ApiResult<readonly WorkspaceListEntry[]>> {
    return this.get(WORKSPACES_URL);
  }

  /**
   * Spec 016 (T13, ISC-303): `POST /api/workspaces` with the directory and an optional display name, as sent (the
   * server trims and refuses a blank path). 201 the new `WorkspaceAdminSummary`; 400 `invalid-path`, 422
   * `not-a-directory` or `duplicate-path` (with the existing slug) are `refused`. Never cached, never retried.
   */
  addWorkspace(request: AddWorkspaceRequest): Promise<WorkspaceAdminResult<'add'>> {
    return this.admin('add', 'POST', workspaceAdminRoutes.add(), request);
  }

  /** `PATCH /api/workspaces/:ws` with the new name only; slug, `/w/<slug>`, notes and settings stay (ISC-305). */
  renameWorkspace(ws: string, name: string): Promise<WorkspaceAdminResult<'rename'>> {
    const body: RenameWorkspaceRequest = { name };
    return this.admin('rename', 'PATCH', workspaceAdminRoutes.rename(ws), body);
  }

  /** `POST /api/workspaces/:ws/rescan`, no body: the workspace read afresh, its summary with the new counts (ISC-306). */
  rescanWorkspace(ws: string): Promise<WorkspaceAdminResult<'rescan'>> {
    return this.admin('rescan', 'POST', workspaceAdminRoutes.rescan(ws), null);
  }

  /** `DELETE /api/workspaces/:ws`: 204, the registry entry and its images gone, the repository untouched (ISC-307). */
  removeWorkspace(ws: string): Promise<WorkspaceAdminResult<'remove'>> {
    return this.admin('remove', 'DELETE', workspaceAdminRoutes.remove(ws), null);
  }

  /**
   * `PUT /api/workspaces/:ws/images/:kind` with the file's raw bytes (ISC-310, ISC-311): 200 `ImageStored`; 413
   * `too-large` and 415 `unsupported-type` are `refused`. The server decides the type by magic bytes alone.
   */
  uploadWorkspaceImage(ws: string, kind: ImageKind, file: Blob): Promise<WorkspaceAdminResult<'putImage'>> {
    return this.admin('putImage', 'PUT', workspaceAdminRoutes.image(ws, kind), file);
  }

  /** The loopback URL of a stored image with its version (the contract's `imageUrl`); a URL, not a read. */
  workspaceImageUrl(ws: string, kind: ImageKind, version: string): string {
    return workspaceAdminRoutes.imageUrl(ws, kind, version);
  }

  dashboard(ws: string): Promise<ApiResult<DashboardBody>> {
    const url = dashboardUrl(ws);
    return this.get(url, (headers) => this.activityHashes.set(url, headers.get(ACTIVITY_HASH_HEADER)), true);
  }

  /**
   * Spec 040 (T61, ISC-226): the raw `.spectant/activity.jsonl` hash `X-Spectant-Activity-Hash` carried on the last
   * `GET …/dashboard` (200 or 304), the hash `releaseRun()` sends; null before the dashboard was read or without it.
   */
  activityHash(ws: string): string | null {
    return this.activityHashes.get(dashboardUrl(ws)) ?? null;
  }

  /**
   * Spec 040 (T61, ISC-226): `POST …/:ws/runs/:run/release` with the activity hash the page rendered in
   * `X-Spectant-Activity-Hash` and no body. 200 `RunReleased` (the log's new hash and the `run-end` line), 409
   * `StaleActivity`, 422 `RunReleaseRefused` (`no-viewer`, `run-aborted`), validated like `transition()`; a 404
   * (the run is unknown or already ended) is an `error`.
   */
  releaseRun(ws: string, run: string, hash: string): Promise<WriteResult<'runRelease'>> {
    return this.write('runRelease', workspaceRoutes.runRelease(ws, run), null, new HttpHeaders({ [ACTIVITY_HASH_HEADER]: hash }));
  }

  /** The planning tree (spec 003, ISC-103): core's `PlanningModel`, served as it is, ETag-cached like `dashboard()`. */
  planning(ws: string): Promise<ApiResult<PlanningBody>> {
    return this.get(planningUrl(ws));
  }

  spec(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['spec']>> {
    const url = specRoutes.spec(ws, id);
    return this.get(url, (headers) => {
      this.specHashes.set(url, parseReviewedHashes(headers.get(REVIEWED_HASHES_HEADER)));
      this.specFileHashes.set(url, headers.get(SPEC_HASH_HEADER));
    }, true);
  }

  /**
   * The raw spec.md hash `X-Spectant-Spec-Hash` carried on the last `GET …/:id`, 200 or 304 (the server sends it on both;
   * after a live update primed the cache the read is a 304, spec 030), the hash
   * `transition()` sends; null before the spec was read or when the header is absent.
   */
  specHash(ws: string, id: string): string | null {
    return this.specFileHashes.get(specRoutes.spec(ws, id)) ?? null;
  }

  /**
   * T111 · ISC-130: `POST …/:id/transition` with the stage wanted and the raw spec.md hash the page rendered. The
   * answer is the contract's, validated: 200 `TransitionWritten`, 409 `hash-mismatch`, 422 `transition-refused`
   * (the stage row's reason and command), 423 `locked`. Never cached, never retried.
   */
  transition(ws: string, id: string, to: WorkflowStage, hash: string): Promise<WriteResult<'transition'>> {
    const body: TransitionRequest = { to, hash };
    return this.write('transition', specRoutes.transition(ws, id), body);
  }

  /**
   * T111 · ISC-130.2: `POST …/ideas/:slug/allocate` with the story file's raw hash (`IdeaPage.hash`). 200
   * `IdeaAllocated`, 409 `hash-mismatch`, 422 `allocate-refused`, 423 `locked`, validated like `transition()`.
   */
  allocate(ws: string, slug: string, hash: string): Promise<WriteResult<'allocate'>> {
    const body: AllocateRequest = { hash };
    return this.write('allocate', workspaceRoutes.allocate(ws, slug), body);
  }

  /**
   * T14 · ISC-195, ISC-196: `POST …/:ws/backlog` (spec 036) with a move or a priority and the raw hash of
   * `specs/backlog.md` the page rendered (`PlanningModel.backlogHash`), both in the body. 200 `BacklogWritten` (the
   * file's new hash), 409 `StaleBacklog`, 422 `BacklogRefused`, validated like `transition()`; the route never answers
   * 423, so one is an `error`. Never cached, never retried.
   */
  backlog(ws: string, op: BacklogOp, hash: string): Promise<WriteResult<'backlog'>> {
    const body: BacklogRequest = { ...op, hash };
    return this.write('backlog', workspaceRoutes.backlog(ws), body);
  }

  /** T111: one story of `specs/ideas/` (`IdeaPage`: the ref, the rendered page, the raw hash), ETag-cached. */
  idea(ws: string, slug: string): Promise<ApiResult<IdeaPage>> {
    return this.get(workspaceRoutes.idea(ws, slug));
  }

  /**
   * The workspace's library catalog (spec 017, T25, ISC-156): core's `LibraryCatalog`, metadata only, served as it is
   * and ETag-cached like `planning()`. A workspace without `specs/` answers an empty catalog, not a 404.
   */
  library(ws: string): Promise<ApiResult<LibraryCatalog>> {
    return this.get(workspaceRoutes.library(ws));
  }

  /**
   * One Markdown document of the catalog, rendered as a Docs page (`DocsPage`), by its `LibraryDoc.path`. A path the
   * catalog does not list as a present Markdown document is the contract's 404: `not-found`, served.
   */
  libraryDoc(ws: string, path: string): Promise<ApiResult<LibraryDocPage>> {
    return this.get(workspaceRoutes.libraryDoc(ws, path));
  }

  /**
   * The server's search over titles and full text (`LibrarySearchResult`: the query as read, hits in catalog order).
   * An empty or whitespace-only query answers `{query: '', hits: []}` without a request, as the server would.
   */
  librarySearch(ws: string, q: string): Promise<ApiResult<LibrarySearchResult>> {
    if (q.trim() === '') return Promise.resolve({ kind: 'ok', body: { query: '', hits: [] }, etag: null, notModified: false });
    return this.get(workspaceRoutes.librarySearch(ws, q));
  }

  /**
   * The URL of one image below `specs/` (`…/library/asset?path=`), the successor of `techAssetUrl`. A URL, not a
   * read: the browser loads it as an `<img>` source.
   */
  libraryAssetUrl(ws: string, path: string): string {
    return workspaceRoutes.libraryAsset(ws, path);
  }

  /**
   * The URL of one page of a `prototype` catalog document (`/proto/:ws/:spec/:folder/<page>`, outside `/api/`, opened
   * in a new tab), `page` one of `doc.pages`. Null for a document that is no prototype folder. A path, no origin.
   */
  prototypeUrl(ws: string, doc: Pick<LibraryDoc, 'path' | 'spec' | 'type' | 'archived'>, page: string): string | null {
    const folder = doc.type === 'prototype' ? prototypeFolderOf(doc) : null;
    return folder === null ? null : prototypeRoute(ws, doc.spec, folder, page);
  }

  /** T111: the actor names (`GET /api/actors`), every stored `ActorMapping` ordered by id, ETag-cached. */
  actors(): Promise<ApiResult<readonly ActorMapping[]>> {
    return this.get(ACTORS_PATH);
  }

  /** T111: `PUT /api/actors` replaces the whole mapping; the answer is the list as stored. */
  putActors(list: ActorsRequest): Promise<PutResult<readonly ActorMapping[]>> {
    return this.put(ACTORS_PATH, list, isActorMappings);
  }

  /** T111: the workspace's remembered board query (`{query}`, `''` when none is stored), ETag-cached. */
  boardQuery(ws: string): Promise<ApiResult<BoardQuery>> {
    return this.get(workspaceRoutes.boardQuery(ws));
  }

  /** T111: `PUT …/board-query` stores the board URL's query (without `?`); the answer is the query as stored. */
  putBoardQuery(ws: string, query: string): Promise<PutResult<BoardQuery>> {
    const body: BoardQuery = { query };
    return this.put(workspaceRoutes.boardQuery(ws), body, isBoardQuery);
  }

  /**
   * Spec 052 (T9, ISC-300): the workspace's favourite specs (`{specs}`, folder names, sorted), ETag-cached like
   * `boardQuery()`. A 200 the contract's `isFavorites` does not fit is an `error`, so no caller renders a foreign set.
   */
  async favorites(ws: string): Promise<ApiResult<Favorites>> {
    const result = await this.get<unknown>(workspaceRoutes.favorites(ws));
    if (result.kind !== 'ok') return result;
    return isFavorites(result.body) ? { ...result, body: result.body } : { kind: 'error', status: 200 };
  }

  /** Spec 052 (T9): `PUT …/favorites/:spec` without a body sets one favourite; the answer is the whole set as stored. */
  putFavorite(ws: string, spec: string): Promise<PutResult<Favorites>> {
    return this.put(workspaceRoutes.favorite(ws, spec), null, isFavorites);
  }

  /** Spec 052 (T9): `DELETE …/favorites/:spec` unsets one, idempotent; the answer is the whole set as stored. */
  deleteFavorite(ws: string, spec: string): Promise<PutResult<Favorites>> {
    return this.put(workspaceRoutes.favorite(ws, spec), null, isFavorites, 'DELETE');
  }

  /** T55: the spec's timeline, newest first (`TimelineEntry[]`, ISC-80). */
  timeline(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['timeline']>> {
    return this.get(specRoutes.timeline(ws, id));
  }

  /** T81: the board's history, core's `Frame[]` (dispatch and result frames per round, ISC-87), served as it is. */
  frames(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['frames']>> {
    return this.get(specRoutes.frames(ws, id));
  }

  /** T81: the board as it stands now, core's `LiveFrame` (carry-forward, tasks.md, locks; ISC-90). */
  live(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['live']>> {
    return this.get(specRoutes.live(ws, id));
  }

  /**
   * The hashes `X-Spectant-Reviewed-Hashes` carried on the last 200 of `GET …/:id` (a 304 keeps them: the bytes did
   * not change); null before the spec was read or when the header is absent or malformed. The gate write sends them.
   */
  reviewedHashes(ws: string, id: string): ReviewedHashes | null {
    return this.specHashes.get(specRoutes.spec(ws, id)) ?? null;
  }

  /**
   * T54 · ISC-85: `POST …/gate/reviewed` with the hashes the page was rendered from. 409 `hash-mismatch` answers
   * `conflict` (a file changed since), 423 answers `locked` with the lock that holds the spec (ISC-86).
   */
  async gateReviewed(ws: string, id: string, hashes: ReviewedHashes): Promise<GateWriteResult> {
    try {
      const request: GateReviewedRequest = { hashes };
      const body = await firstValueFrom(this.http.post<GateReviewedResponse>(specRoutes.gateReviewed(ws, id), request));
      return { kind: 'ok', body };
    } catch (failure: unknown) {
      if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
      const error: unknown = failure.error;
      if (failure.status === 409 && isContractError(error, 'hash-mismatch')) return { kind: 'conflict' };
      if (failure.status === 423 && isContractError(error, 'locked')) return { kind: 'locked', lock: (error as Locked).lock };
      return { kind: 'error', status: failure.status };
    }
  }

  /** The Claims tab (ISC-81): core's `ClaimViewModel`, served as it is. */
  claims(ws: string, id: string): Promise<ApiResult<SpecRouteResponses['claims']>> {
    return this.get(specRoutes.claims(ws, id));
  }

  /**
   * One evidence file as text (markdown, plain text, JSON) for the preview. The `path` is the listing's
   * `EvidenceFile.path`, encoded once by the contract's builder and never decoded here (ISC-83). A 403 answers
   * `refused`: the file is shown as an error row, never as a fallback preview.
   */
  async evidenceText(ws: string, id: string, path: string): Promise<EvidenceTextResult> {
    try {
      const text = await firstValueFrom(this.http.get(specRoutes.evidenceFile(ws, id, path), { responseType: 'text' }));
      return { kind: 'ok', text };
    } catch (failure: unknown) {
      const status = failure instanceof HttpErrorResponse ? failure.status : 0;
      return status === 403 ? { kind: 'refused' } : { kind: 'error', status };
    }
  }

  /**
   * The Tasks tab (T57); the body is null for a spec without tasks.md. `hash` is `X-Spectant-Tasks-Hash` from the last
   * 200 of this URL (a 304 keeps it: the bytes did not change), null when the header is absent.
   */
  async tasks(ws: string, id: string): Promise<TasksResult> {
    const url = specRoutes.tasks(ws, id);
    const result = await this.get<SpecRouteResponses['tasks']>(url, (headers) => {
      this.tasksHashes.set(url, headers.get(TASKS_HASH_HEADER));
    });
    return result.kind === 'ok' ? { ...result, hash: this.tasksHashes.get(url) ?? null } : result;
  }

  /**
   * The checkbox write (T80, ISC-25): `POST …/tasks/:tid/check` with the state wanted and the raw tasks.md hash the tab
   * rendered (`X-Spectant-Tasks-Hash`). Never cached, never retried: a 409 or a 423 is the user's to act on.
   */
  async taskCheck(ws: string, id: string, tid: string, hash: string, checked: boolean): Promise<TaskCheckResult> {
    const body: TaskCheckRequest = { checked, hash };
    try {
      const written = await firstValueFrom(this.http.post<TaskCheckWritten>(specRoutes.taskCheck(ws, id, tid), body));
      return { kind: 'ok', body: written };
    } catch (failure: unknown) {
      if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
      const error: unknown = failure.error;
      if (failure.status === 409 && isConflict(error)) return { kind: 'conflict', body: error };
      if (failure.status === 423 && isLocked(error)) return { kind: 'locked', body: error };
      return { kind: 'error', status: failure.status };
    }
  }

  /** The Notes area (T100, ISC-95): the workspace's notes, newest first, narrowed by `query` (`NotesQuery`). */
  notes(ws: string, query?: NotesQuery): Promise<ApiResult<readonly Note[]>> {
    return this.get(noteRoutes.list(ws, query));
  }

  /** Per-anchor note counts of one spec (ISC-95): the Claims tab's badge reads a claim's through `noteCountFor` (T101). */
  noteCounts(ws: string, spec: string): Promise<ApiResult<NoteCounts>> {
    return this.get(noteRoutes.counts(ws, spec));
  }

  /** `POST …/notes`: 201 with the stored note. The body must not be blank (`empty-body`). */
  async createNote(ws: string, draft: NoteDraft): Promise<NoteWriteResult> {
    try {
      return { kind: 'ok', note: await firstValueFrom(this.http.post<Note>(noteRoutes.create(ws), draft)) };
    } catch (failure: unknown) {
      return noteError(failure);
    }
  }

  /** `PUT …/notes/:id`: the draft replaces the stored one whole (anchor, title and body). */
  async updateNote(ws: string, id: string, draft: NoteDraft): Promise<NoteWriteResult> {
    try {
      return { kind: 'ok', note: await firstValueFrom(this.http.put<Note>(noteRoutes.update(ws, id), draft)) };
    } catch (failure: unknown) {
      return noteError(failure);
    }
  }

  /** `DELETE …/notes/:id`: 204 without a body. */
  async deleteNote(ws: string, id: string): Promise<NoteDeleteResult> {
    try {
      await firstValueFrom(this.http.delete(noteRoutes.remove(ws, id)));
      return { kind: 'ok' };
    } catch (failure: unknown) {
      return { kind: 'error', status: failure instanceof HttpErrorResponse ? failure.status : 0 };
    }
  }

  /**
   * A write's answer through the contract's `writeAnswerOf`: the status and body of a 2xx or an error alike. A 423
   * `run-locked` of the stage move or the allocation, which `writeAnswerOf` does not fit, is `run-locked` with the run
   * (spec 040, T56, ISC-225.1).
   */
  private async write<R extends WriteOperation>(route: R, url: string, body: unknown, headers?: HttpHeaders): Promise<WriteResult<R>> {
    let status: number;
    let answer: unknown;
    try {
      const response = await firstValueFrom(this.http.post<unknown>(url, body, { observe: 'response', headers }));
      status = response.status;
      answer = response.body;
    } catch (failure: unknown) {
      if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
      status = failure.status;
      answer = failure.error;
    }
    const typed = writeAnswerOf(route, status, answer);
    if (typed !== null) return { kind: 'answer', answer: typed };
    if (status === 423 && route !== 'backlog' && route !== 'runRelease' && isRunLocked(answer)) return { kind: 'run-locked', body: answer } as WriteResult<R>;
    return { kind: 'error', status };
  }

  /** One admin write (spec 016): a 2xx is `ok` with its body, a contract 4xx `refused`, anything else `error`. */
  private async admin<R extends WorkspaceAdminWrite>(
    _route: R,
    method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    body: unknown,
  ): Promise<WorkspaceAdminResult<R>> {
    try {
      const response = await firstValueFrom(this.http.request<unknown>(method, url, { body, observe: 'response' }));
      return { kind: 'ok', body: (response.body ?? null) as WorkspaceAdminResponses[R] };
    } catch (failure: unknown) {
      if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
      const answer: unknown = failure.error;
      if (isAdminRefusal(failure.status, answer)) return { kind: 'refused', status: failure.status, body: answer as WorkspaceAdminErrors[R] };
      return { kind: 'error', status: failure.status };
    }
  }

  /**
   * A `PUT` (or, for a favourite, a bodiless `DELETE`) whose 200 body must pass the contract's validator `fits`;
   * anything else is an `error`.
   */
  private async put<T>(url: string, body: unknown, fits: (value: unknown) => value is T, method: 'PUT' | 'DELETE' = 'PUT'): Promise<PutResult<T>> {
    try {
      const request = method === 'PUT' ? this.http.put<unknown>(url, body, { observe: 'response' }) : this.http.delete<unknown>(url, { observe: 'response' });
      const response = await firstValueFrom(request);
      return fits(response.body) ? { kind: 'ok', body: response.body } : { kind: 'error', status: response.status, error: null };
    } catch (failure: unknown) {
      return noteError(failure);
    }
  }

  private answer<T>(failure: unknown, cached: { readonly etag: string; readonly body: unknown } | undefined): ApiResult<T> {
    if (!(failure instanceof HttpErrorResponse)) return { kind: 'error', status: 0 };
    const status = failure.status;
    const error: unknown = failure.error;
    if (status === 304 && cached) return { kind: 'ok', body: cached.body as T, etag: cached.etag, notModified: true };
    if (status === 404) return { kind: 'not-found', served: isContractNotFound(error) };
    if (status === 409 && isUnavailable(error)) return { kind: 'unavailable', body: error };
    return { kind: 'error', status };
  }
}
