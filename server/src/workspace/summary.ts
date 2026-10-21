/**
 * The workspace summary (T47, ISC-16; spec 016): what `GET /api/workspaces` lists per workspace and the body of every
 * 409 a route of an unreadable workspace sends (`Unavailable`).
 *
 * No absolute path leaves this module (ISC-3): a workspace is its slug, its name and `pathTail`, the last path segment;
 * the unreadable codes replace OS messages, which would name the path.
 */
import type { DashboardKpis } from "../../../core/src/dashboard.ts";
import type { Unavailable, UnreadableCode } from "../contracts/spec-routes.contract.ts";
import { type WorkspaceImages, type WorkspaceSummaryAdded, workspaceStatusOf } from "../contracts/workspace-admin.contract.ts";
import type { Workspace } from "../infra/db/registry.ts";
import type { DashboardApiOptions } from "./context.ts";
import { type DashboardLoad, loadDashboard } from "./load.ts";

/**
 * The body of a 409 workspace answer (`Unavailable`), and the base of each `GET /api/workspaces` entry
 * (`WorkspaceListSummary`).
 */
export type WorkspaceSummary = {
  slug: string;
  name: string;
  /** The last segment of the workspace path; the path itself never leaves the server. */
  pathTail: string;
  readable: boolean;
  /** Present only when `readable` is false. */
  error?: UnreadableCode;
  /** The workspace's key numbers; null when it cannot be read. */
  counts: DashboardKpis | null;
};

/**
 * One entry of `GET /api/workspaces` and the answer of the writing workspace routes: the summary plus the fields spec
 * 016 adds (`WorkspaceSummaryAdded` in `workspace-admin.contract.ts`): `status` from the read (ISC-309) and `images`;
 * no `addedAt`, so a re-add keeps the list bytes (ISC-7). The 409 body keeps the plain `WorkspaceSummary`, as
 * `Unavailable` pins it.
 */
export type WorkspaceListSummary = WorkspaceSummary & WorkspaceSummaryAdded;

/** The last path segment, whatever the separator: the API's and the CLI's one name for a workspace's folder. */
export function pathTail(path: string): string {
  return path.split(/[\\/]/).filter((segment) => segment !== "").pop() ?? "";
}

/** A workspace without a stored image, and every workspace when no image store is wired (`imagesOf` absent). */
export const NO_IMAGES: WorkspaceImages = { logo: null, screenshot: null };

/** The image URLs of a workspace by slug (`workspace-images.ts` `imagesOf`, spec 016 T7). */
export type ImagesOf = (slug: string) => WorkspaceImages;

export const noImages: ImagesOf = () => NO_IMAGES;

/** The summary of one workspace from one read: its counts when readable, else its unreadable code. */
export function summaryOf(workspace: Workspace, load: DashboardLoad): WorkspaceSummary {
  const base = { slug: workspace.slug, name: workspace.name, pathTail: pathTail(workspace.path) };
  return load.readable
    ? { ...base, readable: true, counts: load.model.kpis }
    : { ...base, readable: false, error: load.error, counts: null };
}

/**
 * The 409 body of a workspace whose folder cannot be read: its summary with the stable code, never the path. Every
 * route of a registered workspace sends this one body, so the client shows one notice for all of them.
 */
export function unavailable(workspace: Pick<Workspace, "slug" | "name" | "path">, error: UnreadableCode): Unavailable {
  return { slug: workspace.slug, name: workspace.name, pathTail: pathTail(workspace.path), readable: false, error, counts: null };
}

/** The list's entry: the summary, its status from the same read and the image URLs. */
export function listSummary(workspace: Workspace, load: DashboardLoad, imagesOf: ImagesOf): WorkspaceListSummary {
  const status = workspaceStatusOf(load.readable, load.readable ? load.model.kpis.specs : null);
  return { ...summaryOf(workspace, load), status, images: imagesOf(workspace.slug) };
}

/**
 * The summary of one workspace as `GET /api/workspaces` lists it, read now: the writing workspace routes (spec 016,
 * `workspace-admin-route.ts`) answer with it, so the row a write returns equals the row the list shows.
 */
export function workspaceSummaryReader(
  options: Pick<DashboardApiOptions, "loadWorkspace" | "lifeos" | "imagesOf">,
): (workspace: Workspace) => Promise<WorkspaceListSummary> {
  const load = options.loadWorkspace ?? loadDashboard;
  const stateDir = options.lifeos?.stateDir ?? null;
  const imagesOf = options.imagesOf ?? noImages;
  return async (workspace) => listSummary(workspace, await load(workspace.path, null, stateDir), imagesOf);
}
