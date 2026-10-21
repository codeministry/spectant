/**
 * The workspace admin route family (spec 059, ISC-412): `WORKSPACE_ADMIN_ROUTE_TABLE`'s six routes sit on four paths,
 * so the family's routes are those paths, `adminCollection` (add), `adminWorkspace` (rename, remove), `adminRescan` and
 * `adminImage` (putImage, getImage), and each handler takes the table's route by the method (`routes.ts`). The `Allow`
 * of a 405 is the contract's `workspaceAdminAllowFor`.
 *
 * The admin paths are also the workspace reads' paths, so the family leaves their `GET` and `HEAD` unclaimed, before
 * its guard: the collection's read is the workspace family's list route, and a workspace or its `rescan` read reaches
 * the server's plain JSON 404. Only the images' `GET` and `HEAD` are the family's own (`getImage`).
 */
import { type WorkspaceAdminRouteName, matchWorkspaceAdminRoute, workspaceAdminAllowFor } from "../contracts/workspace-admin.contract.ts";
import { json } from "../infra/http/json.ts";
import type { RouteFamily } from "../infra/http/router.ts";

export type WorkspaceAdminFamilyRoute = "adminCollection" | "adminWorkspace" | "adminRescan" | "adminImage";

/** An admin path; the handler reads the table's route and its params by the method. */
export type WorkspaceAdminFamilyMatch = {
  [R in WorkspaceAdminFamilyRoute]: { readonly route: R; readonly params: Record<string, never> };
}[WorkspaceAdminFamilyRoute];

/** The path each route of the table sits on. */
const PATH_OF: Readonly<Record<WorkspaceAdminRouteName, WorkspaceAdminFamilyRoute>> = {
  add: "adminCollection",
  rename: "adminWorkspace",
  remove: "adminWorkspace",
  rescan: "adminRescan",
  putImage: "adminImage",
  getImage: "adminImage",
};

/** The admin path a pathname names, whatever the method: each path takes `POST`, `PATCH` or `PUT`. */
function matchAdminPath(pathname: string): WorkspaceAdminFamilyMatch | null {
  const write = matchWorkspaceAdminRoute(pathname, "POST") ?? matchWorkspaceAdminRoute(pathname, "PATCH") ?? matchWorkspaceAdminRoute(pathname, "PUT");
  return write === null ? null : { route: PATH_OF[write.route], params: {} };
}

export const WORKSPACE_ADMIN_FAMILY: RouteFamily<WorkspaceAdminFamilyRoute, WorkspaceAdminFamilyMatch> = {
  name: "workspace-admin",
  routes: ["adminCollection", "adminWorkspace", "adminRescan", "adminImage"],
  claims: (pathname, method) => {
    const match = matchAdminPath(pathname);
    return match !== null && (match.route === "adminImage" || (method !== "GET" && method !== "HEAD"));
  },
  match: matchAdminPath,
  allow: (_route, pathname) => workspaceAdminAllowFor(pathname) ?? "",
  guard: "loopback",
  respond: json,
  unmatched: "decline",
};
