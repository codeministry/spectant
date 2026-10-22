import type { Priority } from '../../../../../core/src/files';
import {
  type AllocateRequest,
  type BacklogRequest,
  type BoardQuery,
  type Favorites,
  type IdeaPage,
  isBoardQuery,
  isFavorites,
  workspaceRoutes,
  type WorkspaceRouteResponses,
} from '../../../../../server/src/contracts/spec-routes.contract';
import type { ApiResult, HttpCore, PutResult, WriteResult } from './http-core';

/** A backlog write without its hash (spec 036): move a feature in front of `before` (null: to its group's end), or set its priority. */
export type BacklogOp =
  | { readonly op: 'move'; readonly feature: string; readonly before: string | null }
  | { readonly op: 'priority'; readonly feature: string; readonly priority: Priority };

/**
 * The planning body, `PlanningModel` of `core/src/planning.ts`, through the contract's `WorkspaceRouteResponses`. Unlike
 * `DashboardBody` it is typed: its type graph is web-clean (the types it needs live in pure types modules, T18), which
 * `bun run --cwd web typecheck` proves.
 */
export type PlanningBody = WorkspaceRouteResponses['planning'];

export const planningUrl = (ws: string): string => workspaceRoutes.planning(ws);

/** The planning tree and what hangs off it: stories and their allocation, the backlog, the board query, the favourites. */
export class PlanningClient {
  constructor(private readonly core: HttpCore) {}

  /** The planning tree (spec 003, ISC-103): core's `PlanningModel`, served as it is, ETag-cached like `dashboard()`. */
  planning(ws: string): Promise<ApiResult<PlanningBody>> {
    return this.core.get(planningUrl(ws));
  }

  /**
   * T111 · ISC-130.2: `POST …/ideas/:slug/allocate` with the story file's raw hash (`IdeaPage.hash`). 200
   * `IdeaAllocated`, 409 `hash-mismatch`, 422 `allocate-refused`, 423 `locked`, validated like `transition()`.
   */
  allocate(ws: string, slug: string, hash: string): Promise<WriteResult<'allocate'>> {
    const body: AllocateRequest = { hash };
    return this.core.write('allocate', workspaceRoutes.allocate(ws, slug), body);
  }

  /**
   * T14 · ISC-195, ISC-196: `POST …/:ws/backlog` (spec 036) with a move or a priority and the raw hash of
   * `specs/backlog.md` the page rendered (`PlanningModel.backlogHash`), both in the body. 200 `BacklogWritten` (the
   * file's new hash), 409 `StaleBacklog`, 422 `BacklogRefused`, validated like `transition()`; the route never answers
   * 423, so one is an `error`. Never cached, never retried.
   */
  backlog(ws: string, op: BacklogOp, hash: string): Promise<WriteResult<'backlog'>> {
    const body: BacklogRequest = { ...op, hash };
    return this.core.write('backlog', workspaceRoutes.backlog(ws), body);
  }

  /** T111: one story of `specs/ideas/` (`IdeaPage`: the ref, the rendered page, the raw hash), ETag-cached. */
  idea(ws: string, slug: string): Promise<ApiResult<IdeaPage>> {
    return this.core.get(workspaceRoutes.idea(ws, slug));
  }

  /** T111: the workspace's remembered board query (`{query}`, `''` when none is stored), ETag-cached. */
  boardQuery(ws: string): Promise<ApiResult<BoardQuery>> {
    return this.core.get(workspaceRoutes.boardQuery(ws));
  }

  /** T111: `PUT …/board-query` stores the board URL's query (without `?`); the answer is the query as stored. */
  putBoardQuery(ws: string, query: string): Promise<PutResult<BoardQuery>> {
    const body: BoardQuery = { query };
    return this.core.put(workspaceRoutes.boardQuery(ws), body, isBoardQuery);
  }

  /**
   * Spec 052 (T9, ISC-300): the workspace's favourite specs (`{specs}`, folder names, sorted), ETag-cached like
   * `boardQuery()`. A 200 the contract's `isFavorites` does not fit is an `error`, so no caller renders a foreign set.
   */
  async favorites(ws: string): Promise<ApiResult<Favorites>> {
    const result = await this.core.get<unknown>(workspaceRoutes.favorites(ws));
    if (result.kind !== 'ok') return result;
    return isFavorites(result.body) ? { ...result, body: result.body } : { kind: 'error', status: 200 };
  }

  /** Spec 052 (T9): `PUT …/favorites/:spec` without a body sets one favourite; the answer is the whole set as stored. */
  putFavorite(ws: string, spec: string): Promise<PutResult<Favorites>> {
    return this.core.put(workspaceRoutes.favorite(ws, spec), null, isFavorites);
  }

  /** Spec 052 (T9): `DELETE …/favorites/:spec` unsets one, idempotent; the answer is the whole set as stored. */
  deleteFavorite(ws: string, spec: string): Promise<PutResult<Favorites>> {
    return this.core.put(workspaceRoutes.favorite(ws, spec), null, isFavorites, 'DELETE');
  }

  /** Spec 064 (T53, ISC-497): `PUT …/favorites/idea/:slug` sets one story as a favourite; the answer is the whole set. */
  putIdeaFavorite(ws: string, slug: string): Promise<PutResult<Favorites>> {
    return this.core.put(workspaceRoutes.ideaFavorite(ws, slug), null, isFavorites);
  }

  /** Spec 064 (T53): `DELETE …/favorites/idea/:slug` unsets it, idempotent; the answer is the whole set as stored. */
  deleteIdeaFavorite(ws: string, slug: string): Promise<PutResult<Favorites>> {
    return this.core.put(workspaceRoutes.ideaFavorite(ws, slug), null, isFavorites, 'DELETE');
  }
}
