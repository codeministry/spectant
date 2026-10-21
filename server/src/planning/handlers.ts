/**
 * The `planning/` slice's routes as handlers of the workspace family (spec 059, ISC-412): the planning tree, the story
 * page, the board query and the favourites, each given its route's match after the router's guard and method check.
 */
import type { WorkspaceRouteMatch } from "../contracts/spec-routes.contract.ts";
import type { RouteHandlers } from "../infra/http/router.ts";
import type { WorkspaceContext } from "../workspace/index.ts";
import { prefsRoutes } from "./prefs-routes.ts";
import { planningRoutes } from "./routes.ts";

/** The workspace family's routes this slice answers. */
export type PlanningRoute = "planning" | "idea" | "boardQuery" | "favorites" | "favorite";

export function planningHandlers(ctx: WorkspaceContext): RouteHandlers<Extract<WorkspaceRouteMatch, { route: PlanningRoute }>> {
  const { planning, idea } = planningRoutes(ctx);
  const { boardQuery, favorites, favorite } = prefsRoutes(ctx);
  const { db } = ctx;
  // Without a database the family does not claim the three database routes (`workspace/family.ts`), so they are never
  // reached; were one reached, it would decline all the same.
  return {
    planning: (req, _url, match) => planning(req, match.params.ws),
    idea: (req, _url, match) => idea(req, match.params.ws, match.params.slug),
    boardQuery: (req, _url, match) => (db === undefined ? null : boardQuery(req, match.params.ws, db)),
    favorites: (req, _url, match) => (db === undefined ? null : favorites(req, match.params.ws, db)),
    favorite: (req, _url, match) => (db === undefined ? null : favorite(req, match.params.ws, match.params.spec, db)),
  } satisfies RouteHandlers<Extract<WorkspaceRouteMatch, { route: PlanningRoute }>>;
}
