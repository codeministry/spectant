/**
 * The writing workspace routes of the settings page (spec 016; contract `workspace-admin.contract.ts`, plan 016
 * § Interfaces). Each write touches only the registry in the app's data folder, never a file of a registered
 * repository (ISC-308).
 *
 * - `POST /api/workspaces` (`add`, ISC-303): registers the directory through `registry.add`, applies a sent `name`
 *   through `registry.rename`, answers 201 with the new entry's summary as `GET /api/workspaces` lists it, then re-syncs
 *   the watch hub and announces the workspace, so every open live stream gets the workspace list at once and the
 *   header's menu shows the entry without a restart. Refusals change nothing (ISC-304): 400 `invalid-body` (no JSON
 *   object, wrong field types) or `invalid-path` (a blank path), both from the contract's parser; 422 `not-a-directory`
 *   (missing or no directory) or `duplicate-path` with the slug of the entry already registered under the same real
 *   path, both from `RegistryError`.
 * - `PATCH /api/workspaces/:ws` (`rename`, ISC-305): sets the display name only, answers 200 with the summary and
 *   announces it. Slug, `/w/<slug>`, notes and settings stay keyed by the slug. 400 `invalid-body` / `invalid-name`
 *   from the contract's parser, then 404 `not-found` for an unknown slug.
 * - `POST /api/workspaces/:ws/rescan` (`rescan`, ISC-306): re-syncs the watch hub, so the workspace is watched as it
 *   now stands, reads its files fresh and answers 200 with that summary, then announces it. 404 for an unknown slug.
 * - `DELETE /api/workspaces/:ws` (`remove`, ISC-307): takes the entry out of the registry, then deletes its image folder
 *   `<data>/workspaces/<slug>/` through the store, answers 204 with no body and `Cache-Control: no-store` (as the e2e
 *   stub), and announces the slug, so every open stream gets the list without it. The repository folder is never
 *   touched; notes and settings keyed by the slug stay orphaned, as `spectant remove` leaves them. 404 for an unknown
 *   slug.
 * - `PUT /api/workspaces/:ws/images/:kind` (`putImage`, ISC-310): stores the body as the kind's one file under
 *   `<data>/workspaces/<slug>/` (`images.ts`, the folder from the registry's slug, never the request), answers
 *   200 `{kind, url}` with the versioned `imageUrl` and announces the workspace. 404 unknown slug, then 413 `too-large`
 *   (over `IMAGE_MAX_BYTES`, by the bytes that arrived), then 415 `unsupported-type`
 *   (`sniffImageType` over the bytes; the upload's own header is ignored); a refusal stores nothing.
 * - `GET`/`HEAD …/images/:kind` (`getImage`): the stored bytes with the type's fixed `Content-Type`, `nosniff`, a strong
 *   ETag over the bytes (`"<sha256 base64url>"`, as the e2e stub) and 304 on a match; 404 without a workspace or image.
 *
 * Guard order, as every route: 403 `{error: "forbidden"}` for a foreign `Host` or a cross-site `Origin` before anything
 * else, then 405 with `workspaceAdminAllowFor` for a method the admin path does not take; the router answers both over
 * `WORKSPACE_ADMIN_FAMILY` (`family.ts`, spec 059, ISC-412). Reads that are no admin route (`GET` of the collection, of
 * a workspace, of its rescan) are left unclaimed, before the guard, for the workspace family or the server's 404, and
 * the image routes pass on without an image store.
 *
 * No answer carries an absolute path: a summary names `pathTail` only.
 */
import { resolve } from "node:path";
import {
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  matchWorkspaceAdminRoute,
  parseAddWorkspaceRequest,
  parseRenameWorkspaceRequest,
  sniffImageType,
  type WorkspaceAdminImageParams,
  type WorkspaceAdminRouteMatch,
  workspaceAdminRoutes,
} from "../contracts/workspace-admin.contract.ts";
import { type Registry, RegistryError, type Workspace } from "../infra/db/registry.ts";
import { realpathOrNull } from "../infra/fs/exists.ts";
import { strongEtag } from "../infra/http/etag.ts";
import { json, readJson } from "../infra/http/json.ts";
import { type RouteHandlers, createRouter } from "../infra/http/router.ts";
import { type ApiHandler, matchesIfNoneMatch } from "../infra/http/server.ts";
import type { WorkspaceListSummary } from "../workspace/index.ts";
import { WORKSPACE_ADMIN_FAMILY, type WorkspaceAdminFamilyMatch } from "./family.ts";
import type { WorkspaceImageStore } from "./images.ts";

/**
 * The live stream's side of a registry write, as callbacks the CLI wires to the watch hub (`live/`), so this slice
 * never imports it.
 */
export interface WorkspaceAdminLive {
  /** Re-syncs the watchers with the registry and reports `ws` as changed to every open stream. */
  readonly announce: (ws: string) => Promise<void>;
  /** Re-syncs the watchers with the registry and the spec worktrees as they now stand. */
  readonly sync: () => Promise<void>;
}

export interface WorkspaceAdminApiOptions {
  readonly registry: Pick<Registry, "add" | "list" | "get" | "rename" | "remove">;
  /** The summary of one workspace as the list route answers it (`workspaceSummaryReader` in `workspace/`). */
  readonly summaryOf: (workspace: Workspace) => Promise<WorkspaceListSummary>;
  /** Called after every registry write. Absent: nothing is pushed, the poll still shows it. */
  readonly live?: WorkspaceAdminLive;
  /** The image store under the data folder (`images.ts`). Absent: the image routes pass on. */
  readonly images?: WorkspaceImageStore;
}

