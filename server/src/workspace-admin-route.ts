/**
 * The writing workspace routes of the settings page (spec 016; contract `workspace-admin.contract.ts`, plan 016
 * § Interfaces). Each write touches only the registry in the app's data folder, never a file of a registered
 * repository (ISC-308).
 *
 * - `POST /api/workspaces` (`add`, ISC-303): registers the directory through `registry.add`, answers 201 with the new
 *   entry's summary as `GET /api/workspaces` lists it, then re-syncs the watch hub and announces the workspace, so
 *   every open live stream gets the workspace list at once and the header's menu shows the entry without a restart.
 *   Refusals change nothing (ISC-304): 400 `invalid-body` (no JSON object, wrong field types) or `invalid-path` (a
 *   blank path), both from the contract's parser; 422 `not-a-directory` (missing or no directory) or `duplicate-path`
 *   with the slug of the entry already registered under the same real path, both from `RegistryError`.
 *   `name` is admitted but not yet applied: the registry gains `rename` with spec 016 T5.
 *
 * Guard order, as every route: 403 `{error: "forbidden"}` for a foreign `Host` or a cross-site `Origin` before anything
 * else, then 405 with `workspaceAdminAllowFor` for a method the admin path does not take. `GET` and `HEAD` of the
 * collection are not admin routes: they pass on to the list route of `api.ts`.
 *
 * No answer carries an absolute path: a summary names `pathTail` only.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { json, type WorkspaceListSummary } from "./api.ts";
import type { ApiHandler } from "./http.ts";
import { type Registry, RegistryError, type Workspace } from "./registry.ts";
import { isLoopbackHost, isLoopbackOrigin } from "./settings.ts";
import type { WatchHub } from "./watch.ts";
import { matchWorkspaceAdminRoute, parseAddWorkspaceRequest, workspaceAdminAllowFor, workspaceAdminRoutes } from "./workspace-admin.contract.ts";

export interface WorkspaceAdminApiOptions {
  readonly registry: Pick<Registry, "add" | "list">;
  /** The summary of one workspace as the list route answers it (`workspaceSummaryReader` in `api.ts`). */
  readonly summaryOf: (workspace: Workspace) => Promise<WorkspaceListSummary>;
  /** The live stream's hub: announced after every registry write. Absent: nothing is pushed, the poll still shows it. */
  readonly hub?: Pick<WatchHub, "announce">;
}

/** The request body as JSON, or `undefined` when it is none; the contract's parser refuses that as `invalid-body`. */
async function bodyOf(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export function workspaceAdminApi(options: WorkspaceAdminApiOptions): ApiHandler {
  const { registry } = options;

  /** Pushes the registry as it now stands to every open stream; a failed push never fails the write. */
  const announce = async (ws: string): Promise<void> => {
    await options.hub?.announce(ws).catch(() => undefined);
  };

  /** The slug of the entry registered under `path`'s real path, as `registry.add` compared it; "" if it vanished meanwhile. */
  const slugOfPath = (path: string): string => {
    let real: string;
    try {
      real = realpathSync(resolve(path));
    } catch {
      return "";
    }
    return registry.list().find((w) => w.path === real)?.slug ?? "";
  };

  const add = async (req: Request): Promise<Response> => {
    const parsed = parseAddWorkspaceRequest(await bodyOf(req));
    if (!parsed.ok) return json(req, 400, { error: parsed.error });
    let workspace: Workspace;
    try {
      workspace = registry.add(parsed.value.path);
    } catch (error) {
      if (!(error instanceof RegistryError)) throw error;
      // The refusal names the reason, never the path; a duplicate names the entry that already holds it.
      if (error.code === "not-a-directory") return json(req, 422, { error: "not-a-directory" });
      return json(req, 422, { error: "duplicate-path", slug: slugOfPath(parsed.value.path) });
    }
    const answer = json(req, 201, await options.summaryOf(workspace));
    await announce(workspace.slug);
    return answer;
  };

  return (req, url) => {
    // The other admin routes (rename, rescan, remove, images) pass on until their tasks land.
    if (url.pathname !== workspaceAdminRoutes.add()) return null;
    // The collection's reads are the list route of `api.ts`.
    if (req.method === "GET" || req.method === "HEAD") return null;
    if (!isLoopbackHost(req.headers.get("Host")) || !isLoopbackOrigin(req.headers.get("Origin"))) {
      return json(req, 403, { error: "forbidden" });
    }
    if (matchWorkspaceAdminRoute(url.pathname, req.method)?.route !== "add") {
      return json(req, 405, { error: "method-not-allowed" }, { Allow: workspaceAdminAllowFor(url.pathname) ?? "GET, HEAD, POST" });
    }
    return add(req);
  };
}
