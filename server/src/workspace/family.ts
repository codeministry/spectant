/**
 * The workspace route family (spec 059, ISC-412): the workspace list, the dashboard and `WORKSPACE_ROUTE_TABLE`'s
 * twelve routes as the router's `RouteFamily`, plus the handlers of the list and the dashboard. The planning tree, the
 * story page, the board query and the favourites are answered by `planning/`, the library's catalog, reader, search and
 * asset routes by `library/`, the allocation, the backlog and the run release by `writes/`; the composition is
 * `dashboardApi` (`cli/`).
 *
 * - `GET /api/workspaces` → `WorkspaceListSummary[]` and `GET /api/workspaces/:slug/dashboard` → the `DashboardModel`
 *   (`routes.ts`); 404 for an unknown slug, 409 with the workspace's summary when its folder cannot be read. A slug that
 *   fails to decode is a 404 `not-found`, after the guard and the method.
 * - 403 `{error: "forbidden"}` for a non-loopback `Host` or a cross-site `Origin`, before the method.
 * - 405 `{error: "method-not-allowed"}` with `allowForWorkspace(route)`, `GET, HEAD` on the dashboard; on the list path
 *   `GET, HEAD, POST`, since it also takes spec 016's add route (the composed server answers that `POST` before this
 *   family, so here it is a 405 too).
 * - The family claims only the paths it matches (`unmatched: "decline"`), so any other `/api/workspaces…` path, the
 *   workspace itself and its `rescan` included, is left to the next handler and, after the last, the server's JSON 404.
 *   Without a database the board query and the favourites are not claimed either: they reach the next handler
 *   unguarded, as before the router.
 *
 * Lock sources (T51, ISC-37): the list and the dashboard read the repository's `.spectant/activity.jsonl`, and the
 * LifeOS frontier locks only when the options name LifeOS, so their counts agree. No absolute path leaves the family
 * (ISC-3): a workspace is its slug, its name and `pathTail`; the unreadable codes replace OS messages.
 */
import {
  WORKSPACE_ROUTE_TABLE,
  type WorkspaceRouteMatch,
  type WorkspaceRouteName,
  allowForWorkspace,
  matchWorkspacePath,
} from "../contracts/spec-routes.contract.ts";
import { workspaceAdminAllowFor } from "../contracts/workspace-admin.contract.ts";
import { methodNotAllowed } from "../infra/http/guard.ts";
import { json } from "../infra/http/json.ts";
import type { RouteFamily, RouteHandlers } from "../infra/http/router.ts";
import type { WorkspaceContext } from "./context.ts";
import { DASHBOARD_PATH, WORKSPACES_PATH, WORKSPACE_READ_ALLOW, workspaceRoutes } from "./routes.ts";

export type WorkspaceFamilyRoute = WorkspaceRouteName | "list" | "dashboard";

/** A workspace route's match, or the list's, or the dashboard's with its slug still percent-encoded. */
export type WorkspaceFamilyMatch =
  | WorkspaceRouteMatch
  | { readonly route: "list"; readonly params: Record<string, never> }
  | { readonly route: "dashboard"; readonly params: { readonly slug: string } };

/** The routes answered from the app database alone, served only with one. */
const DB_ROUTES: ReadonlySet<string> = new Set<WorkspaceRouteName>(["boardQuery", "favorites", "favorite"]);

/** The list path's `Allow`: the admin route's `POST` beside the reads. */
const LIST_ALLOW = workspaceAdminAllowFor(WORKSPACES_PATH) ?? WORKSPACE_READ_ALLOW;

function matchWorkspaceFamily(pathname: string): WorkspaceFamilyMatch | null {
  const route = matchWorkspacePath(pathname);
  if (route !== null) return route;
  if (pathname === WORKSPACES_PATH) return { route: "list", params: {} };
  const dashboard = DASHBOARD_PATH.exec(pathname);
  return dashboard === null ? null : { route: "dashboard", params: { slug: dashboard[1] ?? "" } };
}

/** The family, its database routes claimed only when `db` is set. */
export function workspaceFamily(options: { readonly db: boolean }): RouteFamily<WorkspaceFamilyRoute, WorkspaceFamilyMatch> {
  return {
    name: "workspace",
    routes: ["list", "dashboard", ...WORKSPACE_ROUTE_TABLE.map((entry) => entry.route)],
    claims: (pathname) => {
      const match = matchWorkspaceFamily(pathname);
      return match !== null && (options.db || !DB_ROUTES.has(match.route));
    },
    match: matchWorkspaceFamily,
    allow: (route) => (route === "list" ? LIST_ALLOW : route === "dashboard" ? WORKSPACE_READ_ALLOW : allowForWorkspace(route)),
    guard: "loopback",
    respond: json,
    unmatched: "decline",
  };
}

/** The list and the dashboard as handlers of the family. */
export function workspaceHandlers(ctx: WorkspaceContext): RouteHandlers<Extract<WorkspaceFamilyMatch, { route: "list" | "dashboard" }>> {
  const { list, dashboard } = workspaceRoutes(ctx);
  return {
    // The router lets the admin route's `POST` through the list path's `Allow`; this family only reads.
    list: (req) => (req.method === "POST" ? methodNotAllowed(req, LIST_ALLOW) : list(req)),
    dashboard: (req, _url, match) => {
      let slug: string;
      try {
        slug = decodeURIComponent(match.params.slug);
      } catch {
        return json(req, 404, { error: "not-found" });
      }
      return dashboard(req, slug);
    },
  } satisfies RouteHandlers<Extract<WorkspaceFamilyMatch, { route: "list" | "dashboard" }>>;
}
