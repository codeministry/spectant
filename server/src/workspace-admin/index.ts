/**
 * The `workspace-admin/` slice's one public surface (spec 059): the writing workspace routes of the settings page and
 * the workspace image store in the app's data folder.
 */
export { type StoredImage, type WorkspaceImageStore, imageVersion, openImageStore } from "./images.ts";
export { type WorkspaceAdminApiOptions, type WorkspaceAdminLive, workspaceAdminApi } from "./routes.ts";
