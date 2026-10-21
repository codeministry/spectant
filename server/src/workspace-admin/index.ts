/**
 * The `workspace-admin/` slice's one public surface (spec 059): the writing workspace routes of the settings page, as
 * the router's family, its handlers and alone, and the workspace image store in the app's data folder.
 */
export { WORKSPACE_ADMIN_FAMILY, type WorkspaceAdminFamilyMatch, type WorkspaceAdminFamilyRoute } from "./family.ts";
export { type StoredImage, type WorkspaceImageStore, imageVersion, openImageStore } from "./images.ts";
export { type WorkspaceAdminApiOptions, type WorkspaceAdminLive, workspaceAdminApi, workspaceAdminHandlers } from "./routes.ts";
