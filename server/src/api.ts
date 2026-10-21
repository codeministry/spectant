/**
 * The workspace routes (T47, ISC-16; plan 001 § Interfaces "HTTP"), read-only over the registry and the files of the
 * registered repositories:
 *
 * - `GET /api/workspaces` → `WorkspaceListSummary[]` and `GET /api/workspaces/:slug/dashboard` → the `DashboardModel`:
 *   answered by the `workspace/` slice (`workspace/routes.ts`, the summaries in `workspace/summary.ts`); this handler
 *   guards, matches and dispatches them with the family's one context (`workspace/context.ts`).
 *
 * Answers:
 * - 200 with the JSON body; `HEAD` gets the same headers without it.
 * - 304 when `If-None-Match` matches. Every JSON answer is `json()`'s (`infra/http/json.ts`), with its strong `ETag`
 *   and `Cache-Control: no-cache`.
 * - 404 `{error: "not-found"}` for an unknown slug.
 * - 409 with the workspace's own summary (`readable: false`, `error` one of `missing`, `not-a-directory`,
 *   `permission-denied`, `unreadable`, `counts: null`) for a registered workspace whose directory cannot be read: the
 *   workspace exists, its files do not answer. The same entry appears in the list, so the client shows one notice for
 *   both, and a 2xx dashboard answer is always a model.
 * - 403 `{error: "forbidden"}` for a non-loopback `Host` or a cross-site `Origin`, the guard of `settingsApi`.
 * - 405 `{error: "method-not-allowed"}` with `Allow: GET, HEAD` for any other method; on the list path `GET, HEAD,
 *   POST`, since it also takes spec 016's add route.
 * - any other `/api/workspaces…` path is `null`, so the server's JSON 404 applies.
 *
 * The planning tree, the story page, the board query and the favourites are answered by the `planning/` slice
 * (`planning/routes.ts`, `planning/prefs-routes.ts`), the library's catalog, reader, search and asset routes by the
 * `library/` slice (`library/routes.ts`); each is matched here by the contract's `matchWorkspacePath` and dispatched
 * after the same guard. Without `options.db` the board query and the favourites are declined, so the server's JSON 404
 * applies.
 *
 * The actor names (spec 008 T91, ISC-119.2): `actorsApi` serves `GET`/`HEAD`/`PUT /api/actors` (`ACTORS_PATH`), a
 * route of its own like `/api/settings`, under the same loopback guard. GET lists the `actor` table's rows as
 * `ActorMapping[]` ordered by id; an id without a row is never invented, so the web shows an unmapped id raw. PUT
 * replaces the whole mapping (`isActorMappings`, each id a person by core's `parseActor`; 400 `invalid-body`
 * otherwise), `updatedAt` from the server clock, and answers the list as stored.
 * The allocation route (spec 008 T87, ISC-130.2): `POST /api/workspaces/:ws/ideas/:slug/allocate` → `IdeaAllocated`,
 * the family's one write, matched by the same `matchWorkspacePath`: 403, then 405 with `Allow: POST` for any other
 * method, 404 unknown workspace, 409 with the summary when the folder cannot be read, otherwise `allocate-route.ts`
 * (400, 404 unknown story, 409 stale story, 422 refused, 200). The lock source is `options.lifeos`'s, as on the reads;
 * the clock is `options.now`.
 *
 * The backlog route (spec 036, ISC-191): `POST /api/workspaces/:ws/backlog` → `BacklogWritten`, matched by the same
 * `matchWorkspacePath` with the allocation's guard order (403, 405 with `Allow: POST`, 404 unknown workspace, 409 with
 * the summary when the folder cannot be read), otherwise `backlog-route.ts` (400, 409 stale backlog, 422 refused, 200).
 * No lock source is read. The planning route serves `backlogHash` from the same raw bytes the write compares.
 *
 * The run release (spec 040, ISC-226): `POST /api/workspaces/:ws/runs/:run/release` → `RunReleased`, matched by the
 * same `matchWorkspacePath` with the backlog's guard order, otherwise `run-release-route.ts` (400 without the hash
 * header, 404 no such open run, 409 stale log, 422 refused, 200). The dashboard sends the hash it compares,
 * `X-Spectant-Activity-Hash`, the raw sha256 of `.spectant/activity.jsonl` (the empty text's without the file).
 *
 * Lock sources (T51, ISC-37): both routes read the repository's `.spectant/activity.jsonl`, and the LifeOS frontier
 * locks only when `options.lifeos` is present, so the counts in the list and the dashboard agree.
 *
 * No absolute path leaves this module (ISC-3): a workspace is its slug, its name and `pathTail`, the last path segment;
 * the unreadable codes replace OS messages, which would name the path.
 */
