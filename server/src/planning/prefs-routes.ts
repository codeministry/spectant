/**
 * The board's stored preferences, answered from the database alone (the context's `db`), never a repository file, and
 * dispatched by the router over the workspace family after its guard and method check (`handlers.ts`); without a
 * database the family does not claim them, so the server's JSON 404 applies.
 *
 * The board query (spec 008 T92, ISC-129.1): `GET`/`HEAD`/`PUT /api/workspaces/:ws/board-query` → `BoardQuery`, from
 * the `board_query` table: GET `{query}` (`''` when none is stored), PUT validated by the contract's `isBoardQuery`
 * (400 `invalid-body` otherwise) and stored per workspace slug with the server clock. Guard order: 403, 405 with
 * `allowForWorkspace` (`GET, HEAD, PUT`), 404 for an unknown workspace, then the body. No 409: the workspace's files
 * are not read.
 *
 * The favourites (spec 052 T4, ISC-296): `GET`/`HEAD /api/workspaces/:ws/favorites` and `PUT`/`DELETE
 * /api/workspaces/:ws/favorites/:spec` → `Favorites`, from the `spec_favorite` table, and since spec 064 (T50,
 * ISC-494) `PUT`/`DELETE /api/workspaces/:ws/favorites/idea/:slug` from the `idea_favorite` table. Every answer is
 * `{specs, ideas}`, the workspace's whole set of both, each sorted, so the web takes the server's state after a write. `PUT` sets and `DELETE` unsets,
 * both idempotent; the spec need not exist in the workspace (plan 052). Guard order: 403, 405 with `allowForWorkspace`
 * (`GET, HEAD` or `PUT, DELETE`), 404 for an unknown workspace, 400 `invalid-spec` for an id the contract's
 * `isFavoriteSpec` refuses, 400 `invalid-slug` for a story slug `isFavoriteIdea` refuses. No 409.
 */
import { type WorkspaceRouteResponses, allowForWorkspace, isBoardQuery, isFavoriteIdea, isFavoriteSpec } from "../contracts/spec-routes.contract.ts";
import type { Db } from "../infra/db/db.ts";
import {
  addFavorite,
  addIdeaFavorite,
  getBoardQuery,
  listFavorites,
  listIdeaFavorites,
  removeFavorite,
  removeIdeaFavorite,
  setBoardQuery,
} from "../infra/db/prefs-store.ts";
import { methodNotAllowed } from "../infra/http/guard.ts";
import { json, readJson } from "../infra/http/json.ts";
import type { WorkspaceContext } from "../workspace/index.ts";

/** The board query and the favourites over one context's registry; the caller has guarded the request and holds the database. */
export function prefsRoutes(ctx: Pick<WorkspaceContext, "registry">): {
  boardQuery: (req: Request, slug: string, db: Db) => Promise<Response>;
  favorites: (req: Request, slug: string, db: Db) => Response;
  favorite: (req: Request, slug: string, spec: string, db: Db) => Response;
  ideaFavorite: (req: Request, slug: string, story: string, db: Db) => Response;
} {
  const { registry } = ctx;

  // The database alone: no file of the workspace is read, so there is no 409 (header).
  const boardQuery = async (req: Request, slug: string, db: Db): Promise<Response> => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "PUT") {
      return methodNotAllowed(req, allowForWorkspace("boardQuery"));
    }
    if (!registry.get(slug)) return json(req, 404, { error: "not-found" });
    if (req.method !== "PUT") {
      const body: WorkspaceRouteResponses["boardQuery"] = { query: getBoardQuery(db, slug)?.query ?? "" };
      return json(req, 200, body);
    }
    const body = await readJson(req);
    if (!isBoardQuery(body)) return json(req, 400, { error: "invalid-body" });
    setBoardQuery(db, slug, body.query, new Date().toISOString());
    const stored: WorkspaceRouteResponses["boardQuery"] = { query: body.query };
    return json(req, 200, stored);
  };

  // The favourites (spec 052 T4): the database alone like the board query, so no 409; every answer is the whole set.
  const all = (db: Db, slug: string): WorkspaceRouteResponses["favorites"] => ({ specs: listFavorites(db, slug), ideas: listIdeaFavorites(db, slug) });

  const favorites = (req: Request, slug: string, db: Db): Response => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      return methodNotAllowed(req, allowForWorkspace("favorites"));
    }
    if (!registry.get(slug)) return json(req, 404, { error: "not-found" });
    return json(req, 200, all(db, slug));
  };

  const favorite = (req: Request, slug: string, spec: string, db: Db): Response => {
    if (req.method !== "PUT" && req.method !== "DELETE") {
      return methodNotAllowed(req, allowForWorkspace("favorite"));
    }
    if (!registry.get(slug)) return json(req, 404, { error: "not-found" });
    if (!isFavoriteSpec(spec)) return json(req, 400, { error: "invalid-spec" });
    if (req.method === "PUT") addFavorite(db, slug, spec, new Date().toISOString());
    else removeFavorite(db, slug, spec);
    return json(req, 200, all(db, slug));
  };

  // An idea favourite (spec 064 T50, ISC-494): `favorite`'s guard order and answer, for a story slug.
  const ideaFavorite = (req: Request, slug: string, story: string, db: Db): Response => {
    if (req.method !== "PUT" && req.method !== "DELETE") {
      return methodNotAllowed(req, allowForWorkspace("ideaFavorite"));
    }
    if (!registry.get(slug)) return json(req, 404, { error: "not-found" });
    if (!isFavoriteIdea(story)) return json(req, 400, { error: "invalid-slug" });
    if (req.method === "PUT") addIdeaFavorite(db, slug, story, new Date().toISOString());
    else removeIdeaFavorite(db, slug, story);
    return json(req, 200, all(db, slug));
  };

  return { boardQuery, favorites, favorite, ideaFavorite };
}