/** The admin routes' handlers; the router has checked the guard and the method. */
export function workspaceAdminHandlers(options: WorkspaceAdminApiOptions): RouteHandlers<WorkspaceAdminFamilyMatch> {
  const { registry } = options;

  /** Pushes the registry as it now stands to every open stream; a failed push never fails the write. */
  const announce = async (ws: string): Promise<void> => {
    await options.live?.announce(ws).catch(() => undefined);
  };

  /** Answers `status` with the workspace's summary read now, then announces it. */
  const answer = async (req: Request, status: number, workspace: Workspace): Promise<Response> => {
    const response = json(req, status, await options.summaryOf(workspace));
    await announce(workspace.slug);
    return response;
  };

  /** The slug of the entry registered under `path`'s real path, as `registry.add` compared it; "" if it vanished meanwhile. */
  const slugOfPath = (path: string): string => {
    const real = realpathOrNull(resolve(path));
    if (real === null) return "";
    return registry.list().find((w) => w.path === real)?.slug ?? "";
  };

  const add = async (req: Request): Promise<Response> => {
    const parsed = parseAddWorkspaceRequest(await readJson(req));
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
    if (parsed.value.name !== null) workspace = registry.rename(workspace.slug, parsed.value.name) ?? workspace;
    return answer(req, 201, workspace);
  };

  const rename = async (req: Request, ws: string): Promise<Response> => {
    const parsed = parseRenameWorkspaceRequest(await readJson(req));
    if (!parsed.ok) return json(req, 400, { error: parsed.error });
    const workspace = registry.rename(ws, parsed.value.name);
    if (workspace === undefined) return json(req, 404, { error: "not-found" });
    return answer(req, 200, workspace);
  };

  const rescan = async (req: Request, ws: string): Promise<Response> => {
    const workspace = registry.get(ws);
    if (workspace === undefined) return json(req, 404, { error: "not-found" });
    // Re-arm the watchers for the registry as it stands first, so a change from now on reaches the stream, then read
    // the files fresh: the loader keeps no model between reads, and the git views key on the file system.
    await options.live?.sync().catch(() => undefined);
    return answer(req, 200, workspace);
  };

  const remove = async (req: Request, ws: string): Promise<Response> => {
    const workspace = registry.get(ws);
    if (workspace === undefined) return json(req, 404, { error: "not-found" });
    // The registry's own slug, never the request's, names the entry and the image folder.
    if (!registry.remove(workspace.slug)) return json(req, 404, { error: "not-found" });
    options.images?.remove(workspace.slug);
    await announce(workspace.slug);
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  };

  const putImage = async (req: Request, { ws, kind }: WorkspaceAdminImageParams, store: WorkspaceImageStore): Promise<Response> => {
    const workspace = registry.get(ws);
    if (workspace === undefined) return json(req, 404, { error: "not-found" });
    // The body is read whole before the size is judged: answering early would leave the client's upload hanging.
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.length > IMAGE_MAX_BYTES) return json(req, 413, { error: "too-large", maxBytes: IMAGE_MAX_BYTES });
    // The type is the bytes' alone; the upload's own `Content-Type` is never read.
    const type = sniffImageType(bytes);
    if (type === null) return json(req, 415, { error: "unsupported-type" });
    const version = store.write(workspace.slug, kind, type, bytes);
    const response = json(req, 200, { kind, url: workspaceAdminRoutes.imageUrl(workspace.slug, kind, version) });
    await announce(workspace.slug);
    return response;
  };

  const getImage = (req: Request, { ws, kind }: WorkspaceAdminImageParams, store: WorkspaceImageStore): Response => {
    const workspace = registry.get(ws);
    const image = workspace === undefined ? null : store.read(workspace.slug, kind);
    if (image === null) return json(req, 404, { error: "not-found" });
    const headers = {
      "Content-Type": IMAGE_TYPES[image.type].contentType,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      ETag: strongEtag(image.bytes),
    };
    if (matchesIfNoneMatch(req.headers.get("If-None-Match"), headers.ETag)) return new Response(null, { status: 304, headers });
    return new Response(req.method === "HEAD" ? null : image.bytes, { status: 200, headers });
  };

  const dispatch = (req: Request, match: WorkspaceAdminRouteMatch): Promise<Response> | Response | null => {
    const store = options.images;
    switch (match.route) {
      case "add":
        return add(req);
      case "rename":
        return rename(req, match.params.ws);
      case "rescan":
        return rescan(req, match.params.ws);
      case "remove":
        return remove(req, match.params.ws);
      case "putImage":
        return store === undefined ? null : putImage(req, match.params, store);
      case "getImage":
        return store === undefined ? null : getImage(req, match.params, store);
      default:
        return null;
    }
  };

  /** One handler for every admin path: the method is one the path's `Allow` names, so the table has its route. */
  const route = (req: Request, url: URL): Promise<Response> | Response | null => {
    const match = matchWorkspaceAdminRoute(url.pathname, req.method);
    return match === null ? null : dispatch(req, match);
  };

  return { adminCollection: route, adminWorkspace: route, adminRescan: route, adminImage: route } satisfies RouteHandlers<WorkspaceAdminFamilyMatch>;
}

/** The admin routes alone as an `ApiHandler`; `null` for every path or method they leave to another handler. */
export function workspaceAdminApi(options: WorkspaceAdminApiOptions): ApiHandler {
  return createRouter([WORKSPACE_ADMIN_FAMILY], workspaceAdminHandlers(options));
}