import { parseActor } from "../../core/src/actor.ts";
import { allocateAnswer } from "./allocate-route.ts";
import { backlogAnswer } from "./backlog-route.ts";
import { runReleaseAnswer } from "./run-release-route.ts";
import type { Db } from "./infra/db/db.ts";
import { listActors, replaceActors } from "./infra/db/prefs-store.ts";
import type { ApiHandler } from "./http.ts";
import { json, readJson } from "./infra/http/json.ts";
import { loopbackRefusal, methodNotAllowed } from "./infra/http/guard.ts";
import { libraryRoutes } from "./library/index.ts";
import { planningRoutes, prefsRoutes } from "./planning/index.ts";
import {
  ACTORS_ALLOW,
  ACTORS_PATH,
  type ActorsResponse,
  allowForWorkspace,
  isActorMappings,
  matchWorkspacePath,
} from "./spec-routes.contract.ts";
import {
  type DashboardApiOptions,
  DASHBOARD_PATH,
  WORKSPACES_PATH,
  WORKSPACE_READ_ALLOW,
  readableWorkspace,
  workspaceContext,
  workspaceRoutes,
} from "./workspace/index.ts";
import { workspaceAdminAllowFor } from "./workspace-admin.contract.ts";

export { composeApi, json } from "./infra/http/json.ts";
export {
  type DashboardApiOptions,
  type ImagesOf,
  type WorkspaceListSummary,
  type WorkspaceSummary,
  NO_IMAGES,
  WORKSPACES_PATH,
  localDate,
  workspaceSummaryReader,
} from "./workspace/index.ts";

/**
 * `GET` / `HEAD` of the workspace list, the dashboard and the planning route as an `ApiHandler`; `null` for every other path. Nothing is cached: each
 * request reads the registry and the files again, so a `spectant add` or an edited spec shows on the next poll, and
 * the ETag keeps an unchanged answer to a 304.
 */
