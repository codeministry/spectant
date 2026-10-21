/**
 * The workspace list and the dashboard (T47, ISC-16; plan 001 § Interfaces "HTTP"), read-only over the registry and
 * the files of the registered repositories, answered with the workspace family's context (`context.ts`):
 *
 * - `GET /api/workspaces` → `WorkspaceListSummary[]` in registry order (`summary.ts`); `counts` is the workspace's
 *   `DashboardKpis`, built without a services probe; `null` when unreadable.
 * - `GET /api/workspaces/:slug/dashboard` → the `DashboardModel` of `core/src/dashboard.ts`, unchanged, its `services`
 *   from the local-listener probe labelled with the constitution's `dev_services:`, its item states at the request's
 *   clock (spec 040, ISC-224), and the activity log's hash in `X-Spectant-Activity-Hash` (spec 040, ISC-226). 404 for an
 *   unknown slug, 409 with the workspace's summary when its folder cannot be read.
 *
 * The guard, the method check and the path match stay with `dashboardApi`, which dispatches here.
 */
import { join } from "node:path";
import { ACTIVITY_HASH_HEADER } from "../contracts/spec-routes.contract.ts";
import { ACTIVITY_PATH } from "../contracts/writes.contract.ts";
import { rawSha256 } from "../infra/hash.ts";
import { unreadableCode, workspaceUnreadable } from "../infra/fs/errno.ts";
import { readBytesIfExists } from "../infra/fs/read.ts";
import { json } from "../infra/http/json.ts";
import type { WorkspaceContext } from "./context.ts";
import { listSummary, summaryOf, unavailable } from "./summary.ts";

/** The list route; a dashboard is `${WORKSPACES_PATH}/:slug/dashboard`. */
export const WORKSPACES_PATH = "/api/workspaces";

/** The dashboard route; its one group is the slug, still encoded. */
export const DASHBOARD_PATH = /^\/api\/workspaces\/([^/]+)\/dashboard$/;

/** The methods the list and the dashboard answer. */
export const WORKSPACE_READ_ALLOW = "GET, HEAD";

/** The list and the dashboard as handlers over one context; the caller has guarded and matched the request. */
export function workspaceRoutes(ctx: WorkspaceContext): {
  list: (req: Request) => Promise<Response>;
  dashboard: (req: Request, slug: string) => Promise<Response>;
} {
  const { registry, load, stateDir } = ctx;

  const list = async (req: Request): Promise<Response> => {
    const workspaces = registry.list();
    const loads = await Promise.all(workspaces.map((w) => load(w.path, null, stateDir)));
    return json(req, 200, workspaces.map((w, i) => listSummary(w, loads[i] ?? { readable: false, error: "unreadable" }, ctx.imagesOf)));
  };

  const dashboard = async (req: Request, slug: string): Promise<Response> => {
    const workspace = registry.get(slug);
    if (!workspace) return json(req, 404, { error: "not-found" });
    // The item states at this request's clock and the abort age as the setting now stands (spec 040, ISC-224).
    const loaded = await load(workspace.path, ctx.services, stateDir, ctx.stateClock());
    if (!loaded.readable) return json(req, 409, summaryOf(workspace, loaded));
    // The hash a run release sends back (spec 040, ISC-226): the raw bytes of the activity log, the empty text's without it.
    return json(req, 200, loaded.model, { [ACTIVITY_HASH_HEADER]: rawSha256(readBytesIfExists(join(workspace.path, ACTIVITY_PATH)) ?? "") });
  };

  return { list, dashboard };
}

/**
 * A route over one registered workspace whose folder answers: 404 `not-found` for an unknown slug, 409 `Unavailable`
 * when the folder cannot be read up front or a read inside `answer` fails with an errno code; any other throw is a
 * defect and surfaces as a 500. The story page and the family's three writes answer through it.
 */
export async function readableWorkspace(
  ctx: Pick<WorkspaceContext, "registry">,
  req: Request,
  slug: string,
  answer: (root: string) => Promise<Response>,
): Promise<Response> {
  const workspace = ctx.registry.get(slug);
  if (!workspace) return json(req, 404, { error: "not-found" });
  const root = workspace.path;
  const unreadable = workspaceUnreadable(root);
  if (unreadable !== null) return json(req, 409, unavailable(workspace, unreadable));
  try {
    return await answer(root);
  } catch (error) {
    if (typeof (error as NodeJS.ErrnoException | null)?.code !== "string") throw error;
    return json(req, 409, unavailable(workspace, unreadableCode(error)));
  }
}
