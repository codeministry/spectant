/**
 * The workspace routes as one `ApiHandler` (T47, ISC-16; spec 059, ISC-412): the workspace family (`workspace/`) over
 * the router, its handlers from the slices that answer them, built over the family's one context. Nothing is cached:
 * each request reads the registry and the files again, so a `spectant add` or an edited spec shows on the next poll,
 * and the ETag keeps an unchanged answer to a 304. `null` for every path the family does not claim.
 */
import { createRouter } from "../infra/http/router.ts";
import type { ApiHandler } from "../infra/http/server.ts";
import { libraryHandlers } from "../library/index.ts";
import { planningHandlers } from "../planning/index.ts";
import { type DashboardApiOptions, workspaceContext, workspaceFamily, workspaceHandlers } from "../workspace/index.ts";
import { workspaceWriteHandlers } from "../writes/index.ts";

export function dashboardApi(options: DashboardApiOptions): ApiHandler {
  const ctx = workspaceContext(options);
  return createRouter([workspaceFamily({ db: ctx.db !== undefined })], {
    ...workspaceHandlers(ctx),
    ...planningHandlers(ctx),
    ...libraryHandlers(ctx),
    ...workspaceWriteHandlers(ctx),
  });
}