export function dashboardApi(options: DashboardApiOptions): ApiHandler {
  const ctx = workspaceContext(options);
  const { stateDir, clock } = ctx;
  const { list, dashboard } = workspaceRoutes(ctx);
  const { planning, idea } = planningRoutes(ctx);
  const { boardQuery, favorites, favorite } = prefsRoutes(ctx);
  const { library, libraryDoc, librarySearch, libraryAsset } = libraryRoutes(ctx);

  // The one write of the family (T87): the route layer's 404 and 409 here, everything else in `allocate-route.ts`.
  const allocate = (req: Request, slug: string, story: string): Promise<Response> =>
    readableWorkspace(ctx, req, slug, async (root) => {
      const age = ctx.abortAge();
      const answer = await allocateAnswer({ root, slug: story, stateDir, now: clock(), text: await req.text(), ...age });
      return json(req, answer.status, answer.body);
    });

  // The backlog write (spec 036): the route layer's 404 and 409 here, everything else in `backlog-route.ts`.
  const backlog = (req: Request, slug: string): Promise<Response> =>
    readableWorkspace(ctx, req, slug, async (root) => {
      const answer = await backlogAnswer({ root, now: clock(), text: await req.text() });
      return json(req, answer.status, answer.body);
    });

  // The run release (spec 040, ISC-226): the route layer's 404 and 409 here, everything else in `run-release-route.ts`.
  const runRelease = (req: Request, slug: string, run: string): Promise<Response> =>
    readableWorkspace(ctx, req, slug, async (root) => {
      const age = ctx.abortAge();
      const answer = await runReleaseAnswer({ root, now: clock(), run, headers: req.headers, ...age });
      return json(req, answer.status, answer.body);
    });

  return (req, url) => {
    const { pathname } = url;
    const match = DASHBOARD_PATH.exec(pathname);
    const workspaceRoute = matchWorkspacePath(pathname);
    if (pathname !== WORKSPACES_PATH && !match && !workspaceRoute) return null;
    const { db } = ctx;
    const dbRoute = workspaceRoute?.route === "boardQuery" || workspaceRoute?.route === "favorites" || workspaceRoute?.route === "favorite";
    if (dbRoute && db === undefined) return null;
    const refused = loopbackRefusal(req);
    if (refused !== null) return refused;
    if (workspaceRoute?.route === "boardQuery" && db !== undefined) return boardQuery(req, workspaceRoute.params.ws, db);
    if (workspaceRoute?.route === "favorites" && db !== undefined) return favorites(req, workspaceRoute.params.ws, db);
    if (workspaceRoute?.route === "favorite" && db !== undefined) {
      return favorite(req, workspaceRoute.params.ws, workspaceRoute.params.spec, db);
    }
    if (workspaceRoute?.route === "allocate") {
      if (req.method !== "POST") return methodNotAllowed(req, allowForWorkspace("allocate"));
      return allocate(req, workspaceRoute.params.ws, workspaceRoute.params.slug);
    }
    if (workspaceRoute?.route === "backlog") {
      if (req.method !== "POST") return methodNotAllowed(req, allowForWorkspace("backlog"));
      return backlog(req, workspaceRoute.params.ws);
    }
    if (workspaceRoute?.route === "runRelease") {
      if (req.method !== "POST") return methodNotAllowed(req, allowForWorkspace("runRelease"));
      return runRelease(req, workspaceRoute.params.ws, workspaceRoute.params.run);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      // The list path also takes the admin route's POST (spec 016), so its 405 names it as the composed server does.
      const list = pathname === WORKSPACES_PATH ? workspaceAdminAllowFor(pathname) : null;
      const allow = workspaceRoute ? allowForWorkspace(workspaceRoute.route) : (list ?? WORKSPACE_READ_ALLOW);
      return methodNotAllowed(req, allow);
    }
    if (workspaceRoute?.route === "idea") return idea(req, workspaceRoute.params.ws, workspaceRoute.params.slug);
    if (workspaceRoute?.route === "library") return library(req, workspaceRoute.params.ws);
    if (workspaceRoute?.route === "libraryDoc") return libraryDoc(req, workspaceRoute.params.ws, url.search);
    if (workspaceRoute?.route === "librarySearch") return librarySearch(req, workspaceRoute.params.ws, url.searchParams.get("q") ?? "");
    if (workspaceRoute?.route === "libraryAsset") return libraryAsset(req, workspaceRoute.params.ws, url.search);
    if (workspaceRoute) return planning(req, workspaceRoute.params.ws);
    if (!match) return list(req);
    let slug: string;
    try {
      slug = decodeURIComponent(match[1] ?? "");
    } catch {
      return json(req, 404, { error: "not-found" });
    }
    return dashboard(req, slug);
  };
}

function actorList(db: Db): ActorsResponse {
  return listActors(db).map(({ id, displayName, gitIdentities }) => ({ id, displayName, gitIdentities }));
}

/**
 * `GET` / `HEAD` / `PUT /api/actors` as an `ApiHandler` over the `actor` table (T91, ISC-119.2; header); `null` for
 * any other path, so the server's JSON 404 applies. The answers carry ids, names and addresses only, never a path.
 */
export function actorsApi(db: Db): ApiHandler {
  const put = async (req: Request): Promise<Response> => {
    const body = await readJson(req);
    // Only a person has a row: an agent id, a legacy value or a repeated id refuses the whole list.
    if (!isActorMappings(body) || !body.every((actor) => parseActor(actor.id).kind === "person")) {
      return json(req, 400, { error: "invalid-body" });
    }
    const updatedAt = new Date().toISOString();
    replaceActors(db, body.map((actor) => ({ ...actor, updatedAt })));
    return json(req, 200, actorList(db));
  };

  return (req, url) => {
    if (url.pathname !== ACTORS_PATH) return null;
    const refused = loopbackRefusal(req);
    if (refused !== null) return refused;
    if (req.method === "GET" || req.method === "HEAD") return json(req, 200, actorList(db));
    if (req.method === "PUT") return put(req);
    return methodNotAllowed(req, ACTORS_ALLOW);
  };
}
