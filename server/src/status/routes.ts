/**
 * The status board route (spec 071, ISC-593; plan 071 § Interfaces): `GET`/`HEAD /api/status` (`STATUS_PATH`), a route
 * of its own like `/api/actors`, under the same loopback guard; the router's `STATUS_FAMILY`. It reads every registered
 * workspace in registry order, the order `GET /api/workspaces` answers and so the workspace picker's, into its
 * dashboard model at the request's clock, without a services probe (the board shows no listeners), and answers core's
 * `statusBoard` over them at that same clock. An unreadable workspace stays on the board as an entry with its
 * `UnreadableCode`. The answer carries slugs and path tails only, never an absolute path (ISC-3); `json()` sends the
 * ETag over the body and the 304.
 */
import { type StatusInput, statusBoard } from "../../../core/src/status-board.ts";
import { STATUS_ALLOW, STATUS_PATH } from "../contracts/status.contract.ts";
import { json } from "../infra/http/json.ts";
import { type PathMatch, type RouteHandlers, createRouter, pathFamily } from "../infra/http/router.ts";
import type { ApiHandler } from "../infra/http/server.ts";
import { type DashboardApiOptions, type WorkspaceContext, pathTail, workspaceContext } from "../workspace/index.ts";

/** The status route as the router's family: `/api/status` alone. */
export const STATUS_FAMILY = pathFamily("status", STATUS_PATH, STATUS_ALLOW);

/** What the board reads from the workspace family's context: the registry, the loader, LifeOS and the request clock. */
export type StatusContext = Pick<WorkspaceContext, "registry" | "load" | "stateDir" | "stateClock">;

/** The handler of `GET` / `HEAD /api/status` (header); the router has checked the guard and the method. */
export function statusHandlers(ctx: StatusContext): RouteHandlers<PathMatch<"status">> {
  const status = async (req: Request): Promise<Response> => {
    // One clock for the whole board: the item states and the 24-hour window read the same `now` (ISC-584, ISC-224).
    const clock = ctx.stateClock();
    const workspaces = ctx.registry.list();
    const loads = await Promise.all(workspaces.map((w) => ctx.load(w.path, null, ctx.stateDir, clock)));
    const inputs = workspaces.map((w, i): StatusInput => {
      const loaded = loads[i] ?? { readable: false, error: "unreadable" };
      const head = { slug: w.slug, pathTail: pathTail(w.path) };
      return loaded.readable ? { ...head, readable: true, model: loaded.model } : { ...head, readable: false, error: loaded.error };
    });
    return json(req, 200, statusBoard(inputs, clock.now));
  };

  return { status } satisfies RouteHandlers<PathMatch<"status">>;
}

/** `GET` / `HEAD /api/status` alone as an `ApiHandler` over the workspace options; `null` for any other path. */
export function statusApi(options: DashboardApiOptions): ApiHandler {
  return createRouter([STATUS_FAMILY], statusHandlers(workspaceContext(options)));
}
